// GET /api/webhooks/lindy/check-optout?phone=...
// ----------------------------------------------------------------
// Used by jh-voicemail-dropper as a final safety check before each
// drop. We pre-filter the bulk list before dispatching, but agents
// are encouraged to double-check at the moment of dispatch in case
// an opt-out came in mid-batch.

import { findLeadByPhone } from '../../../lib/lindy-webhook.js';

export const config = { api: { bodyParser: false } };

function authOk(req) {
  const secret = process.env.LINDY_CALLBACK_SECRET;
  if (!secret) return false;
  const fromAuth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const fromHdr  = req.headers['x-lindy-secret'] || req.headers['x-lindy-callback-secret'];
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const fromQs = url.searchParams.get('secret');
  return fromAuth === secret || fromHdr === secret || fromQs === secret;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false });
  }
  if (!authOk(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const phone = url.searchParams.get('phone');
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

  const lead = await findLeadByPhone(phone);
  const optedOut = !!lead?.opted_out;
  res.setHeader('Cache-Control', 'public, s-maxage=5');
  return res.status(200).json({
    ok: true,
    phone,
    opted_out: optedOut,
    lead_id: lead?.id || null,
  });
}
