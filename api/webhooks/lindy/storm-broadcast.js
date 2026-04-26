// POST /api/webhooks/lindy/storm-broadcast
// ----------------------------------------------------------------
// Receives the master summary from jh-storm-broadcaster after it
// has fanned out into voice + voicemail + email tiers. Per-lead
// outcomes still come back via call-result / voicemail-result.
//
// Expected payload:
//   {
//     storm_event_id:       number,
//     lindy_job_id:         number,
//     campaign_id?:         number,
//     summary:              string,
//     tiers: {
//       voice_calls:        number,
//       voicemail_drops:    number,
//       email_only:         number,
//       skipped:            number
//     },
//     dispatched_at:        ISO timestamp,
//     finished_at?:         ISO timestamp,
//     errors?:              array
//   }

import { runReceiver } from '../../../lib/lindy-webhook.js';
import { supabase } from '../../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  return runReceiver(req, res, async (p) => {
    // Stamp the campaign with stats from the broadcast.
    if (p.campaign_id) {
      const tiers = p.tiers || {};
      const merged = {
        broadcast_summary: p.summary || null,
        broadcast_tiers: tiers,
        broadcast_finished_at: p.finished_at || new Date().toISOString(),
        broadcast_errors: p.errors || null,
      };

      // Store inside campaign metadata so we don't need new columns.
      const { data: existing } = await supabase
        .from('campaigns')
        .select('metadata')
        .eq('id', p.campaign_id)
        .single();
      const newMeta = { ...(existing?.metadata || {}), ...merged };

      await supabase
        .from('campaigns')
        .update({
          metadata: newMeta,
          status: 'outreach_in_progress',
        })
        .eq('id', p.campaign_id);
    }

    return { acknowledged: true };
  });
}
