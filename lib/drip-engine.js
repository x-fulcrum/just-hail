// Drip orchestration engine.
// ----------------------------------------------------------------
// One module owns:
//   - enrollLeads(drip_campaign_id, lead_ids[])
//     Creates drip_lead_state rows + schedules step 1 for each lead
//   - tick()
//     The cron entrypoint. Finds due actions, validates each, dispatches.
//   - dispatchTouch(drip_lead_state_id)
//     Internal: send the next touch for ONE lead.
//   - advanceState(drip_lead_state_id, event)
//     Move a lead forward/backward based on engagement events.
//
// Failure semantics:
//   - DNC blocked → lead status = 'opted_out' (TCPA defense)
//   - Email bounce hard → lead status = 'bounced_out'
//   - Email opt-out reply → lead status = 'opted_out'
//   - Network error → retry up to 3x with exponential backoff,
//     then mark status = 'failed' for human review

import { supabase } from './supabase.js';
import { renderTemplate } from './drip-sequences.js';
import { verify as verifyEmail } from './bouncer.js';
import { lookup as lookupPhone, normalizePhone } from './twilio-lookup.js';
import { check as dncCheck } from './dnc.js';
import { send as sendSms } from './twilio-sms.js';
import {
  addLeadsToCampaign as smartleadAddLeads,
  createCampaign as smartleadCreateCampaign,
  attachMailboxesToCampaign,
  updateCampaignSequence,
  startCampaign as smartleadStart,
  listEmailAccounts,
} from './smartlead.js';

// ----------------------------------------------------------------
// enrollLeads — add a batch of leads to a drip campaign
// ----------------------------------------------------------------
// Steps:
//   1. Read the drip campaign's sequence
//   2. For each lead: insert a drip_lead_state row (idempotent)
//   3. Schedule step 1 with the sequence's delay_hours[0] (typically 0 = now)
//   4. (For email channel) ALSO push the lead to Smartlead so its
//      sender pool starts the actual send
//   5. Update drip_campaigns counters
// ----------------------------------------------------------------
export async function enrollLeads({ drip_campaign_id, lead_ids, source = 'admin_ui' }) {
  if (!drip_campaign_id) throw new Error('drip_campaign_id required');
  if (!Array.isArray(lead_ids) || !lead_ids.length) {
    return { ok: false, error: 'lead_ids must be non-empty array' };
  }

  // Load drip campaign + its sequence
  const { data: drip } = await supabase
    .from('drip_campaigns')
    .select('id, name, sequence_id, source_campaign_id, status, metadata')
    .eq('id', drip_campaign_id)
    .single();
  if (!drip) return { ok: false, error: 'drip_campaign not found' };

  const { data: seq } = await supabase
    .from('drip_sequences')
    .select('id, name, steps, sender_pool')
    .eq('id', drip.sequence_id)
    .single();
  if (!seq) return { ok: false, error: 'drip_sequence not found' };

  const step1 = (seq.steps || [])[0];
  if (!step1) return { ok: false, error: 'sequence has no steps' };

  // Load lead rows
  const { data: leads } = await supabase
    .from('leads')
    .select('id, first_name, last_name, email, phone, mobile, street, city, state, zip, opted_out, status')
    .in('id', lead_ids.slice(0, 1000));   // safety cap

  const enrollments = [];
  const skipped = [];
  const now = new Date().toISOString();
  const firstSchedule = new Date(Date.now() + (step1.delay_hours || 0) * 3600_000).toISOString();

  for (const lead of (leads || [])) {
    if (lead.opted_out) {
      skipped.push({ lead_id: lead.id, reason: 'lead_opted_out' });
      continue;
    }
    enrollments.push({
      drip_campaign_id,
      lead_id: lead.id,
      current_step: 0,
      next_step: 1,
      scheduled_at: firstSchedule,
      status: 'active',
      enrolled_at: now,
      metadata: { enrolled_by: source },
    });
  }

  if (!enrollments.length) {
    return { ok: false, error: 'no eligible leads', skipped };
  }

  // Idempotent insert (unique on drip_campaign_id + lead_id)
  const { data: inserted, error: insErr } = await supabase
    .from('drip_lead_state')
    .upsert(enrollments, { onConflict: 'drip_campaign_id,lead_id', ignoreDuplicates: true })
    .select('id, lead_id');

  if (insErr) return { ok: false, error: 'enrollment insert: ' + insErr.message };

  // Update counters on the campaign
  await supabase
    .from('drip_campaigns')
    .update({
      total_leads: (await supabase
        .from('drip_lead_state')
        .select('id', { count: 'exact', head: true })
        .eq('drip_campaign_id', drip_campaign_id)).count || 0,
      active_leads: (await supabase
        .from('drip_lead_state')
        .select('id', { count: 'exact', head: true })
        .eq('drip_campaign_id', drip_campaign_id)
        .eq('status', 'active')).count || 0,
      enrollment_started_at: drip.metadata?.enrollment_started_at || now,
      status: drip.status === 'draft' ? 'enrolling' : drip.status,
    })
    .eq('id', drip_campaign_id);

  return {
    ok: true,
    enrolled: inserted?.length || 0,
    skipped: skipped.length,
    skipped_details: skipped.slice(0, 10),
    drip_campaign_id,
    sequence_id: seq.id,
  };
}

