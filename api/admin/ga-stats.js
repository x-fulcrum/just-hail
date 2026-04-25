// GET /api/admin/ga-stats
// ----------------------------------------------------------------
// Returns the dashboard summary used by the admin GA4 widget.
// Cached at the edge for 60s so we don't burn through API quota
// when multiple browser tabs poll.

import { getDashboardSummary } from '../../lib/ga.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const data = await getDashboardSummary();
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ ok: true, data, fetched_at: new Date().toISOString() });
  } catch (err) {
    console.error('[ga-stats]', err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
      hint: /not set|invalid base64/i.test(err.message)
        ? 'Check GA_SERVICE_ACCOUNT_KEY_B64 + GA_PROPERTY_ID env vars in Vercel'
        : /permission|denied/i.test(err.message)
        ? 'Service account needs Viewer access on the GA4 property'
        : /not been used|disabled/i.test(err.message)
        ? 'Enable Google Analytics Data API in your GCP project'
        : undefined,
    });
  }
}
