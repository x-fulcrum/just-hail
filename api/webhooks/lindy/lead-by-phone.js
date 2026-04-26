// GET /api/webhooks/lindy/lead-by-phone?phone=...
// ----------------------------------------------------------------
// Lookup endpoint used by jh-sms-handler when an inbound SMS comes
// in: it asks us "do we know this number?" and we return the lead
// details + recent outreach context. Cached aggressively (10s).
//
// Auth: same secret-header check as the POST receivers, but returns
// a JSON response. We accept the secret either as `Authorization:
// Bearer <secret>` or `?secret=...` query string (Lindy GET helpers
// often use the latter).

import { findLeadByPhone } from '../../../lib/lindy-webhook.js';
import { supabase } from '../../../lib/supabase.js';

export const config = { api: { bodyParser: false } };

function authOk(req) {
  const secret = process.env.LINDY_CALLBACK_SECRET;
  if (!secret) return false;
  const fromAuth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const fromHdr  = req.headers['x-lindy-secret'] || req.headers['x-lindy-callback-secret'];
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const fromQs = url.searchParams.get('secret') || url.searchParams.get('callback_secret');
  return fromAuth === secret || fromHdr === secret || fromQs === secret;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false });
  }
  if (!authOk(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const phone = url.searchParams.get('phone') || url.searchParams.get('from');
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

  const lead = await findLeadByPhone(phone);
  if (!lead) {
    res.setHeader('Cache-Control', 'public, s-maxage=10');
    return res.status(200).json({ ok: true, found: false });
  }

  // Pull the last 5 SMS in the thread + last call for context
  const [smsThread, recentCalls] = await Promise.all([
    supabase
      .from('sms_messages')
      .select('id, direction, body, created_at, classification')
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('call_logs')
      .select('id, source, outcome, summary, created_at')
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: false })
      .limit(2),
  ]);

  res.setHeader('Cache-Control', 'public, s-maxage=10');
  return res.status(200).json({
    ok: true,
    found: true,
    lead,
    sms_thread: (smsThread.data || []).reverse(),  // chronological for the agent
    recent_calls: recentCalls.data || [],
  });
}
