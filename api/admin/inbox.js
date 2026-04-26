// GET /api/admin/inbox?type=sms|call|all&limit=50&since=ISO
// ----------------------------------------------------------------
// Read endpoint backing the admin "Replies" + "Calls" tabs. Returns
// a unified stream of recent communication activity, joined with
// the lead row when possible.
//
// Defaults: type=all, limit=50, since=24h ago.

import { supabase } from '../../lib/supabase.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const type  = (url.searchParams.get('type') || 'all').toLowerCase();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const since = url.searchParams.get('since') ||
    new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const onlyHot = url.searchParams.get('hot') === '1';

  try {
    const tasks = [];
    if (type === 'sms' || type === 'all') {
      let q = supabase
        .from('sms_messages')
        .select(`
          id, created_at, direction, body, classification,
          hot_lead_flag, opt_out_flag, peer_number, status,
          lead_id, leads ( id, first_name, last_name, street, city, state, status )
        `)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (onlyHot) q = q.eq('hot_lead_flag', true);
      tasks.push(q.then((r) => ({ kind: 'sms', rows: r.data || [], error: r.error })));
    }

    if (type === 'call' || type === 'all') {
      let q = supabase
        .from('call_logs')
        .select(`
          id, created_at, source, agent_name, outcome,
          duration_seconds, summary, hot_lead_flag, opt_out_flag,
          booked_inspection, booked_slot_at, from_number, to_number,
          recording_url, lead_id,
          leads ( id, first_name, last_name, street, city, state, status )
        `)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (onlyHot) q = q.eq('hot_lead_flag', true);
      tasks.push(q.then((r) => ({ kind: 'call', rows: r.data || [], error: r.error })));
    }

    const results = await Promise.all(tasks);
    const out = {
      sms: [], calls: [],
      counts: { sms_total: 0, sms_hot: 0, sms_optout: 0, calls_total: 0, calls_booked: 0 },
      since,
    };
    for (const r of results) {
      if (r.kind === 'sms')  out.sms = r.rows;
      if (r.kind === 'call') out.calls = r.rows;
    }
    out.counts.sms_total    = out.sms.length;
    out.counts.sms_hot      = out.sms.filter((s) => s.hot_lead_flag).length;
    out.counts.sms_optout   = out.sms.filter((s) => s.opt_out_flag).length;
    out.counts.calls_total  = out.calls.length;
    out.counts.calls_booked = out.calls.filter((c) => c.booked_inspection).length;

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, ...out, fetched_at: new Date().toISOString() });
  } catch (err) {
    console.error('[admin/inbox]', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
