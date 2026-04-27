// Lindy.ai dispatch client.
// ----------------------------------------------------------------
// Posts trigger payloads to Lindy agent webhooks and records every
// dispatch in `lindy_jobs` for auditability and replay. Lindy
// agents call back to /api/webhooks/lindy/* with their results.
//
// Six agents are supported (Receptionist + SMS-handler are
// Twilio-direct, no webhook):
//
//   jh-outbound-caller    — outbound voice call to a lead
//   jh-voicemail-dropper  — bulk pre-recorded voicemail
//   jh-reply-classifier   — classify an inbound reply (sync return)
//   jh-enricher           — public-records research on a lead
//   jh-storm-broadcaster  — fan out a storm event into voice + RVM
//   jh-recap-caller       — call Charlie with the daily recap
//
// All agents accept `{ ...payload, callback_url }`. Lindy POSTs back
// with a JSON envelope that gets verified via HMAC against
// LINDY_CALLBACK_SECRET. See verifyCallbackSignature().

import crypto from 'node:crypto';
import { supabase } from './supabase.js';

// ----------------------------------------------------------------
// Agent registry — maps agent_name → env-var prefix.
// Adding a new agent? Add the URL + TOKEN env vars to Vercel and
// list it here. dispatchAgent() does the rest.
// ----------------------------------------------------------------
const AGENT_ENV = {
  // Specialized Lindy agents — only kept for capabilities we don't have
  // natively (voice + voicemail + bulk dispatch). Email + SMS in our
  // drip engine bypass Lindy entirely (Smartlead + Twilio direct).
  'jh-outbound-caller':   { url: 'LINDY_OUTBOUND_CALLER_URL',   token: 'LINDY_OUTBOUND_CALLER_TOKEN'   },
  'jh-voicemail-dropper': { url: 'LINDY_VOICEMAIL_DROPPER_URL', token: 'LINDY_VOICEMAIL_DROPPER_TOKEN' },
  'jh-reply-classifier':  { url: 'LINDY_REPLY_CLASSIFIER_URL',  token: 'LINDY_REPLY_CLASSIFIER_TOKEN'  },
  'jh-enricher':          { url: 'LINDY_ENRICHER_URL',          token: 'LINDY_ENRICHER_TOKEN'          },
  'jh-storm-broadcaster': { url: 'LINDY_STORM_BROADCASTER_URL', token: 'LINDY_STORM_BROADCASTER_TOKEN' },
  'jh-recap-caller':      { url: 'LINDY_RECAP_CALLER_URL',      token: 'LINDY_RECAP_CALLER_TOKEN'      },
};

export function listAgents() { return Object.keys(AGENT_ENV); }

function siteUrl() {
  return process.env.SITE_URL?.replace(/\/$/, '') || 'https://justhail.net';
}

// Map agent_name → which webhook path Lindy should call back into.
function callbackPathFor(agent) {
  switch (agent) {
    case 'jh-outbound-caller':   return '/api/webhooks/lindy/call-result';
    case 'jh-voicemail-dropper': return '/api/webhooks/lindy/voicemail-result';
    case 'jh-reply-classifier':  return '/api/webhooks/lindy/classifier';
    case 'jh-enricher':          return '/api/webhooks/lindy/enrichment';
    case 'jh-storm-broadcaster': return '/api/webhooks/lindy/storm-broadcast';
    case 'jh-recap-caller':      return '/api/webhooks/lindy/recap-action';
    default: throw new Error(`Unknown agent: ${agent}`);
  }
}