// ----------------------------------------------------------------
// tick — the cron entrypoint. Runs every 5 min.
// ----------------------------------------------------------------
// 1. Find drip_lead_state rows with status='active' AND scheduled_at <= now
// 2. Cap to MAX_PER_TICK (prevents one tick from going wild on a 10k batch)
// 3. For each: dispatchTouch()
// 4. Update campaign counters
// ----------------------------------------------------------------
const MAX_PER_TICK = 100;     // hard cap per cron tick
const MAX_PER_CAMPAIGN_PER_TICK = 25;  // even smaller cap per drip campaign

export async function tick({ now = new Date(), dryRun = false } = {}) {
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();

  // Query due rows joined with their drip campaign (to check max_daily_dispatches)
  const { data: due, error } = await supabase
    .from('drip_lead_state')
    .select(`
      id, drip_campaign_id, lead_id, current_step, next_step, scheduled_at,
      status, failure_count, metadata,
      drip_campaigns!inner ( id, status, max_daily_dispatches, sequence_id, name ),
      leads!inner ( id, first_name, last_name, email, phone, mobile, street, city, state, zip, opted_out )
    `)
    .eq('status', 'active')
    .lte('scheduled_at', nowIso)
    .limit(MAX_PER_TICK);

  if (error) return { ok: false, error: error.message };
  if (!due || !due.length) return { ok: true, processed: 0, message: 'no due actions' };

  // Group by campaign to enforce per-campaign cap
  const byCampaign = new Map();
  for (const row of due) {
    const cid = row.drip_campaign_id;
    if (!byCampaign.has(cid)) byCampaign.set(cid, []);
    if (byCampaign.get(cid).length < MAX_PER_CAMPAIGN_PER_TICK) {
      byCampaign.get(cid).push(row);
    }
  }

  // Skip campaigns that aren't 'active' or 'enrolling'
  const flat = [...byCampaign.values()].flat()
    .filter((r) => ['active', 'enrolling'].includes(r.drip_campaigns?.status));

  const results = { processed: 0, sent: 0, blocked: 0, failed: 0, skipped: 0 };

  for (const row of flat) {
    if (dryRun) { results.processed++; continue; }
    const result = await dispatchTouch({ stateRow: row });
    results.processed++;
    if (result.sent)    results.sent++;
    else if (result.blocked) results.blocked++;
    else if (result.failed)  results.failed++;
    else if (result.skipped) results.skipped++;
  }

  return { ok: true, ...results };
}

