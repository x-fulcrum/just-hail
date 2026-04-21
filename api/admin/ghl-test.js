// GET /api/admin/ghl-test
//
// Probes GHL with the configured GHL_PRIVATE_TOKEN + GHL_LOCATION_ID
// against the smallest possible auth check (GET /locations/{id}). If
// this returns 401/403, the token or scopes are wrong. If it returns
// 404, the location ID is wrong. If it returns 200 but push still
// fails, the token is missing specific scopes like `contacts.write`.

export default async function handler(req, res) {
  const token = process.env.GHL_PRIVATE_TOKEN;
  const locId = process.env.GHL_LOCATION_ID;

  if (!token || !locId) {
    return res.status(500).json({
      ok: false,
      step: 'env',
      error: `Missing env: ${!token ? 'GHL_PRIVATE_TOKEN ' : ''}${!locId ? 'GHL_LOCATION_ID' : ''}`.trim(),
    });
  }

  const attempts = [];

  // 1) Simplest auth check — get our own location
  const urlLoc = `https://services.leadconnectorhq.com/locations/${locId}`;
  try {
    const r = await fetch(urlLoc, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    });
    const text = await r.text();
    attempts.push({
      step: 'GET /locations/{id}',
      status: r.status,
      ok: r.ok,
      body_preview: text.slice(0, 400),
    });
  } catch (e) {
    attempts.push({ step: 'GET /locations/{id}', error: e.message });
  }

  // 2) Can we list contacts? (read scope)
  try {
    const r = await fetch(`https://services.leadconnectorhq.com/contacts?locationId=${locId}&limit=1`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    });
    const text = await r.text();
    attempts.push({
      step: 'GET /contacts (read scope)',
      status: r.status,
      ok: r.ok,
      body_preview: text.slice(0, 400),
    });
  } catch (e) {
    attempts.push({ step: 'GET /contacts', error: e.message });
  }

  // 3) Dry-run upsert (minimal body — if this fails differently than step 1/2, it's contacts.write scope)
  try {
    const r = await fetch(`https://services.leadconnectorhq.com/contacts/upsert`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locationId: locId,
        firstName: 'GHL Test',
        lastName: 'Probe',
        email: `ghl-probe-${Date.now()}@just-hail.test`,
        tags: ['ghl-probe'],
      }),
    });
    const text = await r.text();
    attempts.push({
      step: 'POST /contacts/upsert (write scope)',
      status: r.status,
      ok: r.ok,
      body_preview: text.slice(0, 400),
    });
  } catch (e) {
    attempts.push({ step: 'POST /contacts/upsert', error: e.message });
  }

  const allOk = attempts.every((a) => a.ok);
  return res.status(allOk ? 200 : 500).json({
    ok: allOk,
    location_id_prefix: locId.slice(0, 6) + '…',
    token_prefix: token.slice(0, 6) + '…',
    attempts,
  });
}
