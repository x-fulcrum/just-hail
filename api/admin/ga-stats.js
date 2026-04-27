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
    // Return 200 with ok:false so this doesn't surface as a network
    // error in the browser console (cron polls every 60s; we don't
    // want hourly noise just because GA isn't permissioned yet).
    const msg = err.message || String(err);
    const unrecoverable = /permission|denied|not been used|disabled|invalid base64|not set/i.test(msg);
    res.setHeader('Cache-Control', unrecoverable ? 'public, s-maxage=3600' : 'public, s-maxage=30');
    return res.status(200).json({
      ok: false,
      unrecoverable,                                      // signal to client to stop polling
      error: msg,
      hint: /not set|invalid base64/i.test(msg)
        ? 'Check GA_SERVICE_ACCOUNT_KEY_B64 + GA_PROPERTY_ID env vars in Vercel'
        : /permission|denied/i.test(msg)
        ? 'Service account needs Viewer access on the GA4 property (Google UI rejects service-account emails — known issue). Use Vercel Analytics + PostHog instead.'
        : /not been used|disabled/i.test(msg)
        ? 'Enable Google Analytics Data API in your GCP project'
        : undefined,
    });
  }
}
