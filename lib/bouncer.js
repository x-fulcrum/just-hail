// Bouncer email verification — with Supabase 60-day cache.
// ----------------------------------------------------------------
// API: https://api.usebouncer.com/v1.1/email/verify?email=X
// Header: x-api-key
//
// Returns (cached or live):
//   {
//     ok: true,
//     status: 'deliverable' | 'risky' | 'undeliverable' | 'unknown',
//     toxicity: 0-5,                      // higher = more spam-trap-like
//     score: 0-100,                       // quality
//     usable: true|false,                 // helper: deliverable + toxicity <= 2
//     hold_for_review: true|false,        // toxicity 3-4 (borderline)
//     drop: true|false,                   // toxicity 5 OR undeliverable
//     cached: true|false,
//     provider: 'bouncer',
//     raw: { ... }
//   }
//
// All callers should treat `usable` as the green-light signal for
// outbound. If `hold_for_review` is true, leave them in `lead_intake`
// state for Charlie to eyeball. If `drop` is true, mark the email
// suppressed in the leads table.

import { supabase } from './supabase.js';

const CACHE_TTL_DAYS = 60;
const ENDPOINT = 'https://api.usebouncer.com/v1.1/email/verify';

function key() {
  const k = process.env.BOUNCER_API_KEY;
  if (!k) throw new Error('BOUNCER_API_KEY not set');
  return k;
}

function normalize(email) {
  return String(email || '').trim().toLowerCase();
}

function classify(raw) {
  // Normalize Bouncer's response into our own usable/hold/drop tiers
  const status = raw?.status || 'unknown';
  const toxicity = parseInt(raw?.toxicity ?? raw?.toxicity_score ?? 0, 10) || 0;
  const score = parseInt(raw?.score ?? 0, 10) || 0;
  const drop = status === 'undeliverable' || toxicity >= 5;
  const hold = !drop && (toxicity >= 3 || status === 'risky');
  const usable = !drop && !hold && status === 'deliverable';
  return { status, toxicity, score, usable, hold_for_review: hold, drop };
}

// ----------------------------------------------------------------
// verify — main entry point. Caches for 60 days.
// ----------------------------------------------------------------
export async function verify(email, { force = false } = {}) {
  const norm = normalize(email);
  if (!norm || !/@/.test(norm)) {
    return { ok: false, error: 'invalid_email_format', usable: false };
  }

  // Cache lookup
  if (!force) {
    const { data: cached } = await supabase
      .from('verification_cache')
      .select('*')
      .eq('kind', 'email')
      .eq('normalized_value', norm)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (cached) {
      const cls = classify(cached.raw_response);
      return {
        ok: true,
        cached: true,
        provider: cached.provider,
        ...cls,
        raw: cached.raw_response,
      };
    }
  }

  // Live call
  let res, raw;
  try {
    res = await fetch(`${ENDPOINT}?email=${encodeURIComponent(norm)}`, {
      headers: { 'x-api-key': key() },
    });
    raw = await res.json();
  } catch (err) {
    return { ok: false, error: 'network_error: ' + err.message, usable: false };
  }

  if (!res.ok) {
    return { ok: false, error: `bouncer_${res.status}: ${JSON.stringify(raw).slice(0, 200)}`, usable: false };
  }

  const cls = classify(raw);
  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86400_000).toISOString();

  // Upsert into cache
  await supabase.from('verification_cache').upsert({
    kind: 'email',
    normalized_value: norm,
    expires_at: expiresAt,
    is_valid: cls.usable,
    status: cls.status,
    score: cls.score,
    toxicity: cls.toxicity,
    provider: 'bouncer',
    raw_response: raw,
  }, { onConflict: 'kind,normalized_value' });

  return { ok: true, cached: false, provider: 'bouncer', ...cls, raw };
}

// ----------------------------------------------------------------
// verifyBatch — verify many at once. Bouncer has a real batch
// endpoint but it's async (results polled via job ID). For simple
// cases <100, parallel single calls are faster end-to-end.
// ----------------------------------------------------------------
export async function verifyBatch(emails, { concurrency = 8, force = false } = {}) {
  const results = new Map();
  const queue = [...new Set(emails.map(normalize))].filter((e) => e && /@/.test(e));

  async function worker() {
    while (queue.length) {
      const e = queue.shift();
      try {
        results.set(e, await verify(e, { force }));
      } catch (err) {
        results.set(e, { ok: false, error: err.message, usable: false });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;  // Map<email, result>
}

// ----------------------------------------------------------------
// healthCheck — for the API Health strip
// ----------------------------------------------------------------
export async function healthCheck() {
  if (!process.env.BOUNCER_API_KEY) {
    return { ok: false, configured: false, reason: 'no_api_key' };
  }
  const start = Date.now();
  try {
    const r = await verify('test@example.com', { force: true });
    return {
      ok: r.ok,
      configured: true,
      latency_ms: Date.now() - start,
      ...(r.ok ? {} : { error: r.error?.slice(0, 200) }),
    };
  } catch (err) {
    return { ok: false, configured: true, latency_ms: Date.now() - start, error: err.message };
  }
}
