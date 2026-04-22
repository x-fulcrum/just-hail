// IHM web client — talks to the session-cookie-authenticated endpoints
// (separate from lib/ihm.js which handles the public AgentApi).
//
// Auth model: IHM_SESSION_COOKIE env var holds a full `Cookie:` header
// string copied from a logged-in browser. These endpoints are internal
// UI routes (/Territory/*, /ContactData/*, /Api/Territory, etc.) and
// expire when the session does. When that happens, the user re-pastes
// fresh cookies from DevTools → Application → Cookies.
//
// Phase-3 upgrade: replace stored cookies with a programmatic login
// (POST /Account/LogOn with email + password → capture Set-Cookie →
// refresh automatically).

import * as cheerio from 'cheerio';

const IHM_BASE = 'https://maps.interactivehailmaps.com';

function sessionCookie() {
  const c = process.env.IHM_SESSION_COOKIE;
  if (!c) throw new Error('IHM_SESSION_COOKIE must be set (see .env.local)');
  return c;
}

function baseHeaders() {
  return {
    Cookie: sessionCookie(),
    Referer: `${IHM_BASE}/`,
    Origin: IHM_BASE,
    // Must match the UA that originally earned cf_clearance — Cloudflare rejects mismatches.
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
  };
}

// ---------------------------------------------------------------------
// Form-encoded POST — most IHM internal endpoints use application/x-www-form-urlencoded
// ---------------------------------------------------------------------
async function ihmWebPost(path, params = {}, { accept = 'text/html, */*; q=0.01' } = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const x of v) body.append(k, String(x));
    } else if (v !== null && v !== undefined) {
      body.append(k, String(v));
    }
  }
  const res = await fetch(IHM_BASE + path, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: accept },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`IHM POST ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return res;
}

async function ihmWebGet(path) {
  const res = await fetch(IHM_BASE + path, { headers: baseHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`IHM GET ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return res;
}

// ---------------------------------------------------------------------
// Territory operations
// ---------------------------------------------------------------------

// Create a territory from a polygon. Points may be [lat, lng] pairs OR
// { lat, lng } objects. fileDate is required (IHM uses it to anchor the
// territory to a specific hail-data date).
export async function createTerritory({ points, fileDate }) {
  const params = new URLSearchParams();
  params.set('FileDate', fileDate);
  for (const p of points) {
    const [lat, lng] = Array.isArray(p) ? p : [p.lat, p.lng];
    params.append('lat', String(lat));
    params.append('lng', String(lng));
  }
  // Note: using form-encoded repeated keys matching the browser's behavior
  const res = await fetch(IHM_BASE + '/Api/Territory', {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json, text/javascript, */*; q=0.01' },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`createTerritory → ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
  // returns { Territory_id, Name, CenterLat, CenterLong }
}

// Trigger the contact data retrieval for a territory. Returns an HTML
// confirmation blob (IHM responds with a confirm dialog in HTML).
export async function initiateContactDataRequest(territoryId) {
  const res = await ihmWebGet(`/ContactData/InitiateTerritoryDataRequest?Territory_id=${encodeURIComponent(territoryId)}`);
  return res.text();
}

// Fetch the Territory Details page — the full HTML page. The contact
// table is rendered inline. We parse it to extract leads.
export async function getTerritoryDetailsHtml(territoryId) {
  const res = await ihmWebGet(`/Territory/Details/${encodeURIComponent(territoryId)}?idr=true`);
  return res.text();
}

// Fetch the bulk contact list HTML fragment (XHR that fires on page load).
// NOTE: /Territory/* MVC controllers use `id` as the parameter name (standard
// ASP.NET routing), while /Api/* and /api/* endpoints use `Territory_id`.
export async function getBulkContactListHtml(territoryId) {
  const res = await ihmWebPost('/Territory/BulkContactList', { id: territoryId });
  return res.text();
}

// ------------------------------------------------------------
// Polygon (territory perimeter) fetcher
// ------------------------------------------------------------
// /api/TerritoryPerims returns an array of all territories for a given
// FileDate, each with `t` (Territory_id), `r` (region?), and `p` (the
// Google-encoded polyline of the polygon vertices). We decode `p` into
// [lat, lng] pairs and return just the one matching our territoryId.
// ------------------------------------------------------------
function decodePolyline(str) {
  if (!str || typeof str !== 'string') return [];
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index < str.length);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index < str.length);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    coords.push([lat * 1e-5, lng * 1e-5]);
  }
  return coords;
}

// ------------------------------------------------------------
// Storm / hail swath data
// ------------------------------------------------------------
// Fetches hail swath polygons for a viewport + date range from IHM.
// Returns raw JSON; shape we expect is documented in docs/ihm-endpoints.md
// but this was not previously parsed — we pass it through.
// ------------------------------------------------------------
export async function getStormData({ begin, end, neLat, neLng, swLat, swLng }) {
  const qs = new URLSearchParams();
  if (begin) qs.set('Begin', begin);
  if (end)   qs.set('End', end);
  if (neLat !== undefined) qs.set('nElat', String(neLat));
  if (neLng !== undefined) qs.set('nElng', String(neLng));
  if (swLat !== undefined) qs.set('sWlat', String(swLat));
  if (swLng !== undefined) qs.set('sWlng', String(swLng));
  const res = await ihmWebGet('/Api/StormData?' + qs.toString());
  return res.json();
}

// ------------------------------------------------------------
// Impacted places — GET /Api/ImpactedPlaces?FileDate=M/D/YYYY&hr=true
// Returns list of cities/zips with hail-pin counts for the given date.
// Useful for "where did hail fall today" without loading every pin.
// ------------------------------------------------------------
export async function getImpactedPlaces({ date, hr = true }) {
  const qs = new URLSearchParams();
  if (date) qs.set('FileDate', date);
  if (hr) qs.set('hr', 'true');
  const res = await ihmWebGet('/Api/ImpactedPlaces?' + qs.toString());
  return res.json();
}

// ------------------------------------------------------------
// Swath polygons — the big colored hail-zone shapes IHM renders on
// their map. Endpoint: POST /api/SwathDataFl.
// Form body: Begin=M/D/YYYY & ShowObserved=false
// Response: [ { s: size_tier, r: ring_idx, p: encoded_polyline, l: layer } ]
//   - `s` is an integer 1..N for color tier (small → large hail)
//   - `p` is Google-polyline-encoded coordinates (same format as
//     TerritoryPerims); decodePolyline() parses it to [[lat, lng], ...]
// ------------------------------------------------------------
export async function getSwathPolygons({ begin, showObserved = false }) {
  const res = await ihmWebPost('/api/SwathDataFl', {
    Begin: begin,
    ShowObserved: showObserved ? 'true' : 'false',
  }, { accept: 'application/json, text/javascript, */*; q=0.01' });
  const raw = await res.json();
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row.p !== 'string') return null;
      const coords = decodePolyline(row.p);
      if (!coords.length) return null;
      return {
        sizeTier: row.s ?? null,
        ring: row.r ?? null,
        layer: row.l ?? null,
        points: coords.map(([lat, lng]) => ({ lat, lng })),
      };
    })
    .filter(Boolean);
}

