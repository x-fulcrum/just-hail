// SPC (Storm Prediction Center) convective-outlook client.
// Source: https://www.spc.noaa.gov/products/outlook/
// All GeoJSON — public, no key, CORS-friendly.
//
// Used by:
//   - api/admin/strategist.js   (Claude tool-use: get_hail_outlook)
//   - admin.html (client side, same endpoints — see hail-forecast section)

// --------------------------------------------------------------
// Endpoint map — kind = 'cat' (categorical risk) or 'hail' (hail-specific
// probability) or 'prob' (general severe probability).
// Day 1–3 have categorical; Day 1–2 also have per-hazard (hail); Day 3
// offers a combined probability; Day 4–8 have per-day probability only.
// --------------------------------------------------------------
const BASE = 'https://www.spc.noaa.gov/products/outlook';

export function spcOutlookUrl(day, kind = 'cat') {
  day = Number(day);
  if (day === 1 || day === 2) {
    if (kind === 'hail') return `${BASE}/day${day}otlk_hail.lyr.geojson`;
    return `${BASE}/day${day}otlk_cat.lyr.geojson`;
  }
  if (day === 3) {
    if (kind === 'prob') return `${BASE}/day3otlk_prob.lyr.geojson`;
    return `${BASE}/day3otlk_cat.lyr.geojson`;
  }
  if (day >= 4 && day <= 8) {
    return `${BASE}/exper/day4-8/day${day}prob.lyr.geojson`;
  }
  throw new Error(`Invalid day ${day}. Use 1-8.`);
}

// --------------------------------------------------------------
// Raw GeoJSON fetch — returns the FeatureCollection as-is (for Leaflet
// L.geoJSON()). Throws on network/HTTP errors.
// --------------------------------------------------------------
export async function fetchSpcOutlookRaw(day, kind = 'cat') {
  const url = spcOutlookUrl(day, kind);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SPC ${url} → ${res.status}`);
  return res.json();
}

// --------------------------------------------------------------
// Token-efficient summary for Claude tool-use. Strips coordinates
// down to bounding boxes + centroids and keeps only the metadata
// that matters (label, probability, issue/expire times).
// --------------------------------------------------------------
export async function getSpcOutlookSummary(day, kind = 'cat') {
  const geo = await fetchSpcOutlookRaw(day, kind);
  const features = geo?.features || [];

  return {
    day: Number(day),
    kind,
    url: spcOutlookUrl(day, kind),
    issued:      features[0]?.properties?.ISSUE_ISO  || null,
    valid_from:  features[0]?.properties?.VALID_ISO  || null,
    valid_until: features[0]?.properties?.EXPIRE_ISO || null,
    forecaster:  features[0]?.properties?.FORECASTER || null,
    feature_count: features.length,
    tiers: features.map((f) => {
      const p = f.properties || {};
      const bbox = bboxOfGeometry(f.geometry);
      return {
        label: p.LABEL,
        label_long: p.LABEL2,
        probability: parseFloat(p.LABEL) || null, // for hail/prob layers
        stroke: p.stroke,
        fill: p.fill,
        bbox,               // {n, s, e, w}
        centroid: bbox ? { lat: (bbox.n + bbox.s) / 2, lng: (bbox.e + bbox.w) / 2 } : null,
        area_deg2: bbox ? (bbox.n - bbox.s) * (bbox.e - bbox.w) : null,
      };
    }),
  };
}

// --------------------------------------------------------------
// Tight summary helper for Claude — combines multiple days into one
// compact response so Claude can reason about the whole outlook period.
// --------------------------------------------------------------
export async function getSpcMultiDayOutlook({ days = [1, 2, 3], kind = 'cat' } = {}) {
  const results = await Promise.allSettled(days.map((d) => getSpcOutlookSummary(d, kind)));
  return results.map((r, i) => (r.status === 'fulfilled' ? r.value : { day: days[i], error: r.reason?.message || 'failed' }));
}

// --------------------------------------------------------------
// Bounding box of any GeoJSON geometry (Polygon, MultiPolygon, Point).
// --------------------------------------------------------------
function bboxOfGeometry(g) {
  if (!g) return null;
  let n = -90, s = 90, e = -180, w = 180, found = false;
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      n = Math.max(n, lat); s = Math.min(s, lat);
      e = Math.max(e, lng); w = Math.min(w, lng);
      found = true;
    } else {
      for (const c of coords) walk(c);
    }
  };
  if (g.coordinates) walk(g.coordinates);
  return found ? { n, s, e, w } : null;
}
