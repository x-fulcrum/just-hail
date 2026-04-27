// POST /api/webhooks/twilio/status
// ----------------------------------------------------------------
// Twilio fires this on every SMS status change:
//   queued → sent → delivered (or failed/undelivered)
//
// Twilio sends application/x-www-form-urlencoded:
//   MessageSid, MessageStatus, To, From, ErrorCode (optional)
//
// We look up the original 'sent' touch by Twilio MessageSid and
// insert a NEW touch with the new event_type.

import { supabase } from '../../../lib/supabase.js';

export const config = { api: { bodyParser: true }, maxDuration: 30 };

const STATUS_MAP = {
  queued:       'queued',
  sending:      'sending',
  sent:         'sent',
  delivered:    'delivered',
  undelivered:  'undeliverable',
  failed:       'failed',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  try {
    // Twilio uses form-encoded; Vercel parses both based on Content-Type
    const body = req.body || {};
    const sid = body.MessageSid || body.SmsSid;
    const status = String(body.MessageStatus || body.SmsStatus || '').toLowerCase();
    if (!sid) return res.status(200).end();   // bad request, but ack

    const ourStatus = STATUS_MAP[status] || status;

    // Find the original 'sent' touch
    const { data: orig } = await supabase
      .from('drip_touches')
      .select('id, drip_campaign_id, lead_id, drip_lead_state_id, step_number, recipient, body')
      .eq('provider', 'twilio')
      .eq('provider_message_id', sid)
      .eq('event_type', 'sent')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Insert the new event row (chained to original via parent_touch_id)
    await supabase.from('drip_touches').insert({
      drip_campaign_id: orig?.drip_campaign_id ?? null,
      lead_id:          orig?.lead_id ?? null,
      drip_lead_state_id: orig?.drip_lead_state_id ?? null,
      step_number:      orig?.step_number ?? null,
      channel:          'sms',
      event_type:       ourStatus,
      recipient:        body.To || orig?.recipient,
      sender:           body.From,
      provider:         'twilio',
      provider_message_id: sid,
      provider_response: body,
      parent_touch_id:  orig?.id ?? null,
      error_message:    body.ErrorCode ? `twilio_error_${body.ErrorCode}: ${body.ErrorMessage || ''}` : null,
    });

    // If failed/undelivered → mark state for review
    if (orig && (ourStatus === 'failed' || ourStatus === 'undeliverable')) {
      await supabase.from('drip_lead_state').update({
        last_failure: `sms_${ourStatus}: ${body.ErrorCode || 'unknown'}`,
      }).eq('id', orig.drip_lead_state_id);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[twilio/status]', err);
    return res.status(200).end();
  }
}