// ----------------------------------------------------------------
// In-memory rate limiter.
// Keeps us under Twilio's carrier-trust thresholds and prevents
// runaway loops if Lindy starts misbehaving. Per-agent: max
// `dispatchesPerMinute` rolling.
// Note: Vercel functions are stateless across cold starts, so this
// is a soft cap — for hard caps we additionally check the lindy_jobs
// table (see windowCount).
// ----------------------------------------------------------------
const RATE = {
  'jh-outbound-caller':   { perMinute: 60 },   // 1/sec
  'jh-voicemail-dropper': { perMinute: 10 },   // bulk-mode safety
  'jh-reply-classifier':  { perMinute: 120 },  // sync, lightweight
  'jh-enricher':          { perMinute: 30 },
  'jh-storm-broadcaster': { perMinute: 6 },    // it fans out internally
  'jh-recap-caller':      { perMinute: 4 },
};
const _bucket = new Map(); // agent → [ts, ts, ...]

function rateLimitOk(agent) {
  const now = Date.now();
  const cap = RATE[agent]?.perMinute ?? 60;
  const arr = (_bucket.get(agent) || []).filter((t) => now - t < 60_000);
  if (arr.length >= cap) return false;
  arr.push(now);
  _bucket.set(agent, arr);
  return true;
}

// Hard cap from DB (covers cold-start churn): `agent` dispatches in
// the last 60s recorded in lindy_jobs.
async function windowCount(agent) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from('lindy_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('agent_name', agent)
    .gte('dispatched_at', since);
  return count || 0;
}

// ----------------------------------------------------------------
// dispatchAgent — the core function.
// ----------------------------------------------------------------
// Inserts a `lindy_jobs` row, POSTs the payload to Lindy, updates
// the row with the result. Returns `{ job_id, ok, http_status,
// response_body, error }`.
//
// `payload` should be the agent-specific trigger body. We auto-merge
// `callback_url` and `lindy_job_id` so Lindy can identify which
// dispatch its callback corresponds to.
// ----------------------------------------------------------------
export async function dispatchAgent({
  agent,
  payload = {},
  lead_id = null,
  campaign_id = null,
  storm_event_id = null,
  triggered_by = 'admin_ui',
  triggered_by_user = null,
  parent_job_id = null,
  metadata = {},
  // Skip rate-limit check (e.g., when storm-broadcaster fans out internally
  // and our rate limiting would block legit traffic).
  bypassRateLimit = false,
}) {
  const env = AGENT_ENV[agent];
  if (!env) throw new Error(`Unknown agent: ${agent}`);
  const url = process.env[env.url];
  const token = process.env[env.token];
  if (!url) throw new Error(`Missing env var ${env.url} for agent ${agent}`);
  if (!token) throw new Error(`Missing env var ${env.token} for agent ${agent}`);

  // Rate-limit check (in-memory + DB)
  if (!bypassRateLimit) {
    if (!rateLimitOk(agent)) {
      return { ok: false, error: 'rate_limited_local', job_id: null };
    }
    const dbCount = await windowCount(agent);
    const cap = RATE[agent]?.perMinute ?? 60;
    if (dbCount >= cap) {
      return { ok: false, error: `rate_limited_db (${dbCount}/${cap}/min)`, job_id: null };
    }
  }

  // Build request payload — append callback_url + job_id automatically.
  const full = {
    ...payload,
    callback_url: siteUrl() + callbackPathFor(agent),
  };

  // Insert lindy_jobs row first so we have an ID.
  const { data: jobRow, error: insertErr } = await supabase
    .from('lindy_jobs')
    .insert({
      agent_name: agent,
      triggered_by,
      triggered_by_user,
      lead_id,
      campaign_id,
      storm_event_id,
      parent_job_id,
      request_url: url,
      request_payload: full,   // payload BEFORE we add lindy_job_id
      status: 'queued',
      metadata,
    })
    .select('id')
    .single();

  if (insertErr || !jobRow) {
    return { ok: false, error: 'db_insert_failed: ' + (insertErr?.message || 'unknown'), job_id: null };
  }

  // Now we can include lindy_job_id in the payload Lindy receives.
  full.lindy_job_id = jobRow.id;

  // Fire the webhook.
  let res, body, httpStatus = null;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Lindy accepts Bearer auth on its public webhook URLs.
        'authorization': `Bearer ${token}`,
        'user-agent': 'just-hail/1.0',
      },
      body: JSON.stringify(full),
    });
    httpStatus = res.status;
    body = await res.text();
  } catch (e) {
    await supabase
      .from('lindy_jobs')
      .update({
        status: 'failed',
        dispatched_at: new Date().toISOString(),
        error_message: 'fetch_threw: ' + (e.message || String(e)),
      })
      .eq('id', jobRow.id);
    return { ok: false, error: 'fetch_threw: ' + e.message, job_id: jobRow.id };
  }

  const ok = res.ok;
  await supabase
    .from('lindy_jobs')
    .update({
      status: ok ? 'dispatched' : 'failed',
      dispatched_at: new Date().toISOString(),
      http_status: httpStatus,
      http_response: body?.slice(0, 4000) || null,
      error_message: ok ? null : `http_${httpStatus}: ${body?.slice(0, 500) || ''}`,
    })
    .eq('id', jobRow.id);

  return { ok, http_status: httpStatus, response_body: body, job_id: jobRow.id };
}

