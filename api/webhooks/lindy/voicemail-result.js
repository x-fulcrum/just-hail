// POST /api/webhooks/lindy/voicemail-result
// ----------------------------------------------------------------
// Per-lead callback from jh-voicemail-dropper. Lindy hits this once
// per lead in the bulk drop list (not once for the whole batch).
//
// Expected payload:
//   {
//     lead_id:           number,
//     agent_name:        "jh-voicemail-dropper",
//     phone:             "+15125551234",
//     outcome:           "delivered" | "failed" | "opt_out_blocked" | "quiet_hours" | ...,
//     duration_seconds?: number,
//     twilio_call_sid?:  string,
//     error?:            string,
//     lindy_job_id?:     number   // refers to the parent batch dispatch
//   }

import { runReceiver, findLeadByPhone } from '../../../lib/lindy-webhook.js';
import { supabase } from '../../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  return runReceiver(req, res, async (p) => {
    let lead_id = p.lead_id || null;
    if (!lead_id && p.phone) {
      const found = await findLeadByPhone(p.phone);
      lead_id = found?.id ?? null;
    }

    const { data: row, error } = await supabase
      .from('call_logs')
      .insert({
        source: 'lindy_voicemail',
        agent_name: 'jh-voicemail-dropper',
        lead_id,
        campaign_id: p.campaign_id || null,
        twilio_call_sid: p.twilio_call_sid || null,
        from_number: process.env.TWILIO_PHONE_NUMBER || null,
        to_number: p.phone || null,
        duration_seconds: p.duration_seconds ?? null,
        outcome: p.outcome || 'unspecified',
        opt_out_flag: p.outcome === 'opt_out_blocked',
        summary: p.error || null,
        raw_payload: p,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[voicemail-result] insert failed:', error);
      return { call_log_id: null, db_error: error.message };
    }

    if (lead_id) {
      await supabase.from('leads').update({
        last_touched_at: new Date().toISOString(),
        last_channel: 'voicemail',
      }).eq('id', lead_id);
    }

    return { call_log_id: row?.id ?? null };
  });
}
