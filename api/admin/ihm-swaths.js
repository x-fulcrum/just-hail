// GET /api/admin/ihm-swaths?begin=M/D/YYYY&end=M/D/YYYY
//                         &neLat=...&neLng=...&swLat=...&swLng=...
//                         &showObserved=true|false
//
// Proxies Interactive Hail Maps' hail layers with our stored session
// cookie. Returns BOTH:
//   - pins      : individual hail-impact points from /Api/StormData
//   - polygons  : hail-swath polygon zones from POST /api/SwathDataFl
// so the admin map UI can render them together.
//
// Notes:
//  - begin/end default to today if omitted
//  - bbox only applies to pins (swath polygons are returned whole)
//  - showObserved=true includes confirmed-report swaths; false = radar only

import { getStormData, getSwathPolygons } from '../../lib/ihm-web.js';

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
  const showObserved = q.showObserved === 'true';

  const bbox = {
    neLat: q.neLat ? parseFloat(q.neLat) : undefined,
    neLng: q.neLng ? parseFloat(q.neLng) : undefined,
    swLat: q.swLat ? parseFloat(q.swLat) : undefined,
    swLng: q.swLng ? parseFloat(q.swLng) : undefined,
  };

  try {
    // Fetch pins + polygons in parallel. Use Promise.allSettled so a failure
    // on one side doesn't kill the other.
    const [pinsRes, polysRes] = await Promise.allSettled([
      getStormData({ begin, end, ...bbox }),
      getSwathPolygons({ begin, showObserved }),
    ]);

    const pins     = pinsRes.status  === 'fulfilled' ? pinsRes.value   : [];
    const polygons = polysRes.status === 'fulfilled' ? polysRes.value : [];
    const errors = {};
    if (pinsRes.status  === 'rejected') errors.pins     = pinsRes.reason?.message;
    if (polysRes.status === 'rejected') errors.polygons = polysRes.reason?.message;

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      ok: true,
      begin, end, bbox, showObserved,
      pins,
      polygons,
      // Back-compat: legacy callers read `data` as the pins array.
      data: pins,
      ...(Object.keys(errors).length ? { errors } : {}),
    });
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