// ----------------------------------------------------------------
// dispatchTouch — send the next step for ONE lead
// ----------------------------------------------------------------
export async function dispatchTouch({ stateRow }) {
  const lead = stateRow.leads;
  const drip = stateRow.drip_campaigns;
  const stateId = stateRow.id;

  // Re-load sequence (might be edited mid-campaign)
  const { data: seq } = await supabase
    .from('drip_sequences')
    .select('steps, sender_pool')
    .eq('id', drip.sequence_id)
    .single();
  if (!seq) {
    await markStateFailed(stateId, 'sequence not found');
    return { failed: true, reason: 'no_sequence' };
  }

  const step = (seq.steps || []).find((s) => s.step_number === stateRow.next_step);
  if (!step) {
    // No more steps → completed
    await markStateCompleted(stateId);
    return { skipped: true, reason: 'sequence_complete' };
  }

  // Skip-if checks
  const skipIf = step.skip_if || [];
  if (skipIf.includes('opted_out') && lead.opted_out) {
    await markStateOptedOut(stateId);
    return { blocked: true, reason: 'opted_out' };
  }
  if (skipIf.includes('do_not_contact') && lead.status === 'do_not_contact') {
    await markStateOptedOut(stateId);
    return { blocked: true, reason: 'do_not_contact' };
  }

  // Channel-specific dispatch
  let dispatchResult = null;
  if (step.channel === 'email') {
    dispatchResult = await dispatchEmail({ stateRow, step, lead, drip });
  } else if (step.channel === 'sms') {
    dispatchResult = await dispatchSms({ stateRow, step, lead, drip });
  } else if (step.channel === 'voicemail') {
    dispatchResult = await dispatchVoicemail({ stateRow, step, lead, drip });
  } else if (step.channel === 'call') {
    dispatchResult = await dispatchCall({ stateRow, step, lead, drip });
  } else {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateId,
      step_number: step.step_number, channel: step.channel || 'unknown',
      event_type: 'failed', recipient: 'n/a',
      error_message: 'unknown_channel: ' + step.channel,
    });
    await markStateFailed(stateId, 'unknown channel: ' + step.channel);
    return { failed: true, reason: 'unknown_channel' };
  }

  // On success → schedule next step (if any)
  if (dispatchResult?.sent) {
    await scheduleNextStep(stateRow, seq, step.step_number);
    return { sent: true, ...dispatchResult };
  }

  // Blocked (DNC, opt-out, line-type) → mark + don't advance
  if (dispatchResult?.blocked) {
    if (['lead_opted_out', 'dnc_blocked', 'on_dnc_list'].includes(dispatchResult.reason)) {
      await markStateOptedOut(stateId);
    }
    return { blocked: true, ...dispatchResult };
  }

  // Quiet hours → keep status active, push schedule by ~12h
  if (dispatchResult?.reason === 'quiet_hours' || dispatchResult?.defer_until_morning) {
    const tomorrow8am = new Date();
    tomorrow8am.setUTCHours(13, 0, 0, 0);   // ~8am Central
    if (tomorrow8am < new Date()) tomorrow8am.setUTCDate(tomorrow8am.getUTCDate() + 1);
    await supabase.from('drip_lead_state').update({
      scheduled_at: tomorrow8am.toISOString(),
    }).eq('id', stateId);
    return { skipped: true, reason: 'quiet_hours_deferred' };
  }

  // Network or provider error → bump failure_count, retry on next tick
  await supabase.from('drip_lead_state').update({
    failure_count: (stateRow.failure_count || 0) + 1,
    last_failure: dispatchResult?.error || dispatchResult?.reason || 'unknown',
    scheduled_at: new Date(Date.now() + Math.min(3600_000, 60_000 * Math.pow(2, stateRow.failure_count || 0))).toISOString(),
  }).eq('id', stateId);

  if ((stateRow.failure_count || 0) >= 3) {
    await markStateFailed(stateId, dispatchResult?.error || 'too_many_retries');
    return { failed: true, reason: 'max_retries' };
  }

  return { failed: true, reason: dispatchResult?.error || 'transient_failure' };
}

// ----------------------------------------------------------------
// Channel dispatchers
// ----------------------------------------------------------------

