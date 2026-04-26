// POST /api/webhooks/lindy/call-result
// ----------------------------------------------------------------
// Receives the call summary from jh-receptionist (inbound calls)
// and jh-outbound-caller (outbound calls). One row per call leg
// goes into call_logs. Hot leads + bookings update the leads row.
//
// Expected payload (universal rule #10):
//   {
//     lead_id?:           number,
//     agent_name:         "jh-receptionist" | "jh-outbound-caller",
//     outcome:            string,
//     summary:            string,
//     transcript_or_messages?: array | string,
//     next_action_recommended?: string,
//     opt_out_flag?:      boolean,
//     hot_lead_flag?:     boolean,
//     booked?:            boolean,
//     booked_slot_at?:    ISO timestamp,
//     twilio_call_sid?:   string,
//     from_number?:       string,
//     to_number?:         string,
//     duration_seconds?:  number,
//     started_at?:        ISO timestamp,
//     ended_at?:          ISO timestamp,
//     recording_url?:     string,
//     lindy_job_id?:      number   // for outbound, set automatically
//   }

import { runReceiver, findLeadByPhone } from '../../../lib/lindy-webhook.js';
import { supabase } from '../../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  return runReceiver(req, res, async (p) => {
    const agent = p.agent_name || (p.lindy_job_id ? 'jh-outbound-caller' : 'jh-receptionist');
    const isOutbound = agent === 'jh-outbound-caller';
    const isReceptionist = agent === 'jh-receptionist';

    // Resolve lead — payload first, fall back to phone lookup.
    let lead_id = p.lead_id || null;
    if (!lead_id && (p.from_number || p.to_number)) {
      const phone = isOutbound ? p.to_number : p.from_number;
      const found = await findLeadByPhone(phone);
      lead_id = found?.id ?? null;
    }

    const transcriptArr =
      Array.isArray(p.transcript_or_messages) ? p.transcript_or_messages :
      Array.isArray(p.transcript)             ? p.transcript :
      typeof p.transcript_or_messages === 'string'
        ? [{ role: 'system', text: p.transcript_or_messages }]
        : null;

    // Insert call log
    const { data: row, error } = await supabase
      .from('call_logs')
      .insert({
        source: isOutbound ? 'lindy_outbound' : 'lindy_inbound',
        agent_name: agent,
        lead_id,
        campaign_id: p.campaign_id || null,
        twilio_call_sid: p.twilio_call_sid || null,
        from_number: p.from_number || null,
        to_number: p.to_number || null,
        duration_seconds: p.duration_seconds ?? null,
        started_at: p.started_at || null,
        ended_at: p.ended_at || null,
        outcome: p.outcome || (isReceptionist ? 'answered_unspecified' : 'unspecified'),
        hot_lead_flag: !!p.hot_lead_flag,
        opt_out_flag: !!p.opt_out_flag,
        booked_inspection: !!p.booked,
        booked_slot_at: p.booked_slot_at || null,
        summary: p.summary || null,
        transcript: transcriptArr,
        recording_url: p.recording_url || null,
        raw_payload: p,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[call-result] insert failed:', error);
      return { call_log_id: null, db_error: error.message };
    }

    // Side-effects on the lead
    if (lead_id) {
      const updates = {
        last_touched_at: new Date().toISOString(),
        last_channel: 'voice',
      };
      if (p.opt_out_flag) {
        updates.opted_out = true;
        updates.status = 'do_not_contact';
      } else if (p.booked) {
        updates.status = 'booked';
      } else if (p.hot_lead_flag) {
        updates.status = 'engaged';
      }
      await supabase.from('leads').update(updates).eq('id', lead_id);
    }

    return { call_log_id: row?.id ?? null };
  });
}
