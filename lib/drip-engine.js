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
  setCampaignSchedule,
  startCampaign as smartleadStart,
  listEmailAccounts,
  getCampaignStatistics as smartleadGetStatistics,
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
  // Pull leads in chunks — `.in()` works fine up to ~10k IDs but big
  // queries are paginated for safety. Charlie's polygons can hold 1300+
  // leads so the old 1000-cap was silently dropping ~25% of enrollments.
  const idChunks = [];
  for (let i = 0; i < lead_ids.length; i += 500) {
    idChunks.push(lead_ids.slice(i, i + 500));
  }
  const leadsAcc = [];
  for (const chunk of idChunks) {
    const { data: chunkRows } = await supabase
      .from('leads')
      .select('id, first_name, last_name, email, phone, mobile, street, city, state, zip, opted_out, status')
      .in('id', chunk);
    if (chunkRows) leadsAcc.push(...chunkRows);
  }
  const leads = leadsAcc;

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
      drip_campaigns!inner ( id, status, max_daily_dispatches, sequence_id, name, metadata ),
      leads!inner ( id, first_name, last_name, email, phone, mobile, street, city, state, zip, opted_out )
    `)
    .eq('status', 'active')
    .lte('scheduled_at', nowIso)
    .limit(MAX_PER_TICK);

  if (error) return { ok: false, error: error.message };
  if (!due || !due.length) {
    // No new dispatches needed, but still run the engagement sync so
    // sent/open/click/reply counters keep climbing without depending
    // on Smartlead's flaky webhook delivery.
    let syncStats = null;
    try { syncStats = await syncSmartleadEngagement(); } catch (err) {
      return { ok: true, processed: 0, message: 'no due actions', engagement_sync_error: err.message };
    }
    return { ok: true, processed: 0, message: 'no due actions', engagement_synced: syncStats };
  }

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

  // ── Engagement sync ──
  // Smartlead's webhook delivery has been unreliable — we register the
  // webhook on every step's campaign but events sometimes don't fire
  // back. Poll their /statistics endpoint as the source of truth and
  // reconcile any sent/open/click/reply touches we're missing.
  // Idempotent: NOT EXISTS guards prevent dupes.
  let syncStats = null;
  try {
    syncStats = await syncSmartleadEngagement();
    results.engagement_synced = syncStats;
  } catch (err) {
    console.warn('[drip-engine] engagement sync failed:', err.message);
    results.engagement_sync_error = err.message;
  }

  return { ok: true, ...results };
}

// ----------------------------------------------------------------
// syncSmartleadEngagement — pull /statistics for every active drip
// campaign and reconcile drip_touches with Smartlead's truth. Catches
// sent/open/click/reply events that the webhook missed.
// ----------------------------------------------------------------
export async function syncSmartleadEngagement() {
  // Find every active drip + the Smartlead campaign IDs it uses
  const { data: drips } = await supabase
    .from('drip_campaigns')
    .select('id, metadata')
    .in('status', ['active', 'enrolling']);

  let inserted = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
  for (const drip of (drips || [])) {
    const byStep = drip.metadata?.smartlead_campaign_by_step || {};
    for (const [stepNum, smartleadId] of Object.entries(byStep)) {
      let stats;
      try { stats = await smartleadGetStatistics(smartleadId, { limit: 500 }); }
      catch (err) { console.warn(`[sync] stats fetch ${smartleadId} failed:`, err.message); continue; }

      const rows = (stats?.data || []).filter(r => r.lead_email);
      if (!rows.length) continue;

      // Batch resolve: lookup drip_lead_state.id for every lead_email in this campaign
      const emails = [...new Set(rows.map(r => r.lead_email.toLowerCase()))];
      const { data: leads } = await supabase
        .from('leads')
        .select('id, email')
        .in('email', emails);

      const leadByEmail = new Map();
      for (const l of (leads || [])) leadByEmail.set((l.email || '').toLowerCase(), l.id);

      const leadIds = [...leadByEmail.values()];
      if (!leadIds.length) continue;

      const { data: states } = await supabase
        .from('drip_lead_state')
        .select('id, lead_id')
        .eq('drip_campaign_id', drip.id)
        .in('lead_id', leadIds);

      const stateByLead = new Map();
      for (const s of (states || [])) stateByLead.set(s.lead_id, s.id);

      // Pull existing touches for these leads in one query so we can
      // dedupe in memory rather than per-lead round-tripping.
      const stateIds = [...stateByLead.values()];
      const { data: existing } = await supabase
        .from('drip_touches')
        .select('drip_lead_state_id, event_type')
        .in('drip_lead_state_id', stateIds)
        .eq('channel', 'email')
        .in('event_type', ['sent','opened','clicked','replied','bounced']);

      const seen = new Set();
      for (const e of (existing || [])) seen.add(`${e.drip_lead_state_id}:${e.event_type}`);

      const toInsert = [];
      for (const r of rows) {
        const leadId = leadByEmail.get(r.lead_email.toLowerCase());
        const stateId = leadId ? stateByLead.get(leadId) : null;
        if (!stateId) continue;

        const push = (event_type, when, extra = {}) => {
          if (!when) return;
          if (seen.has(`${stateId}:${event_type}`)) return;
          seen.add(`${stateId}:${event_type}`);
          toInsert.push({
            created_at: new Date(when).toISOString(),
            drip_campaign_id: drip.id,
            lead_id: leadId,
            drip_lead_state_id: stateId,
            step_number: parseInt(stepNum, 10),
            channel: 'email',
            event_type,
            recipient: r.lead_email,
            sender: r.email_account_email || r.from_email || null,
            provider: 'smartlead',
            metadata: { source: 'sync_from_statistics', smartlead_campaign_id: smartleadId, ...extra },
          });
          inserted[event_type]++;
        };

        push('sent',    r.sent_time);
        push('opened',  r.open_time);
        push('clicked', r.click_time);
        push('replied', r.reply_time, { reply_body: r.reply_message });
        if (r.bounced) push('bounced', r.bounce_time || r.sent_time);
      }

      if (toInsert.length) {
        // Insert in batches of 100 to stay within URL/payload limits
        for (let i = 0; i < toInsert.length; i += 100) {
          await supabase.from('drip_touches').insert(toInsert.slice(i, i + 100));
        }
      }
    }
  }
  return inserted;
}

// ----------------------------------------------------------------
// leadCanReceive — does this lead have the contact method needed
// for a given channel? Used to skip past channel-incompatible steps.
// ----------------------------------------------------------------
function leadCanReceive(channel, lead) {
  if (!lead) return false;
  if (channel === 'email')                      return !!lead.email;
  if (channel === 'sms' || channel === 'voicemail' || channel === 'call')
    return !!(lead.mobile || lead.phone);
  return true;  // unknown channel — let the dispatcher decide
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
    // Hard opt-out signals → mark and stop the lead entirely
    if (['lead_opted_out', 'dnc_blocked', 'on_dnc_list'].includes(dispatchResult.reason)) {
      await markStateOptedOut(stateId);
      return { blocked: true, ...dispatchResult };
    }

    // Channel-incompatible (no email for an email step, no phone for an
    // SMS/voicemail/call step) → jump to the next compatible step instead
    // of looping. Otherwise the cron picks them up every tick and burns
    // cycles forever, OR (worse) waits 48h to retry an obviously-broken
    // email step. If no compatible step remains, mark completed.
    if (['no_email', 'no_phone'].includes(dispatchResult.reason)) {
      const remaining = (seq.steps || []).filter((s) => s.step_number > step.step_number);
      const target = remaining.find((s) => leadCanReceive(s.channel, lead));
      if (!target) {
        await markStateCompleted(stateId);
        return { blocked: true, completed: true, ...dispatchResult };
      }
      const scheduledAt = new Date(Date.now() + (target.delay_hours || 0) * 3600_000).toISOString();
      await supabase.from('drip_lead_state').update({
        current_step: target.step_number - 1,
        next_step:    target.step_number,
        scheduled_at: scheduledAt,
        last_action_at: new Date().toISOString(),
        failure_count: 0,
      }).eq('id', stateId);
      return { blocked: true, advanced_to_step: target.step_number, ...dispatchResult };
    }

    // Bouncer flagged email undeliverable / quality-hold — already handled
    // upstream (status updated to 'bounced_out' or 'paused'). Just return.
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

  // Render content (Smartlead's templating supports our {{first_name}},
  // {{street}} etc. via custom_fields, but we render server-side too so
  // the touch log shows the actual personalized body for audit/timeline.)
  const stormDate = drip.metadata?.storm_date || 'recently';
  const subject = renderTemplate(step.subject, lead, { storm_date: stormDate });
  const body = renderTemplate(step.body, lead, { storm_date: stormDate });

  // Get-or-create the per-step Smartlead campaign (creates + attaches
  // mailboxes + pushes sequence + starts on first call). Idempotent
  // via drip.metadata.smartlead_campaign_by_step keyed by step number.
  let smartleadCampaignId;
  try {
    smartleadCampaignId = await getOrCreateSmartleadCampaignForStep({ drip, step: { ...step, subject, body } });
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

  // Log as 'queued' — Smartlead has accepted the lead, but the actual
  // email goes out when Smartlead's scheduler fires it (subject to the
  // 15/day per-mailbox cap). The EMAIL_SENT webhook will insert the
  // 'sent' touch when delivery actually happens, with the from_email
  // captured into `sender` so we know which mailbox handled it.
  await logTouch({
    drip_campaign_id: drip.id, lead_id: lead.id, drip_lead_state_id: stateRow.id,
    step_number: step.step_number, channel: 'email',
    event_type: 'queued', recipient: lead.email, sender: '(smartlead pool)',
    subject, body,
    provider: 'smartlead',
    provider_message_id: String(leadResult?.upload_count || ''),
    provider_response: leadResult,
    metadata: { smartlead_campaign_id: smartleadCampaignId },
  });

  // For dispatchTouch's accounting we still treat 'queued' as sent=true
  // (handed off successfully). It won't bump emails_sent (the trigger
  // only counts event_type='sent'), but it WILL advance the lead to
  // the next step on schedule.
  return { sent: true, channel: 'email', recipient: lead.email, queued: true };
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
// Smartlead campaign provisioning — one campaign PER (drip × step)
// ----------------------------------------------------------------
// Why per-step? OUR cron owns timing + per-step validation gates
// (Bouncer recheck, DNC, opt-out). Smartlead's role is just sender
// pool + delivery + engagement tracking. So each step has its own
// Smartlead campaign with that step's subject+body baked in as the
// sequence; no follow-ups inside Smartlead — we add the lead, it
// fires once, we move on.
//
// Idempotent: caches per-step IDs in drip.metadata.smartlead_campaign_by_step
// so we don't re-create on every dispatch (the bug that built up
// 95 empty draft campaigns).
// ----------------------------------------------------------------
async function getOrCreateSmartleadCampaignForStep({ drip, step }) {
  const meta = drip.metadata || {};
  const byStep = meta.smartlead_campaign_by_step || {};
  const cached = byStep[String(step.step_number)];
  if (cached) return cached;

  // 1. Create
  const created = await smartleadCreateCampaign({
    name: `JH-${drip.id}-step${step.step_number}-${(drip.name || '').slice(0, 60)}`,
  });
  const smartleadCampaignId = created?.id || created?.campaign_id;
  if (!smartleadCampaignId) {
    throw new Error('smartlead create returned no id: ' + JSON.stringify(created).slice(0, 200));
  }

  // 2. Attach mailboxes (all configured senders, Smartlead round-robins)
  try {
    const accts = await listEmailAccounts({ limit: 50 });
    const ids = (accts || []).map((a) => a.id || a.email_account_id).filter(Boolean);
    if (ids.length) await attachMailboxesToCampaign(smartleadCampaignId, ids);
    else console.warn('[drip-engine] no mailboxes available to attach');
  } catch (err) {
    console.warn('[drip-engine] mailbox attach failed:', err.message);
  }

  // 3. Push the sequence (THIS step's subject + body, no follow-ups).
  //    Smartlead requires at least one sequence step before it'll send.
  //    Without this, the campaign sits in DRAFT forever.
  try {
    const htmlBody = (step.body || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    await updateCampaignSequence(smartleadCampaignId, [{
      seq_number: 1,
      seq_delay_details: { delay_in_days: 0 },
      variant_distribution_type: 'MANUAL_EQUAL',
      seq_variants: [{
        subject: step.subject || '(no subject)',
        email_body: htmlBody,
        variant_label: 'A',
      }],
    }]);
  } catch (err) {
    console.warn('[drip-engine] sequence push failed:', err.message);
    throw new Error('sequence push failed: ' + err.message);
  }

  // 4. Register engagement webhook
  try {
    const { createWebhook } = await import('./smartlead.js');
    const siteUrl = process.env.SITE_URL?.replace(/\/$/, '') || 'https://justhail.net';
    await createWebhook(smartleadCampaignId, {
      name: `JH-drip-${drip.id}-step${step.step_number}-events`,
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
  }

  // 5. Set schedule — REQUIRED. Without this, smartleadStart errors with
  //    "Cron Exp value is empty! Please set the scheduler time and start
  //    the campaign!" and the campaign sits in DRAFT forever (the bug
  //    that built up 95+ stranded campaigns). Mon-Fri 9am-5pm Central
  //    matches Charlie's typical operating hours.
  try {
    await setCampaignSchedule(smartleadCampaignId, {
      timezone: 'America/Chicago',
      days_of_the_week: [1, 2, 3, 4, 5],
      start_hour: '09:00',
      end_hour: '17:00',
      min_time_btw_emails: 20,
      max_new_leads_per_day: 45,
    });
  } catch (err) {
    console.warn('[drip-engine] smartlead schedule failed:', err.message);
    throw new Error('smartlead schedule: ' + err.message);
  }

  // 7. Start the campaign — required for Smartlead to actually dispatch.
  //    A failure here is FATAL: leads added to a DRAFT campaign sit
  //    untouched forever. Throw so dispatchEmail returns failed and
  //    retries on the next tick rather than persisting a stale ID.
  try {
    const startRes = await smartleadStart(smartleadCampaignId);
    if (startRes?.error || startRes?.statusCode >= 400) {
      throw new Error('smartlead start: ' + JSON.stringify(startRes).slice(0, 200));
    }
  } catch (err) {
    console.warn('[drip-engine] smartlead start failed:', err.message);
    throw err;
  }

  // 8. Persist the new campaign id keyed by step number
  await supabase
    .from('drip_campaigns')
    .update({
      metadata: {
        ...meta,
        smartlead_campaign_by_step: {
          ...byStep,
          [String(step.step_number)]: smartleadCampaignId,
        },
      },
    })
    .eq('id', drip.id);

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