async function dispatchEmail({ stateRow, step, lead, drip }) {
  if (!lead.email) {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
      step_number: step.step_number, channel: 'email',
      event_type: 'failed', recipient: '(none)',
      error_message: 'no_email_on_lead',
    });
    return { blocked: true, reason: 'no_email' };
  }

  // Verify with Bouncer
  const verify = await verifyEmail(lead.email);
  if (!verify.ok || verify.drop) {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
      step_number: step.step_number, channel: 'email',
      event_type: 'undeliverable', recipient: lead.email,
      error_message: 'bouncer: ' + (verify.status || verify.error),
    });
    // Mark lead bounced_out so Hailey knows
    await supabase.from('drip_lead_state').update({ status: 'bounced_out' }).eq('id', stateRow.id);
    return { blocked: true, reason: 'email_undeliverable' };
  }
  if (verify.hold_for_review) {
    // Don't send, but don't bounce out either — pause for manual review
    await supabase.from('drip_lead_state').update({
      status: 'paused',
      last_failure: 'email_quality_hold: toxicity ' + verify.toxicity,
    }).eq('id', stateRow.id);
    return { blocked: true, reason: 'email_hold_for_review' };
  }

  // Render content
  const stormDate = drip.metadata?.storm_date || 'recently';
  const subject = renderTemplate(step.subject, lead, { storm_date: stormDate });
  const body = renderTemplate(step.body, lead, { storm_date: stormDate });

  // Push to Smartlead — currently we use a simplified model: each
  // drip_campaign maps 1:1 to a Smartlead campaign. The Smartlead
  // campaign ID lives in drip_campaigns.metadata.smartlead_campaign_id.
  // (Provisioning happens lazily on first dispatch via getOrCreateSmartleadCampaign.)
  let smartleadCampaignId;
  try {
    smartleadCampaignId = await getOrCreateSmartleadCampaign({ drip, sequence: { steps: [step] }});
  } catch (err) {
    return { failed: true, error: 'smartlead provision: ' + err.message };
  }

  let leadResult;
  try {
    leadResult = await smartleadAddLeads(smartleadCampaignId, [{
      first_name: lead.first_name,
      last_name:  lead.last_name,
      email:      lead.email,
      phone:      lead.phone || lead.mobile,
      lead_id:    lead.id,
      drip_id:    drip.id,
      drip_step:  step.step_number,
      campaign_id: drip.id,
      street:     lead.street,
      storm_date: stormDate,
    }]);
  } catch (err) {
    return { failed: true, error: 'smartlead add: ' + err.message };
  }

  await logTouch({
    drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
    step_number: step.step_number, channel: 'email',
    event_type: 'sent', recipient: lead.email, sender: '(smartlead pool)',
    subject, body,
    provider: 'smartlead',
    provider_message_id: String(leadResult?.upload_count || ''),
    provider_response: leadResult,
  });

  return { sent: true, channel: 'email', recipient: lead.email };
}

async function dispatchSms({ stateRow, step, lead, drip }) {
  const phone = lead.mobile || lead.phone;
  if (!phone) {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
      step_number: step.step_number, channel: 'sms',
      event_type: 'failed', recipient: '(none)',
      error_message: 'no_phone_on_lead',
    });
    return { blocked: true, reason: 'no_phone' };
  }

  const stormDate = drip.metadata?.storm_date || 'recently';
  const body = renderTemplate(step.body, lead, { storm_date: stormDate });

  const result = await sendSms({
    to: phone,
    body,
    lead_id: lead.id,
    drip_campaign_id: drip.id,
    drip_lead_state_id: stateRow.id,
    step_number: step.step_number,
    source: 'drip',
  });

  if (result.ok) return { sent: true, channel: 'sms', recipient: phone, twilio_sid: result.twilio_sid };
  return result;  // already has { blocked, reason } or { failed, error }
}

