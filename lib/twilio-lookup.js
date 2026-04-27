// Twilio Lookup v2 — phone validation w/ Supabase 30-day cache.
// ----------------------------------------------------------------
// API: https://lookups.twilio.com/v2/PhoneNumbers/{e164}?Fields=...
// Auth: Basic (account_sid:auth_token)
//
// Returns:
//   {
//     ok:           true,
//     line_type:    'mobile' | 'landline' | 'fixedVoip' | 'nonFixedVoip' | 'tollFree' | 'personal',
//     carrier:      'AT&T Wireless',
//     valid:        true,
//     country_code: 'US',
//     national_format: '(512) 221-3013',
//     sms_able:     true|false,                    // mobile or nonFixedVoip
//     usable_for_sms: true|false,                  // sms_able AND not on DNC (DNC checked elsewhere)
//     cached:       true|false,
//     raw:          { ... }
//   }

import { supabase } from './supabase.js';

const CACHE_TTL_DAYS = 30;

function creds() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) throw new Error('TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set');
  return { sid, tok };
}

// Normalize to E.164 format. US-defaulting since Just Hail is US-only.
export function normalizePhone(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) digits = '1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length > 11) return null;  // probably bogus
  return null;
}

function classify(raw) {
  const lti = raw?.line_type_intelligence || {};
  const type = lti.type || raw?.type || null;            // 'mobile'|'landline'|'fixedVoip'|'nonFixedVoip'|'tollFree'|'personal'
  const carrier = lti.carrier_name || raw?.carrier?.name || null;
  const valid = !!raw?.valid;
  const sms_able = type === 'mobile' || type === 'nonFixedVoip';
  return { line_type: type, carrier, valid, sms_able };
}

// ----------------------------------------------------------------
// lookup — main entry. Caches 30 days.
// ----------------------------------------------------------------
export async function lookup(phone, { force = false, fields = ['line_type_intelligence'] } = {}) {
  const e164 = normalizePhone(phone);
  if (!e164) {
    return { ok: false, error: 'invalid_phone_format', valid: false, sms_able: false };
  }

  if (!force) {
    const { data: cached } = await supabase
      .from('verification_cache')
      .select('*')
      .eq('kind', 'phone')
      .eq('normalized_value', e164)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (cached) {
      const cls = classify(cached.raw_response);
      return {
        ok: true,
        cached: true,
        e164,
        country_code: cached.raw_response?.country_code || 'US',
        national_format: cached.raw_response?.national_format,
        ...cls,
        raw: cached.raw_response,
      };
    }
  }

  const { sid, tok } = creds();
  const url = new URL(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}`);
  url.searchParams.set('Fields', fields.join(','));

  let res, raw;
  try {
    res = await fetch(url, {
      headers: {
        'authorization': 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
      },
    });
    raw = await res.json();
  } catch (err) {
    return { ok: false, error: 'network_error: ' + err.message, valid: false, sms_able: false };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `twilio_lookup_${res.status}: ${JSON.stringify(raw).slice(0, 200)}`,
      valid: false,
      sms_able: false,
    };
  }

  const cls = classify(raw);
  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86400_000).toISOString();

  await supabase.from('verification_cache').upsert({
    kind: 'phone',
    normalized_value: e164,
    expires_at: expiresAt,
    is_valid: cls.valid,
    status: cls.line_type,
    line_type: cls.line_type,
    carrier: cls.carrier,
    provider: 'twilio_lookup',
    raw_response: raw,
  }, { onConflict: 'kind,normalized_value' });

  return {
    ok: true,
    cached: false,
    e164,
    country_code: raw?.country_code || 'US',
    national_format: raw?.national_format,
    ...cls,
    raw,
  };
}

// ----------------------------------------------------------------
// lookupBatch — parallel lookups
// ----------------------------------------------------------------
export async function lookupBatch(phones, { concurrency = 6 } = {}) {
  const results = new Map();
  const queue = [...new Set(phones.map(normalizePhone).filter(Boolean))];

  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      try {
        results.set(p, await lookup(p));
      } catch (err) {
        results.set(p, { ok: false, error: err.message, sms_able: false });
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
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return { ok: false, configured: false, reason: 'no_credentials' };
  }
  const start = Date.now();
  try {
    // Verify Twilio account is alive (cheap, no Lookup quota burn)
    const { sid, tok } = creds();
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { 'authorization': 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') },
    });
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