// Returns [{lat, lng}, ...] for the given territory. fileDate is optional —
// we try today first, then fall back to iterating nearby dates if not found.
export async function getTerritoryPolygon(territoryId, fileDateMMDDYYYY) {
  const tryFetch = async (fileDate) => {
    const res = await ihmWebPost('/api/TerritoryPerims', {
      FileDate: fileDate,
      Territory_id: '',
    }, { accept: 'application/json, text/javascript' });
    const json = await res.json().catch(() => []);
    if (!Array.isArray(json)) return null;
    const target = json.find((x) => Number(x.t) === Number(territoryId));
    if (!target?.p) return null;
    return decodePolyline(target.p).map(([lat, lng]) => ({ lat, lng }));
  };

  // Try caller-supplied date, then today, then walk back up to 14 days
  const candidates = [];
  if (fileDateMMDDYYYY) candidates.push(fileDateMMDDYYYY);
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    candidates.push(`${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`);
  }

  for (const fd of candidates) {
    try {
      const poly = await tryFetch(fd);
      if (poly && poly.length >= 3) return { polygon: poly, fileDate: fd };
    } catch {
      // keep trying
    }
  }
  return null;
}

// Marker list fragment (also uses `id`, standard MVC routing).
export async function getMarkerListHtml(territoryId) {
  const res = await ihmWebPost('/Territory/MarkerList', { id: territoryId });
  return res.text();
}

// Export bulk contact data (probably CSV or CSV-like; TBD by response inspection).
export async function getExportBulkContactData(territoryId) {
  const res = await ihmWebPost('/Territory/ExportBulkContactData', { id: territoryId });
  return res.text();
}

