// DNC scrubbing — pluggable provider, fail-safe-deny semantics.
// ----------------------------------------------------------------
// PRIMARY PROVIDER: RealPhoneValidation DNC API (when key set).
// FALLBACK BEHAVIOR: when no DNC provider is configured, we fail-safe-DENY
// — every cold call/SMS gets blocked. This is the legally correct stance:
// without DNC scrubbing, calling could cost $500-1500 per violation.
//
// API: https://api.realvalidation.com/rpvWebService/DNCLookup.php
//      ?phone=<E.164>&token=<key>
//
// When the key is missing, every dispatch attempt logs a warning to
// `api_health` and returns { ok: false, suppressed: true, reason }.
//
// Cache TTL: 7 days (federal DNC list updates daily; 7d strikes the
// balance between cost savings and freshness for inbound campaign use).

import { supabase } from './supabase.js';
import { normalizePhone } from './twilio-lookup.js';

const CACHE_TTL_DAYS = 7;
const ENDPOINT = 'https://api.realvalidation.com/rpvWebService/DNCLookup.php';

function key() {
  return process.env.REALPHONEVALIDATION_API_KEY || null;
}

// ----------------------------------------------------------------
// check — main entry. Returns:
//   {
//     ok: true|false,
//     safe_to_contact: true|false,         // <-- the gate the orchestrator checks
//     suppressed: true|false,              // true = caller should skip this number
//     reason: 'configured_dnc' | 'no_provider' | 'on_dnc_list' | 'unknown',
//     dnc_federal: bool,
//     dnc_state: bool,
//     dnc_state_name: 'TX'|null,
//     dnc_litigator: bool,
//     dnc_dma_tps: bool,
//     cached: bool,
//     provider: 'realphonevalidation' | null,
//   }
// ----------------------------------------------------------------
export async function check(phone, { force = false } = {}) {
  const e164 = normalizePhone(phone);
  if (!e164) {
    return { ok: false, safe_to_contact: false, suppressed: true, reason: 'invalid_phone_format' };
  }

  // No provider configured → FAIL-SAFE-DENY. Log a warning so the
  // admin knows why nothing is going out, but don't crash callers.
  if (!key()) {
    return {
      ok: false,
      safe_to_contact: false,
      suppressed: true,
      reason: 'no_provider',
      message: 'REALPHONEVALIDATION_API_KEY not set — cold contact blocked for TCPA safety. Configure a DNC provider before launching campaigns.',
    };
  }

  // Cache lookup
  if (!force) {
    const { data: cached } = await supabase
      .from('verification_cache')
      .select('*')
      .eq('kind', 'dnc')
      .eq('normalized_value', e164)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (cached) {
      const onDnc = !!(cached.dnc_federal || cached.dnc_state || cached.dnc_litigator);
      return {
        ok: true,
        cached: true,
        provider: cached.provider,
        safe_to_contact: !onDnc,
        suppressed: onDnc,
        reason: onDnc ? 'on_dnc_list' : 'configured_dnc',
        dnc_federal: cached.dnc_federal,
        dnc_state: cached.dnc_state,
        dnc_state_name: cached.dnc_state_name,
        dnc_litigator: cached.dnc_litigator,
        dnc_dma_tps: cached.dnc_dma_tps,
      };
    }
  }

  // Live call
  const url = new URL(ENDPOINT);
  url.searchParams.set('phone', e164);
  url.searchParams.set('token', key());
  url.searchParams.set('output', 'json');

  let res, raw;
  try {
    res = await fetch(url);
    raw = await res.json().catch(() => null);
  } catch (err) {
    return {
      ok: false,
      safe_to_contact: false,    // fail-safe-deny on network errors
      suppressed: true,
      reason: 'network_error: ' + err.message,
    };
  }

  if (!res.ok || !raw) {
    return {
      ok: false,
      safe_to_contact: false,
      suppressed: true,
      reason: `realphonevalidation_${res.status}`,
    };
  }

  // RealPhoneValidation response shape (from their docs):
  //   {
  //     "phone_number": "+15125551234",
  //     "national_dnc": "Y" | "N",
  //     "state_dnc":    "Y" | "N",
  //     "state":        "TX",
  //     "dma_dnc":      "Y" | "N",
  //     "litigator":    "Y" | "N",
  //     "status":       "VALID",
  //   }
  const dnc_federal   = raw.national_dnc === 'Y' || raw.federal_dnc === 'Y';
  const dnc_state     = raw.state_dnc === 'Y';
  const dnc_state_name= raw.state || null;
  const dnc_litigator = raw.litigator === 'Y';
  const dnc_dma_tps   = raw.dma_dnc === 'Y';
  const onDnc = dnc_federal || dnc_state || dnc_litigator;

  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86400_000).toISOString();
  await supabase.from('verification_cache').upsert({
    kind: 'dnc',
    normalized_value: e164,
    expires_at: expiresAt,
    is_valid: !onDnc,
    status: onDnc ? 'dnc_blocked' : 'dnc_clear',
    dnc_federal,
    dnc_state,
    dnc_state_name,
    dnc_litigator,
    dnc_dma_tps,
    provider: 'realphonevalidation',
    raw_response: raw,
  }, { onConflict: 'kind,normalized_value' });

  return {
    ok: true,
    cached: false,
    provider: 'realphonevalidation',
    safe_to_contact: !onDnc,
    suppressed: onDnc,
    reason: onDnc ? 'on_dnc_list' : 'configured_dnc',
    dnc_federal,
    dnc_state,
    dnc_state_name,
    dnc_litigator,
    dnc_dma_tps,
  };
}

// ----------------------------------------------------------------
// checkBatch — concurrent DNC checks
// ----------------------------------------------------------------
export async function checkBatch(phones, { concurrency = 4 } = {}) {
  const results = new Map();
  const queue = [...new Set(phones.map(normalizePhone).filter(Boolean))];

  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      try {
        results.set(p, await check(p));
      } catch (err) {
        results.set(p, { ok: false, safe_to_contact: false, suppressed: true, reason: err.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
}

// ----------------------------------------------------------------
// healthCheck
// ----------------------------------------------------------------
export async function healthCheck() {
  if (!key()) {
    return {
      ok: false,
      configured: false,
      reason: 'no_api_key',
      severity: 'critical',
      message: 'No DNC provider configured. All cold contact is blocked. Configure REALPHONEVALIDATION_API_KEY.',
    };
  }
  const start = Date.now();
  try {
    // Cheap test against a known number (should clear DNC since it's our own)
    const url = new URL(ENDPOINT);
    url.searchParams.set('phone', '+15122213013');
    url.searchParams.set('token', key());
    url.searchParams.set('output', 'json');
    const r = await fetch(url);
    return {
      ok: r.ok,
      configured: true,
      latency_ms: Date.now() - start,
      ...(r.ok ? {} : { error: `http_${r.status}` }),
    };
  } catch (err) {
    return { ok: false, configured: true, latency_ms: Date.now() - start, error: err.message };
  }
}
