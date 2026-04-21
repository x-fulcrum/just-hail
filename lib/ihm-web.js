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
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (Just-Hail-Command-Center)',
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
export async function getBulkContactListHtml(territoryId) {
  const res = await ihmWebPost('/Territory/BulkContactList', { Territory_id: territoryId });
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

  rows.each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 2) return; // header row or empty

    // Try: Marker | Customer | Address | action
    // Column positions vary. Instead of fixed indexes, pull all text from each cell.
    const cellTexts = cells.map((_, td) => $(td).html() || '').get();

    // Customer cell: look for a cell with a phone or email pattern
    let customerCell = '';
    let addressCell = '';
    let bestPhone = null, bestMobile = null, bestEmail = null, bestName = null;

    for (const raw of cellTexts) {
      const text = decodeHtml(raw).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
      if (!text) continue;

      // Phone detection
      const mobMatch  = text.match(/mobile[:\s]*\(?(\d{3})\)?[\s\-\.]*(\d{3})[\s\-\.]*(\d{4})/i);
      const phMatch   = text.match(/\(?(\d{3})\)?[\s\-\.]*(\d{3})[\s\-\.]*(\d{4})/);
      const emailMatch= text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);

      if (mobMatch) bestMobile = `(${mobMatch[1]}) ${mobMatch[2]}-${mobMatch[3]}`;
      else if (phMatch && !bestPhone) bestPhone = `(${phMatch[1]}) ${phMatch[2]}-${phMatch[3]}`;
      if (emailMatch && !bestEmail) bestEmail = emailMatch[0];

      // Heuristic: if the cell has a phone or email, the first line is the name
      if ((mobMatch || phMatch || emailMatch) && !bestName) {
        const firstLine = text.split('\n')[0].trim();
        // Name is probably letters + spaces + maybe periods
        if (/^[A-Za-z][A-Za-z\s.\-']{1,60}$/.test(firstLine) && firstLine.length >= 3) {
          bestName = firstLine;
        }
        customerCell = text;
      }

      // Address cell: has a zip code
      if (/\b\d{5}(-\d{4})?\b/.test(text) && !addressCell) {
        addressCell = text;
      }
    }

    if (!bestName && !bestMobile && !bestPhone && !bestEmail && !addressCell) return;

    // Parse address: "Street\nCity, ST ZIP"
    let street = null, city = null, state = null, zip = null;
    if (addressCell) {
      const lines = addressCell.split('\n').map((s) => s.trim()).filter(Boolean);
      if (lines.length >= 1) street = lines[0];
      if (lines.length >= 2) {
        const m = lines[1].match(/^(.+?),\s*([A-Z]{2})\s*(\d{5}(-\d{4})?)$/);
        if (m) { city = m[1]; state = m[2]; zip = m[3]; }
      }
    }

    // Split name
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
