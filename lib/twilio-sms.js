// Twilio SMS sender — with DNC + opt-out + quiet-hours gates.
// ----------------------------------------------------------------
// API: https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
//
// Every send goes through these gates IN ORDER, and any failure
// returns { ok: false, blocked: true, reason } WITHOUT making the
// network call:
//
//   1. Phone format normalize → E.164 (else: invalid_phone)
//   2. Lead opt-out check     → queries leads.opted_out (else: opted_out)
//   3. DNC scrub (RealPhoneValidation) (else: dnc_blocked / no_dnc_provider)
//   4. Quiet hours (8pm-9am recipient local) (else: quiet_hours)
//   5. Twilio Lookup line type (mobile only) (else: not_sms_able)
//
// Then it sends and writes the audit row.
//
// All sends write to drip_touches AND consent_log (when relevant).

import { normalizePhone, lookup } from './twilio-lookup.js';
import { check as dncCheck } from './dnc.js';
import { supabase } from './supabase.js';

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

function creds() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) throw new Error('TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set');
  return { sid, tok };
}

function defaultFrom() {
  return process.env.TWILIO_TF_PHONE_NUMBER       // toll-free preferred for SMS
      || process.env.TWILIO_PHONE_NUMBER          // fall back to original 10DLC
      || null;
}

// US quiet hours: 9 PM - 8 AM recipient-local. We approximate
// recipient timezone by area code → state → timezone. For a TX
// shop (most leads in TX), this is conservative but safe.
const AREA_CODE_TZ = {
  // Texas (Central)
  '210': 'America/Chicago', '214': 'America/Chicago', '254': 'America/Chicago',
  '281': 'America/Chicago', '325': 'America/Chicago', '346': 'America/Chicago',
  '361': 'America/Chicago', '409': 'America/Chicago', '430': 'America/Chicago',
  '432': 'America/Chicago', '469': 'America/Chicago', '512': 'America/Chicago',
  '682': 'America/Chicago', '713': 'America/Chicago', '726': 'America/Chicago',
  '737': 'America/Chicago', '806': 'America/Chicago', '817': 'America/Chicago',
  '830': 'America/Chicago', '832': 'America/Chicago', '903': 'America/Chicago',
  '915': 'America/Denver',           // El Paso (Mountain)
  '936': 'America/Chicago', '940': 'America/Chicago', '945': 'America/Chicago',
  '956': 'America/Chicago', '972': 'America/Chicago', '979': 'America/Chicago',
  // Default unknown → Central (closest to TX bias)
};

function isQuietHours(e164, now = new Date()) {
  const m = String(e164).match(/^\+1(\d{3})/);
  const ac = m ? m[1] : '';
  const tz = AREA_CODE_TZ[ac] || 'America/Chicago';
  // Render the current time in the target timezone, parse hour
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', hour12: false, timeZone: tz,
  });
  const hour = parseInt(fmt.format(now), 10);
  // Quiet from 21:00 to 07:59 (giving 1h buffer below 8am to be safe)
  return hour >= 21 || hour < 8;
}

