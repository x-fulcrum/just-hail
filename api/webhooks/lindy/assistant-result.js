// POST /api/webhooks/lindy/assistant-result
// ----------------------------------------------------------------
// Callback receiver for jh-assistant (the bridge agent). Anything
// the Strategist or admin UI delegates to the assistant comes back
// through here.
//
// Expected payload (per the bridge agent's system prompt):
//   {
//     lindy_job_id:   number,    // injected by us on dispatch
//     thread_id?:     string,
//     ok:             boolean,
//     summary:        string,    // 1-2 sentence summary of what was done
//     result:         any,       // structured output (lead update, draft, etc)
//     transcript?:    string,    // human-readable trace if useful
//     side_effects?:  array,     // ["sent_sms", "added_calendar_event", ...]
//     error?:         string,
//   }
//
// We persist into lindy_jobs.callback_payload via markCallbackReceived()
// in the shared runner. We ALSO write a row into a lightweight
// `assistant_threads` table (created lazily inside metadata for now)
// so the admin chat UI can replay history.

import { runReceiver } from '../../../lib/lindy-webhook.js';
import { supabase } from '../../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  return runReceiver(req, res, async (p) => {
    // If the assistant booked an inspection, marked an opt-out, or
    // changed lead state, propagate those as side-effects.
    const sideEffects = Array.isArray(p.side_effects) ? p.side_effects : [];

    // If the assistant references a lead, log the touch.
    const leadId = p.lead_id || p.context?.lead_id || null;
    if (leadId) {
      const updates = { last_touched_at: new Date().toISOString(), last_channel: 'lindy_assistant' };
      if (sideEffects.includes('opt_out'))         { updates.opted_out = true; updates.status = 'do_not_contact'; }
      else if (sideEffects.includes('booked'))     { updates.status = 'booked'; }
      else if (sideEffects.includes('hot_lead'))   { updates.status = 'engaged'; }
      await supabase.from('leads').update(updates).eq('id', leadId);
    }

    return {
      acknowledged: true,
      ok: !!p.ok,
      summary_first_chars: (p.summary || '').slice(0, 80),
      side_effects_count: sideEffects.length,
    };
  });
}
