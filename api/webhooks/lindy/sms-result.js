// POST /api/webhooks/lindy/sms-result
// ----------------------------------------------------------------
// Receives every SMS message processed by jh-sms-handler. Lindy
// fires this for both inbound (from the lead) AND outbound (from
// our bot). Direction tells us which.
//
// Universal rule #10 expects this to be hit per-message in a thread.
//
// Expected payload:
//   {
//     direction:           "inbound" | "outbound",
//     agent_name:          "jh-sms-handler",
//     peer_number:         "+15125551234",   // the lead's number
//     our_number?:         "+17372411656",
//     body:                "the message text",
//     twilio_message_sid?: string,
//     status?:             "queued" | "sent" | "delivered" | "failed" | "received",
//     lead_id?:            number,
//     opt_out_flag?:       boolean,
//     hot_lead_flag?:      boolean,
//     thread_outcome?:     "booked" | "info_given" | "bad_number" | "opt_out" | null,
//     classification?:     "HOT" | "WARM" | "QUESTION" | "AUTO_REPLY" | "OPT_OUT" | "WRONG_PERSON",
//     lindy_job_id?:       number  // not usually set since SMS is Twilio-direct
//   }

import { runReceiver, findLeadByPhone } from '../../../lib/lindy-webhook.js';
import { supabase } from '../../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  return runReceiver(req, res, async (p) => {
    const direction = p.direction === 'outbound' ? 'outbound' : 'inbound';

    let lead_id = p.lead_id || null;
    if (!lead_id && p.peer_number) {
      const found = await findLeadByPhone(p.peer_number);
      lead_id = found?.id ?? null;
    }

    const { data: row, error } = await supabase
      .from('sms_messages')
      .insert({
        direction,
        source: 'lindy',
        agent_name: 'jh-sms-handler',
        lead_id,
        campaign_id: p.campaign_id || null,
        peer_number: p.peer_number || null,
        our_number: p.our_number || process.env.TWILIO_PHONE_NUMBER || null,
        body: p.body || '',
        twilio_message_sid: p.twilio_message_sid || null,
        status: p.status || (direction === 'inbound' ? 'received' : 'sent'),
        classification: p.classification || null,
        hot_lead_flag: !!p.hot_lead_flag,
        opt_out_flag: !!p.opt_out_flag,
        raw_payload: p,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[sms-result] insert failed:', error);
      return { sms_id: null, db_error: error.message };
    }

    // Lead-side state changes
    if (lead_id) {
      const updates = {
        last_touched_at: new Date().toISOString(),
        last_channel: 'sms',
      };
      if (p.opt_out_flag || p.thread_outcome === 'opt_out' || p.classification === 'OPT_OUT') {
        updates.opted_out = true;
        updates.status = 'do_not_contact';
      } else if (p.thread_outcome === 'booked') {
        updates.status = 'booked';
      } else if (p.hot_lead_flag || p.classification === 'HOT') {
        updates.status = 'engaged';
      }
      await supabase.from('leads').update(updates).eq('id', lead_id);
    }

    return { sms_id: row?.id ?? null };
  });
}
