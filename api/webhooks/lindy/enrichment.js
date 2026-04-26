// POST /api/webhooks/lindy/enrichment
// ----------------------------------------------------------------
// Receives output from jh-enricher. Writes a row to
// enrichment_results and (optionally) backfills useful fields onto
// the lead row itself (estimated_home_value, year_built, etc).
//
// Expected payload (from agent prompt):
//   {
//     lead_id:            number,
//     appraisal:          { owner, value, year_built, square_feet?, raw? },
//     social_signals:     [ { platform, url, snippet, posted_at? }, ... ],
//     news_signals:       [ { url, headline, date }, ... ],
//     hoa:                "Sutton Place HOA" | null,
//     enrichment_summary: string,
//     lindy_job_id?:      number
//   }

import { runReceiver } from '../../../lib/lindy-webhook.js';
import { supabase } from '../../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  return runReceiver(req, res, async (p) => {
    if (!p.lead_id) {
      return { error: 'missing_lead_id' };
    }

    const a = p.appraisal || {};
    const lindyJobId = p.lindy_job_id || null;

    const { data: row, error } = await supabase
      .from('enrichment_results')
      .insert({
        lead_id: p.lead_id,
        lindy_job_id: lindyJobId,
        appraisal_owner: a.owner || null,
        appraisal_value: numOrNull(a.value),
        appraisal_year_built: numOrNull(a.year_built),
        appraisal_square_feet: numOrNull(a.square_feet),
        appraisal_raw: a.raw || a || null,
        social_signals: p.social_signals || null,
        news_signals: p.news_signals || null,
        hoa_name: p.hoa || p.hoa_name || null,
        enrichment_summary: p.enrichment_summary || null,
        raw_payload: p,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[enrichment] insert failed:', error);
      return { enrichment_id: null, db_error: error.message };
    }

    // Backfill the lead row with property facts when present.
    const leadUpdates = {};
    if (a.value)        leadUpdates.estimated_home_value = numOrNull(a.value);
    if (a.year_built)   leadUpdates.year_built          = numOrNull(a.year_built);
    if (a.square_feet)  leadUpdates.square_feet         = numOrNull(a.square_feet);
    if (Object.keys(leadUpdates).length) {
      await supabase.from('leads').update(leadUpdates).eq('id', p.lead_id);
    }

    return { enrichment_id: row?.id ?? null };
  });
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