// ---------------------------------------------------------------------
// Contact extraction
// ---------------------------------------------------------------------
// Parse the HTML returned by BulkContactList (or the relevant portion of
// the Territory Details page) into a normalized lead[] array.
//
// Structure observed in Charlie's page:
//   <table>
//     <tr>
//       <th>Marker</th><th>Customer</th><th>Address</th><th></th>
//     </tr>
//     <tr>
//       <td>(marker icon)</td>
//       <td>
//         Maria Poos<br>
//         Mobile:(512) 947-3343 <span class="...">DNC: Not Checked</span>
//         (and sometimes <br>EMAIL@domain.com)
//       </td>
//       <td>1200 Peachtree Valley Dr<br>Round Rock, TX 78681</td>
//       <td><button>Create Marker</button></td>
//     </tr>
//   </table>
//
// We parse defensively — extract whatever looks like a name / phone /
// email / address from each row. Log unknown shapes for the operator.
// ---------------------------------------------------------------------
export function parseContactsFromHtml(html) {
  const $ = cheerio.load(html);

  // Find the table that holds contacts. BulkContactList fragment is
  // basically just the <table> rows; the Details page has many tables,
  // so we look for one whose header includes "Customer" + "Address".
  let $targetTable = null;
  $('table').each((_, el) => {
    const headers = $(el).find('th').map((_, th) => $(th).text().trim().toLowerCase()).get();
    if (headers.includes('customer') && headers.includes('address')) {
      $targetTable = $(el);
      return false;
    }
  });

  // Fallback — just grab every <tr> in the document and try to interpret
  if (!$targetTable) {
    $targetTable = $.root();
  }

  const contacts = [];
  const rows = $targetTable.is('table') ? $targetTable.find('tr') : $targetTable.find('tr');

  // Forward-fill state: IHM's household-style rows leave the address
  // column blank on subsequent occupants of the same address. We inherit
  // from the most recent fully-populated row.
  let lastAddress = { street: null, city: null, state: null, zip: null };

  rows.each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 2) return; // header row or empty

    const cellTexts = cells.map((_, td) => $(td).html() || '').get();

    let addressCell = '';
    let bestPhone = null, bestMobile = null, bestEmail = null, bestName = null;

    for (const raw of cellTexts) {
      const text = decodeHtml(raw).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
      if (!text) continue;

      const mobMatch  = text.match(/mobile[:\s]*\(?(\d{3})\)?[\s\-\.]*(\d{3})[\s\-\.]*(\d{4})/i);
      const phMatch   = text.match(/\(?(\d{3})\)?[\s\-\.]*(\d{3})[\s\-\.]*(\d{4})/);
      const emailMatch= text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);

      if (mobMatch) bestMobile = `(${mobMatch[1]}) ${mobMatch[2]}-${mobMatch[3]}`;
      else if (phMatch && !bestPhone) bestPhone = `(${phMatch[1]}) ${phMatch[2]}-${phMatch[3]}`;
      if (emailMatch && !bestEmail) bestEmail = emailMatch[0];

      if ((mobMatch || phMatch || emailMatch) && !bestName) {
        const firstLine = text.split('\n')[0].trim();
        if (/^[A-Za-z][A-Za-z\s.\-']{1,60}$/.test(firstLine) && firstLine.length >= 3) {
          bestName = firstLine;
        }
      }

      if (/\b\d{5}(-\d{4})?\b/.test(text) && !addressCell) {
        addressCell = text;
      }
    }

    // Skip rows that have no way to reach anyone: no name AND no phone/email.
    // A bare address row isn't useful for outreach, only muddies the lead count.
    const hasContact = bestMobile || bestPhone || bestEmail;
    if (!bestName && !hasContact) return;

    // Parse address: "Street\nCity, ST ZIP"
    let street = null, city = null, state = null, zip = null;
    if (addressCell) {
      const lines = addressCell.split('\n').map((s) => s.trim()).filter(Boolean);
      if (lines.length >= 1) street = lines[0];
      if (lines.length >= 2) {
        const m = lines[1].match(/^(.+?),\s*([A-Z]{2})\s*(\d{5}(-\d{4})?)$/);
        if (m) { city = m[1]; state = m[2]; zip = m[3]; }
      }
      // Freshly-populated — update forward-fill state
      if (street || zip) {
        lastAddress = { street, city, state, zip };
      }
    } else {
      // Inherit from previous household
      street = lastAddress.street;
      city   = lastAddress.city;
      state  = lastAddress.state;
      zip    = lastAddress.zip;
    }

    let first_name = null, last_name = null;
    if (bestName) {
      const parts = bestName.split(/\s+/);
      first_name = parts[0];
      last_name  = parts.slice(1).join(' ') || null;
    }

    contacts.push({
      first_name,
      last_name,
      phone: bestPhone,
      mobile: bestMobile,
      email: bestEmail,
      street,
      city,
      state,
      zip,
    });
  });

  return contacts;
}

function decodeHtml(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
