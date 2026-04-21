// BatchData API client
// ------------------------------------------------------------
// Base:   https://api.batchdata.com/api/v1
// Auth:   Authorization: Bearer <BATCHDATA_API_KEY>
// Shape:  { status: {code, text, message}, results: [...] }
//
// Supported endpoints we wrap:
//   POST /property/search         — geographic property query
//   POST /property/skip-trace-v3  — owner contact lookup (phones, emails)
//
// Mock mode: when BATCHDATA_MOCK=1 (Vercel env), returns synthetic data
// so we can build/test the UI flow without burning credit.

const BASE = 'https://api.batchdata.com/api/v1';
const MOCK_ENABLED = () => process.env.BATCHDATA_MOCK === '1';

function authHeaders() {
  const key = process.env.BATCHDATA_API_KEY;
  if (!key) throw new Error('BATCHDATA_API_KEY must be set.');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function bdPost(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));

  // BatchData envelopes errors in status.code rather than HTTP code always
  const code = json?.status?.code ?? res.status;
  if (code !== 200) {
    const err = new Error(`BatchData ${path} → ${code}: ${json?.status?.message || res.statusText}`);
    err.code = code;
    err.raw = json;
    throw err;
  }
  return json;
}

// ------------------------------------------------------------
// PROPERTY SEARCH
// ------------------------------------------------------------
// Accepts target objects our UI uses:
//   { zip: "78641" }
//   { polygon: [[lat,lng], [lat,lng], ...] }     (ring, closed or open)
//   { lat, lng, radius_miles }
// Returns normalized { properties: [...], total, raw }
// ------------------------------------------------------------
export async function searchProperties(target, { take = 100, skip = 0 } = {}) {
  if (MOCK_ENABLED()) return mockSearch(target, { take, skip });

  const searchCriteria = toSearchCriteria(target);
  const json = await bdPost('/property/search', {
    searchCriteria,
    options: { take, skip, useRankingScores: false, skipTrace: false },
  });

  // Real shape: { status, results: { properties: [...], meta: {...} } }
  const resultsContainer = json.results || {};
  const rawProps = Array.isArray(resultsContainer)
    ? resultsContainer                 // defensive fallback
    : (resultsContainer.properties || []);
  const total = resultsContainer.meta?.results?.resultsFound ?? rawProps.length;

  return {
    properties: rawProps.map(normalizeProperty),
    total,
    raw: json,
  };
}

// ------------------------------------------------------------
// SKIP-TRACE V3 — batch owner lookup
// ------------------------------------------------------------
// Accepts an array of identifiers (either APN + state, or address).
// Returns enriched contacts. Batch up to 500/request per BatchData docs.
// ------------------------------------------------------------
export async function skipTraceV3(requests) {
  if (MOCK_ENABLED()) return mockSkipTrace(requests);
  if (!Array.isArray(requests) || requests.length === 0) return { contacts: [], raw: null };

  const json = await bdPost('/property/skip-trace-v3', {
    requests: requests.map((r) => ({
      propertyAddress: r.propertyAddress || undefined,
      mailingAddress: r.mailingAddress || undefined,
      name: r.name || undefined,
    })),
  });

  return { contacts: json.results || [], raw: json };
}

// ------------------------------------------------------------
// Target → BatchData searchCriteria
// ------------------------------------------------------------
function toSearchCriteria(target) {
  if (!target || typeof target !== 'object') {
    throw new Error('Invalid search target');
  }
  if (target.zip) {
    return { query: String(target.zip) };
  }
  if (target.polygon && Array.isArray(target.polygon) && target.polygon.length >= 3) {
    // BatchData expects GeoJSON-ish polygon; we pass lat/lng points as-is
    // and let them interpret. If their format differs, adapt here.
    return {
      geography: {
        polygon: target.polygon.map(([lat, lng]) => ({ latitude: lat, longitude: lng })),
      },
    };
  }
  if (typeof target.lat === 'number' && typeof target.lng === 'number' && target.radius_miles) {
    return {
      geography: {
        radius: {
          center: { latitude: target.lat, longitude: target.lng },
          miles: target.radius_miles,
        },
      },
    };
  }
  if (Array.isArray(target.addresses) && target.addresses.length) {
    return { addresses: target.addresses };
  }
  throw new Error(`Unsupported target: ${JSON.stringify(target)}`);
}