async function dispatchVoicemail({ stateRow, step, lead, drip }) {
  // Voicemail dispatch routes through our Lindy specialized agent
  // (jh-voicemail-dropper). It owns the Twilio voice integration +
  // ringless-VM capability that we don't have natively.
  const phone = lead.mobile || lead.phone;
  if (!phone) {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
      step_number: step.step_number, channel: 'voicemail',
      event_type: 'failed', recipient: '(none)',
      error_message: 'no_phone_on_lead',
    });
    return { blocked: true, reason: 'no_phone' };
  }

  // DNC + opt-out enforced before any voice contact
  const dnc = await dncCheck(phone);
  if (!dnc.safe_to_contact) {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
      step_number: step.step_number, channel: 'voicemail',
      event_type: 'failed', recipient: phone,
      error_message: 'dnc_blocked: ' + dnc.reason,
    });
    return { blocked: true, reason: 'dnc_blocked' };
  }

  // The Defcon-1 sequence's voicemail step body holds the SCRIPT to be
  // recorded ahead of time. The actual audio file URL lives in the
  // sequence step's `voicemail_audio_url` field (added when Charlie
  // records the message). If no audio URL is configured, we LOG-ONLY
  // (better than a silent fail OR a misleading "sent" event).
  const audioUrl = step.voicemail_audio_url || drip.metadata?.voicemail_audio_url || null;
  if (!audioUrl) {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
      step_number: step.step_number, channel: 'voicemail',
      event_type: 'failed', recipient: phone,
      body: renderTemplate(step.body, lead, { storm_date: drip.metadata?.storm_date || 'recently' }),
      error_message: 'no_voicemail_audio_url_configured — set step.voicemail_audio_url or drip.metadata.voicemail_audio_url',
    });
    return { blocked: true, reason: 'no_audio_url' };
  }

  // Dispatch via jh-voicemail-dropper Lindy agent
  let result;
  try {
    const { dropVoicemail } = await import('./lindy.js');
    result = await dropVoicemail({
      leads: [{ id: lead.id, phone, first_name: lead.first_name }],
      voicemail_audio_url: audioUrl,
      campaign: { id: drip.id },
      triggered_by: 'drip_cron',
    });
  } catch (err) {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
      step_number: step.step_number, channel: 'voicemail',
      event_type: 'failed', recipient: phone,
      provider: 'lindy_voicemail_dropper',
      error_message: 'lindy dispatch threw: ' + err.message,
    });
    return { failed: true, error: 'lindy_dispatch_failed: ' + err.message };
  }

  if (!result?.ok) {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
      step_number: step.step_number, channel: 'voicemail',
      event_type: 'failed', recipient: phone,
      provider: 'lindy_voicemail_dropper',
      error_message: result?.error || 'unknown_lindy_error',
    });
    return { failed: true, error: result?.error || 'unknown' };
  }

  await logTouch({
    drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
    step_number: step.step_number, channel: 'voicemail',
    event_type: 'sent', recipient: phone,
    body: renderTemplate(step.body, lead, { storm_date: drip.metadata?.storm_date || 'recently' }),
    provider: 'lindy_voicemail_dropper',
    provider_message_id: String(result.job_id || ''),
    provider_response: result,
  });
  return { sent: true, channel: 'voicemail', recipient: phone, lindy_job_id: result.job_id };
}

async function dispatchCall({ stateRow, step, lead, drip }) {
  // Voice calls go through jh-outbound-caller Lindy agent.
  const phone = lead.mobile || lead.phone;
  if (!phone) {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
      step_number: step.step_number, channel: 'call',
      event_type: 'failed', recipient: '(none)',
      error_message: 'no_phone_on_lead',
    });
    return { blocked: true, reason: 'no_phone' };
  }

  const dnc = await dncCheck(phone);
  if (!dnc.safe_to_contact) {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
      step_number: step.step_number, channel: 'call',
      event_type: 'failed', recipient: phone,
      error_message: 'dnc_blocked: ' + dnc.reason,
    });
    return { blocked: true, reason: 'dnc_blocked' };
  }

  let result;
  try {
    const { callLead } = await import('./lindy.js');
    result = await callLead({
      lead, campaign: null,
      storm_context: drip.metadata?.storm_date || null,
      triggered_by: 'drip_cron',
    });
  } catch (err) {
    return { failed: true, error: 'lindy_call_threw: ' + err.message };
  }

  if (!result?.ok) {
    await logTouch({
      drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
      step_number: step.step_number, channel: 'call',
      event_type: 'failed', recipient: phone,
      provider: 'lindy_outbound_caller',
      error_message: result?.error || 'unknown',
    });
    return { failed: true, error: result?.error || 'unknown' };
  }

  await logTouch({
    drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
    step_number: step.step_number, channel: 'call',
    event_type: 'sent', recipient: phone,
    provider: 'lindy_outbound_caller',
    provider_message_id: String(result.job_id || ''),
    provider_response: result,
  });
  return { sent: true, channel: 'call', recipient: phone, lindy_job_id: result.job_id };
}

