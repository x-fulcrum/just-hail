// POST /api/webhooks/lindy/classifier
// ----------------------------------------------------------------
// Receives the classification output from jh-reply-classifier.
// jh-reply-classifier is unique: per its system prompt it returns
// the JSON SYNCHRONOUSLY in its HTTP response, not via callback.
// We still expose this endpoint as a fallback so Lindy can callback
// if its sync mode is disabled.
//
// Expected payload:
//   {
//     lindy_job_id?:       number,
//     lead_id?:            number,
//     classification:      "HOT" | "WARM" | "QUESTION" | "AUTO_REPLY" | "OPT_OUT" | "WRONG_PERSON",
//     confidence:          0.0-1.0,
//     reasoning:           string,
//     suggested_next_action: string,
//     extracted_data?:     object,
//     reply_message_id?:   number  // sms_messages.id this was classifying
//   }

import { runReceiver } from '../../../lib/lindy-webhook.js';
import { supabase } from '../../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  return runReceiver(req, res, async (p) => {
    const cls = p.classification || null;

    // If we know which sms_messages row this classification was for,
    // backfill the classification + flags on that row.
    if (p.reply_message_id) {
      await supabase
        .from('sms_messages')
        .update({
          classification: cls,
          hot_lead_flag: cls === 'HOT',
          opt_out_flag: cls === 'OPT_OUT',
        })
        .eq('id', p.reply_message_id);
    }

    // Update the lead status to reflect the classification.
    if (p.lead_id) {
      const updates = { last_touched_at: new Date().toISOString() };
      if (cls === 'OPT_OUT') {
        updates.opted_out = true;
        updates.status = 'do_not_contact';
      } else if (cls === 'HOT') {
        updates.status = 'engaged';
      } else if (cls === 'WARM' || cls === 'QUESTION') {
        updates.status = 'contacted';
      } else if (cls === 'WRONG_PERSON') {
        updates.status = 'closed_lost';
      }
      await supabase.from('leads').update(updates).eq('id', p.lead_id);
    }

    return { classification: cls };
  });
}