// ------------------------------------------------------------
// Property row normalizer (defensive — BD field names vary)
// ------------------------------------------------------------
function normalizeProperty(p) {
  const addr    = p.address || p.propertyAddress || {};
  const owner   = p.owner || {};
  const listing = p.listing || {};
  const val     = p.valuation || {};
  const names   = owner.names?.[0] || {};
  const ql      = p.quickLists || {};
  const intel   = p.intel || {};

  // Owner name: owner.names[0] is the richest source; fall back to fullName
  const firstName = names.first || null;
  const lastName  = names.last  || null;
  const ownerName =
    (firstName || lastName) ? [firstName, lastName].filter(Boolean).join(' ')
    : owner.fullName || null;

  return {
    bd_id:           p._id || p.id || null,
    street:          addr.street || addr.streetLine || addr.line1 || null,
    city:            addr.city  || null,
    state:           addr.state || null,
    zip:             addr.zip   || addr.zipCode || addr.postalCode || null,
    lat:             addr.latitude  ?? addr.lat ?? null,
    lng:             addr.longitude ?? addr.lng ?? null,

    owner_name:      ownerName,
    owner_first:     firstName,
    owner_last:      lastName,
    owner_mailing:   owner.mailingAddress || null,

    year_built:      listing.yearBuilt ?? p.propertyOwnerProfile?.averageYearBuilt ?? null,
    estimated_value: val.estimatedValue ?? null,
    bedrooms:        listing.bedroomCount ?? null,
    bathrooms:       listing.bathroomCount ?? null,
    square_feet:     listing.livingArea ?? null,

    // segmentation signals — used later by Claude for personalization + filtering
    absentee_owner:  ql.absenteeOwner === true,
    out_of_state:    ql.absenteeOwnerOutOfState === true,
    high_equity:     ql.highEquity === true,
    owner_occupied:  ql.ownerOccupied === true,
    sale_propensity: intel.salePropensity ?? null,

    raw:             p,
  };
}

// ============================================================
// MOCK DATA — used when BATCHDATA_MOCK=1 (or set per-request)
// ============================================================
function mockSearch(target, { take, skip }) {
  const count = Math.min(take, 18);
  const cities = ['Leander', 'Austin', 'Cedar Park', 'Round Rock', 'Georgetown'];
  const streets = ['Hazelwood', 'Lakeline', 'Cypress Creek', 'Parmer', 'Ronald Reagan', 'Crystal Falls'];
  const properties = Array.from({ length: count }, (_, i) => {
    const idx = skip + i;
    return {
      bd_id: `mock-${idx}`,
      street: `${1000 + idx * 23} ${streets[idx % streets.length]} Blvd`,
      city: cities[idx % cities.length],
      state: 'TX',
      zip: target.zip || '78641',
      lat: 30.5788 + (idx - count / 2) * 0.002,
      lng: -97.8531 + (idx - count / 2) * 0.003,
      owner_name: `${['Marcus','Priya','Don','Alicia','Jamal','Sarah','Tomás','Kira'][idx % 8]} ${['Delgado','Chen','Whitaker','Moreno','Hayes','Patel','Reyes','Nguyen'][idx % 8]}`,
      year_built: 1998 + (idx * 3) % 25,
      estimated_value: 280000 + (idx * 17000),
      bedrooms: 3 + (idx % 2),
      bathrooms: 2 + (idx % 2) * 0.5,
      square_feet: 1800 + (idx * 120),
      raw: { mock: true, idx },
    };
  });
  return { properties, total: properties.length, raw: { mock: true } };
}

function mockSkipTrace(requests) {
  const contacts = requests.map((r, i) => ({
    propertyAddress: r.propertyAddress,
    persons: [
      {
        name: { first: r.name?.first || `Mock${i}`, last: r.name?.last || 'Owner' },
        phoneNumbers: [{ number: `512-555-${String(1000 + i).padStart(4, '0')}`, type: 'mobile', dncFlag: false }],
        emails: [{ email: `mock${i}@example.com` }],
      },
    ],
  }));
  return { contacts, raw: { mock: true } };
}
