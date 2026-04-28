// GET /api/admin/config
// ----------------------------------------------------------------
// Tiny endpoint that exposes safe-to-be-public config values to the
// admin UI. Mapbox public tokens (pk.*) are designed to be embedded in
// client-side JS — they're URL-restricted by Mapbox, not secret. But
// we still serve them through this endpoint instead of hardcoding so
// rotating the token is a one-line Vercel env change with zero deploy.
//
// Add new public-safe keys here as needed. NEVER expose service-role
// keys, API secrets, or anything that grants write access to a system.

export const config = { maxDuration: 5 };

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // Short-cache so token rotation propagates within a minute.
  res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');

  return res.status(200).json({
    ok: true,
    mapbox_token: process.env.MAPBOX_TOKEN || null,
    posthog_key:  process.env.NEXT_PUBLIC_POSTHOG_KEY || process.env.POSTHOG_PUBLIC_KEY || null,
    site_origin:  process.env.SITE_URL || 'https://www.justhail.net',
  });
}
