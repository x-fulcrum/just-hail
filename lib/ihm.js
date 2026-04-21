// IHM (Interactive Hail Maps) helpers: HMAC signature verification
// and authenticated API client for /AgentApi/* endpoints.

import crypto from 'node:crypto';

const IHM_BASE = 'https://maps.interactivehailmaps.com';

// ---------------------------------------------------------------------
// HMAC signature verification
// ---------------------------------------------------------------------
// Per the IHM Discover spec:
//   header:    X-Webhook-Signature
//   algorithm: HMAC-SHA256
//   format:    lowercase hex, no prefix
//   steps:
//     1. Read raw body as UTF-8
//     2. Trim leading/trailing whitespace
//     3. HMAC-SHA256 with WebhookSecret (UTF-8) as key, trimmed body as msg
//     4. Lowercase hex
//     5. Constant-time compare to X-Webhook-Signature
//
// Pitfalls we avoid:
//   - Never re-serialize JSON — verify against raw body.
//   - Constant-time compare to prevent timing attacks.
// ---------------------------------------------------------------------
export function verifyIhmSignature({ rawBody, signatureHeader, secret }) {
  if (!rawBody || !signatureHeader || !secret) return false;

  const trimmed = rawBody.trim();
  const expected = crypto
    .createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(Buffer.from(trimmed, 'utf8'))
    .digest('hex');

  // Both strings must be equal length for timingSafeEqual, else it throws.
  const received = Buffer.from(signatureHeader.trim(), 'utf8');
  const exp = Buffer.from(expected, 'utf8');
  if (received.length !== exp.length) return false;
  return crypto.timingSafeEqual(received, exp);
}

// ---------------------------------------------------------------------
// Authenticated IHM API client
// ---------------------------------------------------------------------
// All /AgentApi/* endpoints (except Discover) require:
//   X-Agent-KeyId: <public key id>
//   X-Agent-Secret: <private secret>
// ---------------------------------------------------------------------
function authHeaders() {
  const keyId = process.env.IHM_AGENT_KEY_ID;
  const secret = process.env.IHM_AGENT_SECRET;
  if (!keyId || !secret) {
    throw new Error('IHM_AGENT_KEY_ID and IHM_AGENT_SECRET must be set.');
  }
  return {
    'X-Agent-KeyId': keyId,
    'X-Agent-Secret': secret,
  };
}

export async function ihmGet(path, query = {}) {
  const url = new URL(IHM_BASE + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`IHM GET ${path} → ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

export async function ihmPost(path, body) {
  const res = await fetch(IHM_BASE + path, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`IHM POST ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------
// Payload flatteners — extract common fields into a consistent shape for
// storm_events table inserts. IHM payloads vary by event type; this
// normalizes them so downstream code queries one schema.
// ---------------------------------------------------------------------
export function flattenIhmPayload(eventType, payload) {
  const p = payload || {};
  const base = {
    event_type: eventType,
    recon_marker_id: p.reconMarker_id ?? null,
    customer_name: p.customerName ?? null,
    customer_phone: p.phoneNumber ?? null,
    customer_mobile: p.mobileNumber ?? null,
    customer_email: p.email ?? null,
    street: p.street ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    zip: p.zipCode ?? null,
    lat: p.lat ?? null,
    lng: p.long ?? null,
    external_key: p.externalKey ?? null,
    raw: p,
  };

  if (eventType === 'monitoring_alert') {
    return {
      ...base,
      swath_size_in: p.swathSize ?? null,
      level_detected: p.levelDetected ?? null,
      file_date: p.fileDate ?? null,
      detected_at: p.detected ?? null,
      marker_status: p.markerStatus ?? null,
    };
  }

  if (eventType === 'marker_status_changed') {
    return {
      ...base,
      marker_status: p.markerStatus ?? null,
      status_source: p.source ?? null,
      status_change_at: p.changeDate ?? null,
    };
  }

  // hail_alert — payload shape not in Discover docs, we capture everything in raw.
  return {
    ...base,
    alert_category: p.alertCategory ?? p.category ?? null,
  };
}
