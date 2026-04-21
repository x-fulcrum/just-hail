// POST /api/ihm-webhook
//
// Receives webhooks from Interactive Hail Maps. Verifies the HMAC
// signature against the raw body, writes a delivery log, then writes
// a normalized storm_events row. Returns 200 fast so IHM considers
// delivery successful; downstream processing (enrichment, outreach)
// runs async via Supabase triggers or scheduled jobs.
//
// Event types (set by subscribe.js via AgentWebhookType_id):
//   - monitoring_alert       — address we asked to monitor got hit
//   - marker_status_changed  — a pin moved New → Knocked → Signed → ...
//   - hail_alert             — geo-region storm event (HAIL_DETECTED, etc.)
//
// IMPORTANT: body-parser must NOT pre-parse the body — we need the raw
// bytes for HMAC verification. We set the config below to disable it.

import { verifyIhmSignature, flattenIhmPayload } from '../lib/ihm.js';
import { supabase } from '../lib/supabase.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

// Read the raw request body as a UTF-8 string.
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// IHM Discover doesn't document which webhook type ID maps to which
// payload shape, so we sniff the payload to figure it out. If none of
// the signatures match, default to 'hail_alert' and rely on `raw`.
function sniffEventType(payload) {
  if (!payload || typeof payload !== 'object') return 'unknown';
  if ('monitoringAlert_id' in payload || 'swathSize' in payload) return 'monitoring_alert';
  if ('changeDate' in payload || 'markerCreated' in payload) return 'marker_status_changed';
  if ('alertCategory' in payload || 'category' in payload) return 'hail_alert';
  return 'hail_alert';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let rawBody = '';
  let signatureValid = false;
  let parsed = null;
  let deliveryId = null;

  try {
    rawBody = await readRawBody(req);
    const signatureHeader = req.headers['x-webhook-signature'] || '';
    const secret = process.env.IHM_WEBHOOK_SECRET;

    signatureValid = verifyIhmSignature({
      rawBody,
      signatureHeader,
      secret,
    });

    // Try to parse regardless of signature result — we want to capture
    // the payload shape even for invalid signatures (for debugging).
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = null;
    }

    // Log the delivery, valid or not.
    const { data: delivery } = await supabase
      .from('webhook_deliveries')
      .insert({
        source: 'ihm',
        signature_header: signatureHeader || null,
        signature_valid: signatureValid,
        http_method: req.method,
        path: req.url,
        headers: {
          'user-agent': req.headers['user-agent'] || null,
          'content-type': req.headers['content-type'] || null,
          'x-webhook-signature': signatureHeader || null,
        },
        body: rawBody,
        parsed,
      })
      .select('id')
      .single();
    deliveryId = delivery?.id ?? null;

    // Reject if signature invalid — but return 200 so IHM doesn't retry
    // a forged payload forever. Log is kept for forensics.
    if (!signatureValid) {
      console.warn('[ihm-webhook] invalid signature, delivery_id=', deliveryId);
      return res.status(200).json({ ok: false, reason: 'invalid_signature' });
    }

    if (!parsed) {
      return res.status(200).json({ ok: false, reason: 'unparseable_body' });
    }

    // Normalize + insert the storm event.
    const eventType = sniffEventType(parsed);
    const flat = flattenIhmPayload(eventType, parsed);

    const { data: stormEvent, error: stormErr } = await supabase
      .from('storm_events')
      .insert(flat)
      .select('id')
      .single();

    if (stormErr) {
      console.error('[ihm-webhook] storm_events insert failed:', stormErr);
      return res.status(200).json({ ok: false, reason: 'storm_insert_failed' });
    }

    // Backfill the delivery row with the storm_event_id.
    if (deliveryId && stormEvent?.id) {
      await supabase
        .from('webhook_deliveries')
        .update({ storm_event_id: stormEvent.id })
        .eq('id', deliveryId);
    }

    return res.status(200).json({ ok: true, event_type: eventType, storm_event_id: stormEvent.id });
  } catch (err) {
    console.error('[ihm-webhook] unhandled error:', err);
    // Still return 200 so IHM doesn't endlessly retry. The delivery row
    // (if written) is our record.
    return res.status(200).json({ ok: false, reason: 'internal_error' });
  }
}