// ----------------------------------------------------------------
// send — the one entry point
// ----------------------------------------------------------------
export async function send({
  to,
  body,
  from = null,
  lead_id = null,
  drip_campaign_id = null,
  drip_lead_state_id = null,
  step_number = null,
  bypass_quiet_hours = false,    // for explicit immediate send by Charlie
  bypass_dnc = false,            // ONLY for replying to inbound (opted-in by definition)
  bypass_lookup = false,         // ONLY for replying to inbound
  source = 'drip',                // drip | reply | manual_admin | hailey
}) {
  const e164 = normalizePhone(to);
  if (!e164) {
    return { ok: false, blocked: true, reason: 'invalid_phone_format', to };
  }

  // ---- GATE 1: Lead opt-out ----
  if (lead_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, opted_out, status')
      .eq('id', lead_id)
      .maybeSingle();
    if (lead?.opted_out) {
      await logTouch({
        drip_campaign_id, lead_id, drip_lead_state_id, step_number,
        channel: 'sms', event_type: 'failed', recipient: e164,
        error_message: 'lead_opted_out', body,
      });
      return { ok: false, blocked: true, reason: 'lead_opted_out', lead_id };
    }
  }

  // ---- GATE 2: DNC scrub (skip for replies to inbound — they opted in by texting us) ----
  if (!bypass_dnc) {
    const dnc = await dncCheck(e164);
    if (!dnc.safe_to_contact) {
      await logTouch({
        drip_campaign_id, lead_id, drip_lead_state_id, step_number,
        channel: 'sms', event_type: 'failed', recipient: e164,
        error_message: 'dnc_blocked: ' + dnc.reason, body,
      });
      return { ok: false, blocked: true, reason: 'dnc_blocked', dnc, e164 };
    }
  }

  // ---- GATE 3: Quiet hours ----
  if (!bypass_quiet_hours && isQuietHours(e164)) {
    return { ok: false, blocked: true, reason: 'quiet_hours', e164, defer_until_morning: true };
  }

  // ---- GATE 4: Lookup — must be SMS-able ----
  if (!bypass_lookup) {
    const lk = await lookup(e164);
    if (!lk.sms_able) {
      await logTouch({
        drip_campaign_id, lead_id, drip_lead_state_id, step_number,
        channel: 'sms', event_type: 'failed', recipient: e164,
        error_message: 'not_sms_able: line_type=' + lk.line_type, body,
      });
      return { ok: false, blocked: true, reason: 'not_sms_able', line_type: lk.line_type, e164 };
    }
  }

  // ---- DISPATCH ----
  const fromNum = from || defaultFrom();
  if (!fromNum) {
    return { ok: false, blocked: true, reason: 'no_sender_configured' };
  }

  const { sid, tok } = creds();
  const params = new URLSearchParams({
    To: e164,
    From: fromNum,
    Body: body,
  });
  // Wire status webhooks back to our own endpoint
  if (process.env.SITE_URL) {
    params.set('StatusCallback', process.env.SITE_URL.replace(/\/$/, '') + '/api/webhooks/twilio/status');
  }

  let res, raw;
  try {
    res = await fetch(`${TWILIO_BASE}/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'authorization': 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    raw = await res.json();
  } catch (err) {
    await logTouch({
      drip_campaign_id, lead_id, drip_lead_state_id, step_number,
      channel: 'sms', event_type: 'failed', recipient: e164, sender: fromNum,
      provider: 'twilio',
      error_message: 'network_error: ' + err.message, body,
    });
    return { ok: false, error: 'network_error: ' + err.message };
  }

  if (!res.ok) {
    await logTouch({
      drip_campaign_id, lead_id, drip_lead_state_id, step_number,
      channel: 'sms', event_type: 'failed', recipient: e164, sender: fromNum,
      provider: 'twilio', provider_response: raw,
      error_message: `twilio_${res.status}: ${raw?.message || ''}`,
      body,
    });
    return { ok: false, error: `twilio_${res.status}: ${raw?.message || ''}`, raw };
  }

  // Success — log the send
  const touchId = await logTouch({
    drip_campaign_id, lead_id, drip_lead_state_id, step_number,
    channel: 'sms', event_type: 'sent',
    recipient: e164, sender: fromNum,
    provider: 'twilio', provider_message_id: raw?.sid,
    provider_response: raw,
    body,
  });

  // Update lead's last_touched_at + last_channel
  if (lead_id) {
    await supabase.from('leads').update({
      last_touched_at: new Date().toISOString(),
      last_channel: 'sms',
    }).eq('id', lead_id);
  }

  return {
    ok: true,
    twilio_sid: raw?.sid,
    e164,
    from: fromNum,
    touch_id: touchId,
  };
}

// ----------------------------------------------------------------
// Internal: log a touch row + return its ID
// ----------------------------------------------------------------
async function logTouch(row) {
  try {
    const { data } = await supabase
      .from('drip_touches')
      .insert(row)
      .select('id')
      .single();
    return data?.id ?? null;
  } catch (err) {
    console.error('[twilio-sms] logTouch failed:', err);
    return null;
  }
}

// ----------------------------------------------------------------
// healthCheck — check both auth + that we have a sender configured
// ----------------------------------------------------------------
export async function healthCheck() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return { ok: false, configured: false, reason: 'no_credentials' };
  }
  if (!defaultFrom()) {
    return {
      ok: false,
      configured: true,
      reason: 'no_sender',
      message: 'TWILIO_TF_PHONE_NUMBER (or TWILIO_PHONE_NUMBER) not set. SMS will be blocked.',
    };
  }
  const start = Date.now();
  try {
    const { sid, tok } = creds();
    const r = await fetch(`${TWILIO_BASE}/Accounts/${sid}.json`, {
      headers: { 'authorization': 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') },
    });
    return {
      ok: r.ok,
      configured: true,
      latency_ms: Date.now() - start,
      from: defaultFrom(),
      ...(r.ok ? {} : { error: `http_${r.status}` }),
    };
  } catch (err) {
    return { ok: false, configured: true, latency_ms: Date.now() - start, error: err.message };
  }
}
