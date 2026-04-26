// POST /api/admin/lindy
// ----------------------------------------------------------------
// Single endpoint for dispatching any Lindy agent from the admin
// UI (or from the Strategist tool layer). Routes by `action` field:
//
//   { action: "call_lead",  lead_id }
//   { action: "text_lead",  lead_id, body? }
//   { action: "enrich",     lead_id }
//   { action: "voicemail",  campaign_id, voicemail_audio_url, lead_ids? }
//   { action: "storm_blast", campaign_id, storm_event_id? }
//   { action: "recap_now" }                      // manual trigger
//
// All actions return { ok, job_id, error? } so the UI can show a
// toast + link the call/sms record back to the action.

import { supabase } from '../../lib/supabase.js';
import {
  callLead,
  enrichLead,
  dropVoicemail,
  startStormBlast,
  dailyRecap,
  dispatchAgent,
} from '../../lib/lindy.js';

export const config = { api: { bodyParser: true }, maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    const action = String(body.action || '').toLowerCase();
    const triggered_by_user = (req.headers['x-admin-user'] || 'charlie').toString().slice(0, 60);

    switch (action) {
      // --------------------------------------------------------------
      case 'call_lead': {
        if (!body.lead_id) return res.status(400).json({ ok: false, error: 'lead_id required' });
        const { data: lead } = await supabase
          .from('leads')
          .select('id, first_name, mobile, phone, street, city, campaign_id, opted_out, status')
          .eq('id', body.lead_id)
          .single();
        if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });
        if (lead.opted_out) return res.status(400).json({ ok: false, error: 'lead opted out' });

        let campaign = null;
        if (lead.campaign_id) {
          const { data } = await supabase.from('campaigns').select('id, name').eq('id', lead.campaign_id).single();
          campaign = data;
        }

        const result = await callLead({
          lead,
          campaign,
          storm_context: body.storm_context || null,
          triggered_by: 'admin_ui',
          triggered_by_user,
        });
        return res.status(result.ok ? 200 : 500).json(result);
      }

      // --------------------------------------------------------------
      case 'text_lead': {
        if (!body.lead_id || !body.body) {
          return res.status(400).json({ ok: false, error: 'lead_id and body required' });
        }
        const { data: lead } = await supabase
          .from('leads')
          .select('id, first_name, mobile, phone, opted_out, status')
          .eq('id', body.lead_id)
          .single();
        if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });
        if (lead.opted_out) return res.status(400).json({ ok: false, error: 'lead opted out' });

        const peer = lead.mobile || lead.phone;
        if (!peer) return res.status(400).json({ ok: false, error: 'lead has no phone' });

        // Insert outbound sms_messages row first (so the UI sees it).
        const { data: smsRow, error: smsErr } = await supabase
          .from('sms_messages')
          .insert({
            direction: 'outbound',
            source: 'manual_admin',
            agent_name: null,
            lead_id: lead.id,
            peer_number: peer,
            our_number: process.env.TWILIO_PHONE_NUMBER || null,
            body: body.body,
            status: 'queued',
          })
          .select('id')
          .single();

        // Dispatch via the SMS-handler agent? No — for outbound-only we
        // bypass the bidirectional handler and just have it send.
        // Until we have a dedicated outbound-SMS agent in Lindy, we
        // queue the message in DB and return success. The agent layer
        // can poll/process. (Phase 2 task.)
        if (smsErr) {
          return res.status(500).json({ ok: false, error: 'db_insert_failed: ' + smsErr.message });
        }

        return res.status(200).json({
          ok: true,
          sms_id: smsRow.id,
          queued: true,
          note: 'Message queued. To send live, configure jh-outbound-sms agent or manual delivery.',
        });
      }

      // --------------------------------------------------------------
      case 'enrich': {
        if (!body.lead_id) return res.status(400).json({ ok: false, error: 'lead_id required' });
        const { data: lead } = await supabase
          .from('leads')
          .select('id, first_name, last_name, street, city, state, zip')
          .eq('id', body.lead_id)
          .single();
        if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });

        const result = await enrichLead({
          lead,
          triggered_by: 'admin_ui',
          triggered_by_user,
        });
        return res.status(result.ok ? 200 : 500).json(result);
      }

      // --------------------------------------------------------------
      case 'voicemail': {
        if (!body.campaign_id || !body.voicemail_audio_url) {
          return res.status(400).json({ ok: false, error: 'campaign_id and voicemail_audio_url required' });
        }
        let leadsQ = supabase
          .from('leads')
          .select('id, first_name, mobile, phone, opted_out')
          .eq('campaign_id', body.campaign_id)
          .eq('opted_out', false);
        if (Array.isArray(body.lead_ids) && body.lead_ids.length) {
          leadsQ = leadsQ.in('id', body.lead_ids.slice(0, 1000));
        }
        const { data: leads } = await leadsQ;
        if (!leads || !leads.length) return res.status(400).json({ ok: false, error: 'no leads in campaign' });

        const result = await dropVoicemail({
          leads,
          voicemail_audio_url: body.voicemail_audio_url,
          campaign: { id: Number(body.campaign_id) },
          triggered_by: 'admin_ui',
          triggered_by_user,
        });
        return res.status(result.ok ? 200 : 500).json({ ...result, lead_count: leads.length });
      }

      // --------------------------------------------------------------
      case 'storm_blast': {
        if (!body.campaign_id) return res.status(400).json({ ok: false, error: 'campaign_id required' });
        const { data: campaign } = await supabase
          .from('campaigns')
          .select('id, name, target_input, storm_event_id')
          .eq('id', body.campaign_id)
          .single();
        if (!campaign) return res.status(404).json({ ok: false, error: 'campaign not found' });

        const { data: leads } = await supabase
          .from('leads')
          .select('id, first_name, last_name, mobile, phone, email, street, opted_out')
          .eq('campaign_id', body.campaign_id)
          .eq('opted_out', false)
          .limit(500);
        if (!leads || !leads.length) return res.status(400).json({ ok: false, error: 'no leads' });

        let storm = null;
        if (body.storm_event_id || campaign.storm_event_id) {
          const { data } = await supabase
            .from('storm_events')
            .select('id, swath_size_in, detected_at, received_at, zip')
            .eq('id', body.storm_event_id || campaign.storm_event_id)
            .single();
          storm = data;
        }

        const result = await startStormBlast({
          storm,
          campaign,
          leads,
          triggered_by: 'admin_ui',
          triggered_by_user,
        });
        return res.status(result.ok ? 200 : 500).json({ ...result, lead_count: leads.length });
      }

      // --------------------------------------------------------------
      case 'recap_now': {
        // Manual trigger of the daily recap; the cron-driven version
        // builds richer stats but this is useful for testing.
        const stats = await buildRecapStats();
        const result = await dailyRecap({
          to_phone: body.to_phone || '+15122213013',
          stats,
          hot_lead_summaries: stats._hot_lead_summaries || [],
          triggered_by: 'admin_ui',
          triggered_by_user,
        });
        return res.status(result.ok ? 200 : 500).json(result);
      }

      // --------------------------------------------------------------
      default:
        return res.status(400).json({ ok: false, error: `unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[admin/lindy] error:', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}

// ----------------------------------------------------------------
// buildRecapStats — used by manual recap_now and the cron job.
// Returns the stats payload + hot-lead summaries, plus an internal
// `_hot_lead_summaries` array for dailyRecap().
// ----------------------------------------------------------------
export async function buildRecapStats() {
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString();

  const [calls, sms, leadsToday, hotPending, bookedTomorrow] = await Promise.all([
    supabase.from('call_logs').select('source, outcome', { count: 'exact' }).gte('created_at', dayAgo),
    supabase.from('sms_messages').select('direction, classification, hot_lead_flag', { count: 'exact' }).gte('created_at', dayAgo),
    supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', dayAgo),
    supabase.from('sms_messages').select('id, lead_id, body').eq('hot_lead_flag', true).gte('created_at', dayAgo).limit(5),
    supabase.from('call_logs').select('id', { count: 'exact', head: true }).eq('booked_inspection', true).gte('booked_slot_at', new Date().toISOString()).lte('booked_slot_at', tomorrow),
  ]);

  // Reduce calls
  const cRows = calls.data || [];
  const inboundCalls = cRows.filter((r) => r.source === 'lindy_inbound').length;
  const outboundCalls = cRows.filter((r) => r.source === 'lindy_outbound').length;
  const voicemailsLeft = cRows.filter((r) => r.outcome === 'voicemail_left' || r.source === 'lindy_voicemail').length;
  const answered = cRows.filter((r) => r.outcome?.startsWith('answered')).length;

  // Reduce sms
  const sRows = sms.data || [];
  const smsThreadsActive = new Set(sRows.map((r) => r.lead_id)).size;
  const hotReplies = sRows.filter((r) => r.hot_lead_flag).length;

  const hotLeadSummaries = [];
  for (const r of (hotPending.data || [])) {
    if (r.lead_id) {
      const { data: l } = await supabase
        .from('leads')
        .select('first_name, street')
        .eq('id', r.lead_id)
        .single();
      if (l) hotLeadSummaries.push({ name: l.first_name || 'Unknown', street: l.street || '', what_they_said: (r.body || '').slice(0, 200) });
    }
  }

  return {
    inbound_calls_today: inboundCalls,
    inbound_calls_answered_by_lindy: answered,
    inbound_calls_voicemail: cRows.filter((r) => r.outcome === 'voicemail').length,
    outbound_calls_made: outboundCalls,
    outbound_voicemails_left: voicemailsLeft,
    outbound_answered: cRows.filter((r) => r.source === 'lindy_outbound' && r.outcome?.startsWith('answered')).length,
    sms_threads_active: smsThreadsActive,
    hot_replies_pending: hotReplies,
    inspections_booked: cRows.filter((r) => r.outcome?.includes('booked')).length,
    inspections_tomorrow: bookedTomorrow.count || 0,
    estimates_sent_today: 0,
    estimates_accepted_today: 0,
    new_leads_today: leadsToday.count || 0,
    anomalies: [],
    _hot_lead_summaries: hotLeadSummaries,
  };
}
