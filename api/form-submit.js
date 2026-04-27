// POST /api/form-submit
// ----------------------------------------------------------------
// The CONVERSION endpoint. Fired from form.jsx when a visitor submits
// the contact form on justhail.net. Closes the loop:
//
//   email click → site visit → form submit → leads upsert →
//   drip_lead_state engagement update → SMS retarget → hot alert
//
// What this endpoint does (in order):
//
//   1. Parse + light-validate the form payload
//   2. Bouncer-verify the email (cache hit usually = free)
//   3. Twilio Lookup the phone (cache hit usually = free)
//   4. UPSERT into leads table — match by email, then phone, else new
//   5. Write consent_log row (TCPA audit trail w/ disclosure text)
//   6. If utm_campaign or pid in source_url, match back to the originating
//      drip_lead_state and mark it engaged + hot_lead + score=100
//   7. If smsConsent && DNC clear && Twilio configured:
//      → fire immediate transactional "thanks {name}, Charlie..." SMS
//   8. Send hot-lead alert SMS to Charlie's cell
//   9. Send confirmation email to lead via Resend
//  10. Return success JSON
//
// All side effects are wrapped in try/catch so one failure (e.g.,
// Twilio approval pending) doesn't break the rest of the loop.

import { supabase } from '../lib/supabase.js';
import { verify as verifyEmail } from '../lib/bouncer.js';
import { lookup as lookupPhone, normalizePhone } from '../lib/twilio-lookup.js';
import { check as dncCheck } from '../lib/dnc.js';
import { send as sendSms } from '../lib/twilio-sms.js';
import { sendEmail } from '../lib/email.js';
import { capture as posthogCapture } from '../lib/posthog.js';

export const config = { api: { bodyParser: { sizeLimit: '128kb' } }, maxDuration: 30 };