// ----------------------------------------------------------------
// verifyCallbackSignature — verify Lindy → us callbacks.
// ----------------------------------------------------------------
// Lindy doesn't natively sign its outbound callbacks (the webhook
// URLs we publish are open POST endpoints). To prevent abuse we
// require Lindy to forward our `LINDY_CALLBACK_SECRET` in either
// of these forms:
//
//   1. Header `x-lindy-secret: <secret>`
//   2. Body field `secret: <secret>`  (when set as part of the agent's payload)
//
// In practice we use option 1 — set the header in each agent's HTTP
// Request action ("Authorization: Bearer LINDY_CALLBACK_SECRET" or
// "x-lindy-secret: ..."). This function checks both, plus accepts
// an HMAC mode for future use.
// ----------------------------------------------------------------
export function verifyCallbackSignature(req) {
  const secret = process.env.LINDY_CALLBACK_SECRET;
  if (!secret) return { ok: false, reason: 'no_secret_configured' };

  // Header forms
  const auth = (req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  const headerSecret =
    req.headers?.['x-lindy-secret'] ||
    req.headers?.['x-lindy-callback-secret'] ||
    auth ||
    '';

  if (headerSecret && timingSafeEq(headerSecret, secret)) {
    return { ok: true, mode: 'header' };
  }

  // Body field (optional, less secure since it's in payload logs)
  const bodySecret = req.body?.secret || req.body?.callback_secret;
  if (bodySecret && timingSafeEq(bodySecret, secret)) {
    return { ok: true, mode: 'body' };
  }

  // HMAC mode (future): x-lindy-signature: sha256=<hex>
  // computed over the raw request body with LINDY_CALLBACK_SECRET.
  const sigHdr = req.headers?.['x-lindy-signature'];
  if (sigHdr && req.rawBody) {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(req.rawBody)
      .digest('hex');
    if (timingSafeEq(sigHdr, expected)) {
      return { ok: true, mode: 'hmac' };
    }
  }

  return { ok: false, reason: 'no_match' };
}

function timingSafeEq(a, b) {
  if (!a || !b) return false;
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// ----------------------------------------------------------------
// markCallbackReceived — call from webhook receivers after they
// successfully verify + parse the inbound callback.
// ----------------------------------------------------------------
export async function markCallbackReceived(jobId, callbackPayload) {
  if (!jobId) return; // not all callbacks reference a job (e.g. cold inbound)
  await supabase
    .from('lindy_jobs')
    .update({
      status: 'callback_received',
      callback_received_at: new Date().toISOString(),
      callback_payload: callbackPayload,
    })
    .eq('id', jobId);
}

// ----------------------------------------------------------------
// Convenience helpers — typed wrappers around dispatchAgent for the
// most-common call sites. Pass-through to dispatchAgent with the
// right agent_name baked in.
// ----------------------------------------------------------------
export function callLead({ lead, campaign = null, storm_context = null, ...rest }) {
  if (!lead?.phone && !lead?.mobile) {
    throw new Error('lead.phone or lead.mobile required');
  }
  return dispatchAgent({
    agent: 'jh-outbound-caller',
    lead_id: lead.id,
    campaign_id: campaign?.id ?? null,
    payload: {
      lead_id: lead.id,
      first_name: lead.first_name || '',
      phone: lead.mobile || lead.phone,
      street: lead.street || '',
      city: lead.city || '',
      campaign_label: campaign?.name || '',
      storm_context: storm_context || '',
    },
    ...rest,
  });
}

export function dropVoicemail({ leads, voicemail_audio_url, campaign = null, ...rest }) {
  if (!Array.isArray(leads) || !leads.length) throw new Error('leads array required');
  if (!voicemail_audio_url) throw new Error('voicemail_audio_url required');
  return dispatchAgent({
    agent: 'jh-voicemail-dropper',
    campaign_id: campaign?.id ?? null,
    payload: {
      voicemail_audio_url,
      leads: leads.map((l) => ({
        lead_id: l.id,
        phone: l.mobile || l.phone,
        first_name: l.first_name || '',
      })),
    },
    ...rest,
  });
}

export function classifyReply({ channel, lead, message, thread_history = [], ...rest }) {
  return dispatchAgent({
    agent: 'jh-reply-classifier',
    lead_id: lead?.id ?? null,
    payload: {
      channel,                                 // 'email' | 'sms'
      lead_id: lead?.id ?? null,
      from: message.from,                      // phone or email
      subject: message.subject || null,        // email only
      body: message.body,
      thread_history,
    },
    ...rest,
  });
}

export function enrichLead({ lead, ...rest }) {
  if (!lead?.id) throw new Error('lead.id required');
  return dispatchAgent({
    agent: 'jh-enricher',
    lead_id: lead.id,
    payload: {
      lead_id: lead.id,
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      street: lead.street || '',
      city: lead.city || '',
      state: lead.state || 'TX',
      zip: lead.zip || '',
    },
    ...rest,
  });
}

export function startStormBlast({ storm, campaign, leads, ...rest }) {
  if (!Array.isArray(leads) || !leads.length) throw new Error('leads array required');
  if (!campaign?.id) throw new Error('campaign.id required');
  return dispatchAgent({
    agent: 'jh-storm-broadcaster',
    campaign_id: campaign.id,
    storm_event_id: storm?.id ?? null,
    payload: {
      storm_event_id: storm?.id ?? null,
      storm_date: storm?.detected_at || storm?.received_at || new Date().toISOString(),
      swath_size_in: storm?.swath_size_in ?? null,
      affected_zips: storm?.affected_zips ?? [],
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      leads: leads.map((l) => ({
        lead_id: l.id,
        phone: l.mobile || l.phone,
        email: l.email || null,
        first_name: l.first_name || '',
        last_name: l.last_name || '',
        street: l.street || '',
        priority_score: l.priority_score ?? 0.5,
      })),
      // Forward sub-agent webhooks so storm-broadcaster can fan out.
      outbound_caller_webhook:    process.env.LINDY_OUTBOUND_CALLER_URL,
      outbound_caller_token:      process.env.LINDY_OUTBOUND_CALLER_TOKEN,
      voicemail_dropper_webhook:  process.env.LINDY_VOICEMAIL_DROPPER_URL,
      voicemail_dropper_token:    process.env.LINDY_VOICEMAIL_DROPPER_TOKEN,
    },
    ...rest,
  });
}

export function dailyRecap({ to_phone, stats, hot_lead_summaries = [], ...rest }) {
  return dispatchAgent({
    agent: 'jh-recap-caller',
    payload: {
      to_phone: to_phone || '+15122213013',
      stats,
      hot_lead_summaries,
    },
    triggered_by: 'cron',
    ...rest,
  });
}