// ----------------------------------------------------------------
// Smartlead campaign provisioning (lazy)
// ----------------------------------------------------------------
async function getOrCreateSmartleadCampaign({ drip, sequence }) {
  // Check existing
  const meta = drip.metadata || {};
  if (meta.smartlead_campaign_id) return meta.smartlead_campaign_id;

  // Create
  const created = await smartleadCreateCampaign({ name: `JH-${drip.id}-${drip.name}`.slice(0, 90) });
  const smartleadCampaignId = created?.id || created?.campaign_id;
  if (!smartleadCampaignId) throw new Error('smartlead create returned no id: ' + JSON.stringify(created).slice(0, 200));

  // Attach mailboxes (all of them by default — Smartlead rotates)
  try {
    const accts = await listEmailAccounts({ limit: 50 });
    const ids = (accts || []).map((a) => a.id || a.email_account_id).filter(Boolean);
    if (ids.length) await attachMailboxesToCampaign(smartleadCampaignId, ids);
  } catch (err) {
    console.warn('[drip-engine] mailbox attach failed:', err.message);
  }

  // Auto-register webhook so Smartlead events (open/click/reply/bounce/
  // unsubscribe) flow back to /api/webhooks/smartlead/event the moment
  // the campaign starts dispatching. Without this, opens + clicks are
  // tracked in Smartlead but never reach our drip_lead_state engagement
  // counters or PostHog timeline.
  try {
    const { createWebhook } = await import('./smartlead.js');
    const siteUrl = process.env.SITE_URL?.replace(/\/$/, '') || 'https://justhail.net';
    await createWebhook(smartleadCampaignId, {
      name: `JH-drip-${drip.id}-events`,
      url: `${siteUrl}/api/webhooks/smartlead/event`,
      event_types: [
        'EMAIL_SENT',
        'EMAIL_OPEN',
        'EMAIL_LINK_CLICK',
        'EMAIL_REPLY',
        'EMAIL_BOUNCE',
        'LEAD_UNSUBSCRIBED',
        'LEAD_CATEGORY_UPDATED',
      ],
    });
  } catch (err) {
    console.warn('[drip-engine] webhook auto-register failed:', err.message);
    // Don't fail the campaign creation — webhook can be added manually later
  }

  // (Each drip step is dispatched as a one-shot Smartlead enrollment so
  // OUR cron stays in control of timing + per-step validation gates.
  // Smartlead's role is sender pool + delivery + engagement tracking.
  // We do NOT pre-load multi-step sequences into Smartlead.)

  // Persist on the drip
  await supabase
    .from('drip_campaigns')
    .update({ metadata: { ...meta, smartlead_campaign_id: smartleadCampaignId } })
    .eq('id', drip.id);

  // Start the campaign so it's ready to accept leads
  try { await smartleadStart(smartleadCampaignId); } catch {}

  return smartleadCampaignId;
}

// ----------------------------------------------------------------
// State transitions
// ----------------------------------------------------------------
async function scheduleNextStep(stateRow, sequence, justSentStepNumber) {
  const nextStep = (sequence.steps || []).find((s) => s.step_number === justSentStepNumber + 1);
  if (!nextStep) {
    await markStateCompleted(stateRow.id);
    return;
  }
  const scheduledAt = new Date(Date.now() + (nextStep.delay_hours || 0) * 3600_000).toISOString();
  await supabase.from('drip_lead_state').update({
    current_step: justSentStepNumber,
    next_step: justSentStepNumber + 1,
    scheduled_at: scheduledAt,
    last_action_at: new Date().toISOString(),
    failure_count: 0,
  }).eq('id', stateRow.id);
}

async function markStateCompleted(stateId) {
  await supabase.from('drip_lead_state').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    scheduled_at: null,
  }).eq('id', stateId);
}

async function markStateOptedOut(stateId) {
  await supabase.from('drip_lead_state').update({
    status: 'opted_out',
    opted_out_at: new Date().toISOString(),
    scheduled_at: null,
  }).eq('id', stateId);
}

async function markStateFailed(stateId, reason) {
  await supabase.from('drip_lead_state').update({
    status: 'failed',
    last_failure: reason,
    scheduled_at: null,
  }).eq('id', stateId);
}

async function logTouch(row) {
  try {
    const { data } = await supabase.from('drip_touches').insert(row).select('id').single();
    return data?.id;
  } catch (err) {
    console.error('[drip-engine] logTouch failed:', err);
  }
}
