// GET /api/cron/drip-tick
// ----------------------------------------------------------------
// Vercel cron — runs every 5 minutes. Scans drip_lead_state for
// due actions and dispatches them via the right channel.
//
// Auth: Vercel cron has its own header, but we also accept manual
// trigger via Authorization: Bearer LINDY_CALLBACK_SECRET (we reuse
// that secret as the generic admin-cron secret).

import { tick } from '../../lib/drip-engine.js';

export const config = { maxDuration: 60 };

function authOk(req) {
  if (req.headers['x-vercel-cron-signature']) return true;
  const secret = process.env.LINDY_CALLBACK_SECRET;
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const fromQs = url.searchParams.get('secret');
  return secret && (auth === secret || fromQs === secret);
}

export default async function handler(req, res) {
  if (!authOk(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const dryRun = url.searchParams.get('dry') === '1';
    const result = await tick({ dryRun });
    return res.status(200).json({ ok: true, ...result, ts: new Date().toISOString() });
  } catch (err) {
    console.error('[cron/drip-tick]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
