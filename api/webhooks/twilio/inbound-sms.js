// POST /api/webhooks/twilio/inbound-sms
// ----------------------------------------------------------------
// Twilio fires this when a recipient texts our toll-free number back.
// Set this webhook URL in Twilio Console → your TF number → Messaging
// → "A MESSAGE COMES IN: Webhook" → https://justhail.net/api/webhooks/twilio/inbound-sms
//
// Behavior:
//   1. Look up the lead by phone (peer_number)
//   2. Save the inbound message in drip_touches (event_type=replied)
//   3. Detect opt-out keywords → mark lead opted_out + write consent_log
//   4. Detect opt-in keywords (START/JOIN/YES) → un-opt-out the lead
//   5. Otherwise: mark hot_lead + send Charlie an alert
//
// Returns TwiML — empty <Response/> means "no auto-reply" except for
// the opt-out confirmation (CTIA-compliant).

import { supabase } from '../../../lib/supabase.js';
import { send as sendSms } from '../../../lib/twilio-sms.js';
import { capture as posthogCapture } from '../../../lib/posthog.js';

export const config = { api: { bodyParser: true }, maxDuration: 30 };

const OPT_OUT = /\b(STOP|UNSUB|UNSUBSCRIBE|REMOVE|QUIT|END|CANCEL|OPTOUT|OPT[- ]?OUT)\b/i;
const OPT_IN  = /\b(START|JOIN|YES|UNSTOP|RESUME|SUBSCRIBE)\b/i;
const HELP    = /\b(HELP|INFO|SUPPORT)\b/i;

function findLead(phone) {
  // Try matching phone variants
  const digits = String(phone).replace(/\D/g, '');
  const variants = [phone, digits];
  if (digits.length === 11) variants.push(digits.slice(1));
  if (digits.length === 10) variants.push('+1' + digits, '1' + digits);
  return supabase
    .from('leads')
    .select('id, first_name, last_name, opted_out, status, campaign_id')
    .or(variants.map(v => `phone.eq.${v},mobile.eq.${v}`).join(','))
    .limit(1)
    .maybeSingle();
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'text/xml');
  if (req.method !== 'POST') {
    return res.status(405).send('<Response/>');
  }

  try {
    const body = req.body || {};
    const From = body.From;
    const To = body.To;
    const Body = String(body.Body || '').trim();
    const sid = body.MessageSid;

    const { data: lead } = await findLead(From);
    const leadId = lead?.id || null;

    // Find an active drip_lead_state for this lead (if any) — so we can
    // attribute this reply to the right campaign
    let stateRow = null;
    if (leadId) {
      const { data } = await supabase
        .from('drip_lead_state')
        .select('id, drip_campaign_id, current_step')
        .eq('lead_id', leadId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      stateRow = data;
    }

    // Log the inbound touch
    await supabase.from('drip_touches').insert({
      drip_campaign_id: stateRow?.drip_campaign_id ?? null,
      lead_id: leadId,
      drip_lead_state_id: stateRow?.id ?? null,
      step_number: stateRow?.current_step ?? null,
      channel: 'sms',
      event_type: 'replied',
      recipient: To,                 // we received it
      sender: From,                  // they sent it
      body: Body,
      reply_body: Body,
      provider: 'twilio',
      provider_message_id: sid,
      provider_response: body,
    });

    // PostHog mirror
    if (leadId) {
      try {
        await posthogCapture({
          event: 'sms_replied',
          distinctId: 'lead_' + leadId,
          properties: { from: From, body_chars: Body.length },
        });
      } catch {}
    }

    // ---- Opt-out detection ----
    if (OPT_OUT.test(Body)) {
      if (leadId) {
        await supabase.from('leads').update({
          opted_out: true,
          status: 'do_not_contact',
          last_touched_at: new Date().toISOString(),
          last_channel: 'sms',
        }).eq('id', leadId);
      }
      // Stop the drip
      if (stateRow) {
        await supabase.from('drip_lead_state').update({
          status: 'opted_out',
          opted_out_at: new Date().toISOString(),
          scheduled_at: null,
        }).eq('id', stateRow.id);
      }
      // Audit log
      await supabase.from('consent_log').insert({
        lead_id: leadId,
        channel: 'sms',
        action: 'opt_out',
        source: 'sms_reply',
        trigger_message: Body,
        trigger_message_sid: sid,
        raw_payload: body,
      });
      // CTIA-compliant single opt-out confirmation (sent via TwiML so it doesn't
      // re-trigger our gates)
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>You're unsubscribed. You won't receive further messages from Just Hail. Reply START to re-subscribe.</Message></Response>`);
    }

    // ---- Opt-in detection ----
    if (OPT_IN.test(Body)) {
      if (leadId) {
        await supabase.from('leads').update({
          opted_out: false,
          status: 'engaged',
        }).eq('id', leadId);
        await supabase.from('consent_log').insert({
          lead_id: leadId,
          channel: 'sms',
          action: 'opt_in',
          source: 'sms_reply',
          trigger_message: Body,
          trigger_message_sid: sid,
          raw_payload: body,
        });
      }
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>You're back in — thanks. — Charlie, Just Hail (512) 221-3013</Message></Response>`);
    }

    // ---- Help ----
    if (HELP.test(Body)) {
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Just Hail customer support. Reply STOP to opt out. For help: (512) 221-3013 or info.justhail@gmail.com</Message></Response>`);
    }

    // ---- Otherwise: mark hot + alert Charlie ----
    if (stateRow) {
      await supabase.from('drip_lead_state').update({
        hot_lead: true,
        engagement_score: 100,    // explicit reply = max
        last_action_at: new Date().toISOString(),
      }).eq('id', stateRow.id);
    }
    if (leadId) {
      await supabase.from('leads').update({
        status: 'engaged',
        last_touched_at: new Date().toISOString(),
        last_channel: 'sms',
      }).eq('id', leadId);
    }
    // Alert Charlie via SMS (to his cell). Bypass gates: this is a transactional
    // notification to him about HIS business, not a cold send.
    try {
      const charlieCell = '+15122213013';
      const leadName = lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : 'unknown lead';
      const preview = Body.length > 80 ? Body.slice(0, 80) + '…' : Body;
      await sendSms({
        to: charlieCell,
        body: `🔥 HOT LEAD reply from ${leadName} (${From}): "${preview}"\nCheck admin: justhail.net/admin`,
        bypass_quiet_hours: true,
        bypass_dnc: true,
        bypass_lookup: true,
        source: 'reply',
      });
    } catch (e) {
      console.warn('[inbound-sms] alert to Charlie failed:', e.message);
    }

    // Empty TwiML = no auto-reply. Charlie handles personally.
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
  } catch (err) {
    console.error('[twilio/inbound-sms]', err);
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
  }
}
