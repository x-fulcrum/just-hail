// Shared helpers for /api/webhooks/lindy/* receivers.
// ----------------------------------------------------------------
// Every Lindy callback follows the same pattern:
//   1. Read raw body (we need it for HMAC verification)
//   2. Verify the auth secret (header or HMAC)
//   3. Parse JSON
//   4. Hand off to a per-route handler
//   5. Mark lindy_jobs row as callback_received (if job_id present)
//   6. Always return 200 (so Lindy doesn't retry forever on bugs)
//
// This module provides `runReceiver(req, res, processor)` that
// covers steps 1, 2, 3, 5, 6. The per-route processor only does
// step 4 — its own business logic.

import { verifyCallbackSignature, markCallbackReceived } from './lindy.js';
import { supabase } from './supabase.js';

// Routes that import this module should also export the standard
// route config — bodyParser must be disabled for raw-body access:
//
//   export const config = { api: { bodyParser: false }, maxDuration: 30 };
//
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Log every inbound webhook to webhook_deliveries (same table as IHM).
async function logDelivery({ rawBody, signatureValid, parsed, headers, path }) {
  const { data } = await supabase
    .from('webhook_deliveries')
    .insert({
      source: 'lindy',
      signature_header: headers?.authorization || headers?.['x-lindy-secret'] || null,
      signature_valid: signatureValid,
      http_method: 'POST',
      path: path || null,
      headers: {
        'user-agent': headers?.['user-agent'] || null,
        'content-type': headers?.['content-type'] || null,
      },
      body: rawBody?.slice(0, 100_000),  // hard cap so a 1MB log entry doesn't kill us
      parsed,
    })
    .select('id')
    .single();
  return data?.id ?? null;
}

export async function runReceiver(req, res, processor) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  let rawBody = '';
  let parsed = null;
  let deliveryId = null;
  let sigOk = false;

  try {
    rawBody = await readRawBody(req);
    try { parsed = JSON.parse(rawBody); } catch { parsed = null; }

    // Pass rawBody into verifier so HMAC mode works.
    const reqWithBody = {
      headers: req.headers,
      body: parsed || {},
      rawBody,
    };
    const sig = verifyCallbackSignature(reqWithBody);
    sigOk = sig.ok;

    deliveryId = await logDelivery({
      rawBody,
      signatureValid: sigOk,
      parsed,
      headers: req.headers,
      path: req.url,
    });

    if (!sigOk) {
      console.warn('[lindy-webhook]', req.url, 'invalid signature:', sig.reason);
      return res.status(200).json({ ok: false, reason: 'invalid_signature' });
    }
    if (!parsed) {
      return res.status(200).json({ ok: false, reason: 'unparseable_body' });
    }

    // Run the per-route processor.
    const result = await processor(parsed, { req, deliveryId });

    // If the payload referenced a lindy_job_id, mark it as completed.
    if (parsed.lindy_job_id) {
      await markCallbackReceived(parsed.lindy_job_id, parsed);
    }

    return res.status(200).json({ ok: true, ...(result || {}) });
  } catch (err) {
    console.error('[lindy-webhook] error in', req.url, err);
    return res.status(200).json({ ok: false, reason: 'internal_error', message: err.message });
  }
}

// Look up a lead by phone number (E.164 best-effort).
// Used by both call-result and sms-result receivers when the
// payload doesn't include lead_id (cold inbound).
export async function findLeadByPhone(rawPhone) {
  if (!rawPhone) return null;
  const candidates = phoneVariants(rawPhone);
  const { data } = await supabase
    .from('leads')
    .select('id, first_name, last_name, email, phone, mobile, street, city, state, zip, campaign_id, opted_out, status')
    .or(candidates.map((p) => `phone.eq.${p},mobile.eq.${p}`).join(','))
    .limit(1)
    .maybeSingle();
  return data || null;
}

// Generate likely phone number variants for matching.
//   "+15125551234"   → ["+15125551234", "15125551234", "5125551234", "(512) 555-1234"]
export function phoneVariants(p) {
  if (!p) return [];
  const digits = String(p).replace(/\D/g, '');
  const out = new Set();
  out.add(p);
  if (digits) {
    out.add(digits);
    if (digits.length === 11) out.add(digits.slice(1));
    if (digits.length === 10) {
      out.add('+1' + digits);
      out.add('1' + digits);
      out.add(`(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`);
    }
  }
  return [...out];
}