// CORS — form lives on justhail.net, can call our API on the same origin
function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  // Allow our own domains + dev
  const allowed = [
    'https://justhail.net',
    'https://www.justhail.net',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};

    // ---------- 1. Parse ----------
    const name           = String(body.name || '').trim().slice(0, 200);
    const [firstName, ...lastParts] = name.split(/\s+/);
    const lastName       = lastParts.join(' ');
    const email          = String(body.email || '').trim().toLowerCase();
    const phoneRaw       = String(body.phone || '').trim();
    const phoneE164      = normalizePhone(phoneRaw);
    const zip            = String(body.zip || '').trim();
    const vehicle        = String(body.vehicle || '').trim().slice(0, 200);
    const year           = String(body.year || '').trim().slice(0, 4);
    const damage         = String(body.damage || '').trim().slice(0, 500);
    const insurer        = String(body.insurer || '').trim().slice(0, 100);
    const severityNum    = parseInt(body.severity, 10) || 3;
    const severityLabel  = String(body.severityLabel || '').trim();
    const estimatedRange = String(body.estimatedRange || '').trim();
    const timeline       = String(body.timeline || '').trim();
    const notes          = String(body.notes || '').trim().slice(0, 2000);
    const referenceNumber= String(body.referenceNumber || '').trim();
    const smsConsent     = body.smsConsent === true || body.smsConsent === 'true';
    const consentText    = String(body.smsConsentText || '').trim();
    const consentVersion = String(body.smsConsentVersion || '').trim();
    const sourceUrl      = String(body.source_url || req.headers.referer || '').trim();
    const userAgent      = String(body.userAgent || req.headers['user-agent'] || '').slice(0, 500);

    // Light validation
    if (!email || !/@/.test(email)) {
      return res.status(400).json({ ok: false, error: 'valid email required' });
    }
    if (!phoneE164) {
      return res.status(400).json({ ok: false, error: 'valid phone required' });
    }
    if (!firstName) {
      return res.status(400).json({ ok: false, error: 'name required' });
    }

    // Extract Hailey UTM attribution from source_url query string
    const utm = parseUtm(sourceUrl);
    const dripCampaignIdFromUrl = parseInt(utm.utm_campaign || '0', 10) || null;
    const dripLeadIdFromUrl     = parseInt(utm.pid || '0', 10) || null;
    const dripStepFromUrl       = parseInt(utm.utm_content || utm.drip_step || '0', 10) || null;

    // ---------- 2 + 3. Verify in parallel (both cache-hit usually) ----------
    const [emailVerify, phoneLookup] = await Promise.all([
      verifyEmail(email).catch(() => ({ ok: false, status: 'unknown', usable: true })),
      lookupPhone(phoneE164).catch(() => ({ ok: false, valid: false, sms_able: false })),
    ]);

    // ---------- 4. UPSERT into leads ----------
    // Match priority: existing lead with this email → with this phone → new
    let leadRow = null;
    {
      const { data: byEmail } = await supabase
        .from('leads')
        .select('id, source, status, opted_out, campaign_id, first_name, last_name')
        .eq('email', email)
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (byEmail) leadRow = byEmail;
    }
    if (!leadRow) {
      const { data: byPhone } = await supabase
        .from('leads')
        .select('id, source, status, opted_out, campaign_id, first_name, last_name')
        .or(`phone.eq.${phoneE164},mobile.eq.${phoneE164}`)
        .limit(1)
        .maybeSingle();
      if (byPhone) leadRow = byPhone;
    }

    const leadPayload = {
      first_name: firstName || leadRow?.first_name,
      last_name:  lastName || leadRow?.last_name,
      email,
      mobile: phoneE164,
      zip: zip || null,
      vehicle_estimate: {
        vehicle, year, damage, insurer,
        severity: severityNum,
        severity_label: severityLabel,
        estimated_range: estimatedRange,
        timeline,
        notes,
      },
      // status: bump to 'engaged' on form submit (warm lead)
      status: leadRow?.opted_out ? leadRow.status : 'engaged',
      last_touched_at: new Date().toISOString(),
      last_channel: 'web_form',
    };

    let leadId = leadRow?.id || null;
    if (leadRow) {
      await supabase.from('leads').update(leadPayload).eq('id', leadRow.id);
    } else {
      // New lead — give it a source so we can attribute
      const { data: inserted, error: insErr } = await supabase
        .from('leads')
        .insert({
          ...leadPayload,
          source: 'website_form',
          external_key: referenceNumber || null,
          source_system_id: referenceNumber || null,
          opted_out: false,
        })
        .select('id')
        .single();
      if (insErr) {
        console.error('[form-submit] lead insert failed:', insErr);
        // Don't fail the whole flow — keep going to log + alert Charlie
      } else {
        leadId = inserted?.id;
      }
    }

    // ---------- 5. Consent log ----------
    if (smsConsent) {
      try {
        await supabase.from('consent_log').insert({
          lead_id: leadId,
          channel: 'sms',
          action: 'opt_in',
          source: 'web_form',
          disclosure_text: consentText || null,
          consent_version: consentVersion || null,
          source_url: sourceUrl || null,
          user_agent: userAgent || null,
          reference_number: referenceNumber || null,
          ip_address: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
          raw_payload: body,
        });
      } catch (err) {
        console.error('[form-submit] consent_log insert failed:', err);
      }
    }

    // ---------- 6. Match back to drip enrollment + mark engaged ----------
    let matchedDripState = null;
    if (leadId) {
      // Try 1: explicit pid in URL → state by lead_id + that drip
      if (dripLeadIdFromUrl && dripCampaignIdFromUrl) {
        const { data } = await supabase
          .from('drip_lead_state')
          .select('id, drip_campaign_id, lead_id, current_step, hot_lead, engagement_score')
          .eq('lead_id', dripLeadIdFromUrl)
          .eq('drip_campaign_id', dripCampaignIdFromUrl)
          .maybeSingle();
        matchedDripState = data;
      }
      // Try 2: any active drip with this lead_id
      if (!matchedDripState) {
        const { data } = await supabase
          .from('drip_lead_state')
          .select('id, drip_campaign_id, lead_id, current_step, hot_lead, engagement_score')
          .eq('lead_id', leadId)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        matchedDripState = data;
      }

      if (matchedDripState) {
        await supabase.from('drip_lead_state').update({
          hot_lead: true,
          engagement_score: 100,                   // form fill = max engagement
          status: 'engaged',                       // pause the drip — Charlie takes over from here
          last_action_at: new Date().toISOString(),
        }).eq('id', matchedDripState.id);

        // Log a touch event so the lead's timeline shows the conversion
        await supabase.from('drip_touches').insert({
          drip_campaign_id: matchedDripState.drip_campaign_id,
          lead_id: leadId,
          drip_lead_state_id: matchedDripState.id,
          step_number: matchedDripState.current_step,
          channel: 'web',
          event_type: 'form_submitted',
          recipient: email,
          body: `Form submission: ${vehicle ? vehicle + ' · ' : ''}${severityLabel}${estimatedRange ? ' · ' + estimatedRange : ''}${notes ? '\nNotes: ' + notes.slice(0, 200) : ''}`,
          metadata: { reference_number: referenceNumber, source_url: sourceUrl, utm },
        });
      }
    }

    // ---------- 7. SMS retarget — immediate "thanks" reply ----------
    let smsResult = null;
    if (smsConsent && phoneE164) {
      const dnc = await dncCheck(phoneE164);
      if (dnc.safe_to_contact && phoneLookup.sms_able) {
        const smsBody = `Thanks ${firstName || 'there'}, Charlie at Just Hail. Got your inspection request — I'll text you back within 1 business day to schedule. Reply STOP to opt out. — Just Hail (512) 221-3013`;
        smsResult = await sendSms({
          to: phoneE164,
          body: smsBody,
          lead_id: leadId,
          drip_campaign_id: matchedDripState?.drip_campaign_id || null,
          drip_lead_state_id: matchedDripState?.id || null,
          source: 'form_thank_you',
          // Form-fill is opt-in by definition — but we still run gates as defense
        }).catch((err) => ({ ok: false, error: err.message }));
      } else {
        smsResult = {
          ok: false,
          reason: !dnc.safe_to_contact
            ? `dnc_blocked: ${dnc.reason}`
            : `not_sms_able: line_type=${phoneLookup.line_type || 'unknown'}`,
        };
      }
    } else if (!smsConsent) {
      smsResult = { ok: false, reason: 'no_sms_consent' };
    }

    // ---------- 8. Hot-lead alert SMS to Charlie ----------
    try {
      const charlieCell = '+15122213013';
      const preview = `${firstName} ${lastName} · ${vehicle || 'vehicle'} ${year ? '(' + year + ')' : ''} · ${severityLabel || 'severity ' + severityNum}${estimatedRange ? ' · est ' + estimatedRange : ''}`.slice(0, 140);
      await sendSms({
        to: charlieCell,
        body: `🔥 NEW LEAD via form: ${preview}\n📞 ${phoneE164}\n✉ ${email}\nRef: ${referenceNumber}\nAdmin: justhail.net/admin`,
        bypass_quiet_hours: true,
        bypass_dnc: true,
        bypass_lookup: true,
        source: 'form_alert',
      }).catch((e) => console.warn('[form-submit] charlie alert failed:', e.message));
    } catch (err) {
      console.error('[form-submit] charlie alert exception:', err);
    }

    // ---------- 9. Confirmation email to lead ----------
    try {
      await sendEmail({
        to: email,
        subject: 'Got your hail inspection request',
        text:
`${firstName || 'Hi'} —

Got your form. I'll text or call within 1 business day to schedule the free inspection.

A few things you can know already:
• I bring the inspection to you — 20 minutes, no commitment.
• I bill insurance direct (38 carriers). Most Texas hail claims have the deductible waived under "act of nature" comp.
• Lifetime workmanship warranty on every PDR job, transferable by VIN.

If you have photos of the damage, you can text them to (512) 221-3013 — speeds things up.

Talk soon.

— Charlie
Just Hail | Leander, TX
(512) 221-3013

Reference: ${referenceNumber}`,
        tags: [
          { name: 'form_confirmation', value: 'true' },
          { name: 'lead_id', value: String(leadId || '') },
          { name: 'reference_number', value: referenceNumber },
        ],
      });
    } catch (err) {
      console.error('[form-submit] confirmation email failed:', err);
    }

    // ---------- 10. PostHog mirror ----------
    try {
      if (leadId) {
        await posthogCapture({
          event: 'form_submitted',
          distinctId: 'lead_' + leadId,
          properties: {
            reference_number: referenceNumber,
            email,
            phone: phoneE164,
            vehicle, year, severity: severityNum,
            sms_consent: smsConsent,
            drip_campaign_id: matchedDripState?.drip_campaign_id || null,
            matched_drip: !!matchedDripState,
            email_verified_status: emailVerify.status,
            phone_line_type: phoneLookup.line_type,
            sms_dispatched: !!smsResult?.ok,
          },
        });
      }
    } catch {}

    // ---------- DONE ----------
    return res.status(200).json({
      ok: true,
      lead_id: leadId,
      reference_number: referenceNumber,
      matched_drip: !!matchedDripState,
      drip_campaign_id: matchedDripState?.drip_campaign_id || null,
      sms_dispatched: !!smsResult?.ok,
      sms_status: smsResult?.ok ? 'sent' : (smsResult?.reason || 'skipped'),
      email_status: emailVerify.status,
      phone_line_type: phoneLookup.line_type || 'unknown',
    });
  } catch (err) {
    console.error('[form-submit] unhandled:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

function parseUtm(url) {
  if (!url) return {};
  try {
    const u = new URL(url);
    const out = {};
    for (const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','pid','drip_id','drip_step']) {
      const v = u.searchParams.get(k);
      if (v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
