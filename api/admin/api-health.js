// GET /api/admin/api-health
// ----------------------------------------------------------------
// Reads the latest api_health row per service. The cron writes;
// this only reads. Cached at the edge for 30s.

import { supabase } from '../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 10 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  try {
    const { data } = await supabase
      .from('api_health')
      .select('*')
      .order('service');
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ ok: true, services: data || [], fetched_at: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
