// Server-side PostHog client.
// ----------------------------------------------------------------
// Two surfaces:
//   1. capture()   — push events to PostHog from server-side (e.g.,
//                    Resend webhook → "email_opened" event tied to
//                    the lead's PostHog identity).
//   2. query()     — run HogQL queries against PostHog from Hailey's
//                    tool layer (e.g., "leads who visited the site
//                    in the last 24h but didn't submit the form").
//
// Public client-side init lives in index.html with NEXT_PUBLIC_POSTHOG_KEY
// (write-only project token). This file uses POSTHOG_API_KEY (personal
// API key with full access) for the read/admin operations Hailey needs.

const HOST     = process.env.POSTHOG_HOST       || 'https://us.i.posthog.com';
const PROJECT  = process.env.POSTHOG_PROJECT_ID;
const PROJ_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;   // public, write-only
const API_KEY  = process.env.POSTHOG_API_KEY;            // personal, admin

// ----------------------------------------------------------------
// capture — fire a single event server-side. Used by webhooks
// (Resend opens/clicks, Twilio SMS delivery) so engagement data
// joins the user's existing client-side timeline.
// ----------------------------------------------------------------
export async function capture({ event, distinctId, properties = {}, timestamp = null }) {
  if (!PROJ_KEY) {
    console.warn('[posthog] NEXT_PUBLIC_POSTHOG_KEY not set, skip capture');
    return { ok: false, reason: 'no_key' };
  }
  if (!event || !distinctId) {
    return { ok: false, reason: 'missing_event_or_distinctId' };
  }

  const body = {
    api_key: PROJ_KEY,
    event,
    distinct_id: distinctId,
    properties: {
      ...properties,
      $lib: 'just-hail-server',
    },
    ...(timestamp ? { timestamp } : {}),
  };

  try {
    const res = await fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error('[posthog] capture failed:', err);
    return { ok: false, error: err.message };
  }
}

// ----------------------------------------------------------------
// captureBatch — multiple events in one request. Use when ingesting
// a batch of webhook deliveries (e.g., Resend's batch open events).
// ----------------------------------------------------------------
export async function captureBatch(events) {
  if (!PROJ_KEY) return { ok: false, reason: 'no_key' };
  if (!Array.isArray(events) || !events.length) return { ok: false, reason: 'no_events' };

  const body = {
    api_key: PROJ_KEY,
    batch: events.map((e) => ({
      event: e.event,
      distinct_id: e.distinctId || e.distinct_id,
      properties: { ...(e.properties || {}), $lib: 'just-hail-server' },
      ...(e.timestamp ? { timestamp: e.timestamp } : {}),
    })),
  };

  try {
    const res = await fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, count: events.length };
  } catch (err) {
    console.error('[posthog] captureBatch failed:', err);
    return { ok: false, error: err.message };
  }
}

// ----------------------------------------------------------------
// identify — set/update person properties on an existing distinct id.
// Often called from the form (already done client-side), but also
// useful when Hailey enriches a lead and we want PostHog to know.
// ----------------------------------------------------------------
export async function identify(distinctId, personProps = {}) {
  return capture({
    event: '$identify',
    distinctId,
    properties: { $set: personProps },
  });
}

// ----------------------------------------------------------------
// query — run a HogQL query (PostHog's SQL dialect) against the
// project. Used by Hailey to ask things like:
//   "show me all leads who visited /privacy in the last 24h"
//   "which drip step has the highest reply rate?"
//
// Returns { results, columns, ... } on success.
// ----------------------------------------------------------------
export async function query(hogql) {
  if (!API_KEY)  throw new Error('POSTHOG_API_KEY not set');
  if (!PROJECT)  throw new Error('POSTHOG_PROJECT_ID not set');

  const res = await fetch(`${HOST}/api/projects/${PROJECT}/query/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      query: { kind: 'HogQLQuery', query: hogql },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`posthog query ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ----------------------------------------------------------------
// listEventsForLead — fetch all PostHog events for one distinct_id.
// Used by the per-lead drawer to show the full engagement timeline.
// ----------------------------------------------------------------
export async function listEventsForLead(distinctId, { limit = 100, hours = 720 } = {}) {
  const sql = `
    SELECT timestamp, event, properties.$current_url AS url, properties
    FROM events
    WHERE distinct_id = '${String(distinctId).replace(/'/g, "''")}'
      AND timestamp > now() - INTERVAL ${Number(hours)} HOUR
    ORDER BY timestamp DESC
    LIMIT ${Number(limit)}
  `;
  const r = await query(sql);
  return r.results || [];
}

// ----------------------------------------------------------------
// person — fetch the full person record for one distinct_id.
// Returns merged person properties (including UTMs from session).
// ----------------------------------------------------------------
export async function person(distinctId) {
  if (!API_KEY || !PROJECT) throw new Error('PostHog API not configured');
  const url = new URL(`${HOST}/api/projects/${PROJECT}/persons/`);
  url.searchParams.set('distinct_id', distinctId);
  const res = await fetch(url, {
    headers: { 'authorization': `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`posthog person ${res.status}`);
  const j = await res.json();
  return j.results?.[0] || null;
}

// ----------------------------------------------------------------
// healthCheck — used by the API health strip to show PostHog status.
// ----------------------------------------------------------------
export async function healthCheck() {
  if (!API_KEY || !PROJECT) return { ok: false, reason: 'not_configured' };
  try {
    const start = Date.now();
    const res = await fetch(`${HOST}/api/projects/${PROJECT}/`, {
      headers: { 'authorization': `Bearer ${API_KEY}` },
    });
    return {
      ok: res.ok,
      status: res.status,
      latency_ms: Date.now() - start,
      configured: true,
    };
  } catch (err) {
    return { ok: false, error: err.message, configured: true };
  }
}
