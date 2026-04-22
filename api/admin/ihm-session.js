// /api/admin/ihm-session
//   GET  -> current cookie status (last updated, last test result, which
//           slots are populated). Cookie values themselves are NEVER returned.
//   POST -> { password, cookies: { ihm, aspnet_session, cf_clearance, email, extra } }
//           Saves new cookies (requires `password === '1234'`).
//   POST with { action: 'test' } -> live-pings IHM to verify the stored
//           cookies still authenticate.
//
// All IHM data tools read cookies from the singleton ihm_session row via
// lib/ihm-web.js. Persisting cookies here means Charlie can refresh them
// via the admin UI (no redeploy) whenever IHM kicks him out.

import { supabase } from '../../lib/supabase.js';
import { invalidateCookieCache } from '../../lib/ihm-web.js';

const REFRESH_PASSWORD = '1234';

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

function statusOf(row) {
  if (!row) return { exists: false };
  return {
    exists: true,
    updated_at: row.updated_at,
    slots: {
      ihm:              !!row.cookie_ihm,
      aspnet_session:   !!row.cookie_aspnet_session,
      cf_clearance:     !!row.cookie_cf_clearance,
      email:            !!row.cookie_email,
      extra:            !!row.cookie_extra,
    },
    last_test_at:    row.last_test_at    || null,
    last_test_ok:    row.last_test_ok    ?? null,
    last_test_error: row.last_test_error || null,
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('ihm_session').select('*').eq('id', 1).maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, status: statusOf(data) });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const body = await readJson(req);

  // Subaction: live-test the current stored cookies
  if (body.action === 'test') {
    try {
      // Lazy import to avoid circular deps
      const { getSwathPolygons } = await import('../../lib/ihm-web.js');
      const result = await getSwathPolygons({
        begin: new Date().toLocaleDateString('en-US'),  // today M/D/YYYY
        showObserved: false,
      });
      const ok = Array.isArray(result);
      await supabase.from('ihm_session').upsert({
        id: 1,
        last_test_at: new Date().toISOString(),
        last_test_ok: ok,
        last_test_error: ok ? null : 'unexpected response shape',
      }, { onConflict: 'id' });
      return res.status(200).json({ ok: true, test: { ok, polygon_count: ok ? result.length : 0 } });
    } catch (err) {
      await supabase.from('ihm_session').upsert({
        id: 1,
        last_test_at: new Date().toISOString(),
        last_test_ok: false,
        last_test_error: (err.message || String(err)).slice(0, 400),
      }, { onConflict: 'id' });
      return res.status(200).json({ ok: true, test: { ok: false, error: err.message || String(err) } });
    }
  }

  // Save new cookies (password gated)
  if (body.password !== REFRESH_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Wrong refresh password.' });
  }
  const c = body.cookies || {};
  const row = {
    id: 1,
    updated_at: new Date().toISOString(),
    // Trim + strip any leading "name=" prefix Charlie might have pasted along.
    cookie_ihm:            stripPrefix(c.ihm, 'ihm='),
    cookie_aspnet_session: stripPrefix(c.aspnet_session, 'ASP.NET_SessionId='),
    cookie_cf_clearance:   stripPrefix(c.cf_clearance, 'cf_clearance='),
    cookie_email:          stripPrefix(c.email, 'email='),
    cookie_extra:          (c.extra || '').trim() || null,
  };
  const { error } = await supabase.from('ihm_session').upsert(row, { onConflict: 'id' });
  if (error) return res.status(500).json({ ok: false, error: error.message });

  invalidateCookieCache();
  return res.status(200).json({ ok: true, saved: true });
}

function stripPrefix(value, prefix) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (v.toLowerCase().startsWith(prefix.toLowerCase())) return v.slice(prefix.length);
  return v;
}
