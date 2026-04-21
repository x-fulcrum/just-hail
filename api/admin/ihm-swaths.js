// GET /api/admin/ihm-swaths?begin=M/D/YYYY&end=M/D/YYYY
//                         &neLat=...&neLng=...&swLat=...&swLng=...
//
// Proxies Interactive Hail Maps' /Api/StormData endpoint with our
// stored session cookie. Returns the raw JSON so the admin map UI can
// render swath polygons client-side.
//
// Notes:
//  - begin/end default to today if omitted
//  - bounding box (neLat, neLng, swLat, swLng) should come from the
//    user's current Leaflet viewport to scope the response size

import { getStormData } from '../../lib/ihm-web.js';

function todayMDY() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const q = req.query || {};
  const begin = q.begin || q.date || todayMDY();
  const end   = q.end   || q.date || begin;

  const bbox = {
    neLat: q.neLat ? parseFloat(q.neLat) : undefined,
    neLng: q.neLng ? parseFloat(q.neLng) : undefined,
    swLat: q.swLat ? parseFloat(q.swLat) : undefined,
    swLng: q.swLng ? parseFloat(q.swLng) : undefined,
  };

  try {
    const data = await getStormData({ begin, end, ...bbox });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ ok: true, begin, end, bbox, data });
  } catch (err) {
    console.error('[ihm-swaths]', err);
    return res.status(err.status || 502).json({
      ok: false,
      error: err.message,
      hint: err.message.includes('401') || err.message.includes('403')
        ? 'IHM session expired — refresh IHM_SESSION_COOKIE in .env.local + Vercel env.'
        : undefined,
    });
  }
}
