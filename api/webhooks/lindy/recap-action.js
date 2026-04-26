// POST /api/webhooks/lindy/recap-action
// ----------------------------------------------------------------
// Receives the result of the daily 6pm recap call to Charlie.
// Records the call and any actions Charlie asked the bot to
// dispatch (e.g. "call Phillip back" → POST to outbound caller).
//
// Expected payload:
//   {
//     lindy_job_id:        number,
//     to_phone:            "+15122213013",
//     duration_seconds?:   number,
//     summary:             string,
//     transcript_or_messages?: array,
//     answered:            boolean,
//     charlie_requests?: [
//       { action: "call_lead", lead_id: 123, note: "..." },
//       { action: "text_lead", lead_id: 124, body: "..." },
//       ...
//     ]
//   }

import { runReceiver } from '../../../lib/lindy-webhook.js';
import { supabase } from '../../../lib/supabase.js';
import { callLead } from '../../../lib/lindy.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  return runReceiver(req, res, async (p) => {
    // Log the call itself
    await supabase
      .from('call_logs')
      .insert({
        source: 'lindy_recap',
        agent_name: 'jh-recap-caller',
        from_number: process.env.TWILIO_PHONE_NUMBER || null,
        to_number: p.to_phone || '+15122213013',
        duration_seconds: p.duration_seconds ?? null,
        outcome: p.answered ? 'delivered' : 'no_answer',
        summary: p.summary || null,
        transcript: Array.isArray(p.transcript_or_messages) ? p.transcript_or_messages : null,
        raw_payload: p,
      });

    // Process Charlie's follow-up requests (max 5 per recap to be safe)
    const requests = Array.isArray(p.charlie_requests) ? p.charlie_requests.slice(0, 5) : [];
    const dispatched = [];
    for (const r of requests) {
      try {
        if (r.action === 'call_lead' && r.lead_id) {
          const { data: lead } = await supabase
            .from('leads')
            .select('id, first_name, mobile, phone, street, city')
            .eq('id', r.lead_id)
            .single();
          if (lead) {
            const result = await callLead({
              lead,
              storm_context: r.note || null,
              triggered_by: 'recap-call',
              triggered_by_user: 'charlie',
            });
            dispatched.push({ action: 'call_lead', lead_id: r.lead_id, job_id: result.job_id, ok: result.ok });
          }
        }
        // Future: add text_lead and other actions here.
      } catch (e) {
        dispatched.push({ action: r.action, error: e.message });
      }
    }

    return { dispatched_count: dispatched.length, dispatched };
  });
}
