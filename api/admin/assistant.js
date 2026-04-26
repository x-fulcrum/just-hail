// Admin → Lindy Assistant bridge.
// ----------------------------------------------------------------
// POST /api/admin/assistant      — send a message to the bridge agent.
//                                  Returns immediately with the lindy_job_id;
//                                  the assistant's response arrives async via
//                                  /api/webhooks/lindy/assistant-result.
// GET  /api/admin/assistant      — poll for recent assistant exchanges
//                                  (so the chat UI can refresh).
//   ?thread_id=...               — scope to one chat thread
//   ?since=ISO                   — incremental fetch
//
// Threads are stored as `lindy_jobs` rows tagged with metadata.thread_id.

import { supabase } from '../../lib/supabase.js';
import { delegateToAssistant } from '../../lib/lindy.js';

export const config = { api: { bodyParser: true }, maxDuration: 30 };

function newThreadId() {
  // 12-char base36 — collision-resistant enough for chat threads.
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export default async function handler(req, res) {
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'GET')  return handleGet(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}

async function handlePost(req, res) {
  try {
    const body = req.body || {};
    const task = String(body.task || body.message || '').trim();
    if (!task) return res.status(400).json({ ok: false, error: 'task (or message) required' });

    const thread_id = body.thread_id || newThreadId();
    const triggered_by_user = (req.headers['x-admin-user'] || 'charlie').toString().slice(0, 60);

    const result = await delegateToAssistant({
      task,
      thread_id,
      context: body.context || null,
      lead_id: body.lead_id || null,
      campaign_id: body.campaign_id || null,
      triggered_by: 'admin_chat',
      triggered_by_user,
      metadata: { thread_id, user_message: task },
    });

    return res.status(result.ok ? 200 : 500).json({
      ok: result.ok,
      thread_id,
      lindy_job_id: result.job_id,
      http_status: result.http_status,
      error: result.error || null,
    });
  } catch (err) {
    console.error('[admin/assistant POST]', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}

async function handleGet(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const thread_id = url.searchParams.get('thread_id');
    const since = url.searchParams.get('since') ||
      new Date(Date.now() - 24 * 3600_000).toISOString();
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '40', 10), 200);

    let q = supabase
      .from('lindy_jobs')
      .select('id, created_at, status, request_payload, callback_payload, callback_received_at, metadata, error_message')
      .eq('agent_name', 'jh-assistant')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (thread_id) q = q.contains('metadata', { thread_id });

    const { data, error } = await q;
    if (error) throw error;

    // Flatten into chat messages: each row → { user, assistant?, ts }
    const messages = (data || []).map((row) => ({
      job_id: row.id,
      ts: row.created_at,
      user: row.metadata?.user_message || row.request_payload?.task || '',
      assistant: row.callback_payload?.summary
        || row.callback_payload?.result
        || (row.error_message ? `error: ${row.error_message}` : null),
      assistant_full: row.callback_payload || null,
      status: row.status,
      replied_at: row.callback_received_at,
    }));

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, thread_id, messages, since });
  } catch (err) {
    console.error('[admin/assistant GET]', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
