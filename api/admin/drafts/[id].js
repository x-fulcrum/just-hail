// PATCH /api/admin/drafts/:id   → update body/subject or toggle approved
// DELETE /api/admin/drafts/:id  → discard draft
//
// Body (PATCH):
//   { body?: string, subject?: string, approved?: boolean }
//
// Approving a draft means it's ready to be sent in Phase 3B. Once sent
// (sent_at is set), it becomes immutable (return 409 on further edits).

import { supabase } from '../../../lib/supabase.js';

export const config = { api: { bodyParser: false } };

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  const draftId = parseInt(req.query.id, 10);
  if (!draftId) return res.status(400).json({ error: 'Invalid draft id' });

  if (req.method === 'PATCH')  return handlePatch(req, res, draftId);
  if (req.method === 'DELETE') return handleDelete(req, res, draftId);

  res.setHeader('Allow', 'PATCH, DELETE');
  return res.status(405).json({ error: 'Method Not Allowed' });
}

async function handlePatch(req, res, draftId) {
  const body = await readJson(req);
  const { data: existing } = await supabase
    .from('lead_outreach_drafts').select('*').eq('id', draftId).single();
  if (!existing) return res.status(404).json({ error: 'Draft not found' });
  if (existing.sent_at) return res.status(409).json({ error: 'Draft already sent, cannot edit' });

  const patch = {};
  if (typeof body.body === 'string') patch.body = body.body;
  if (typeof body.subject === 'string') patch.subject = body.subject;
  if (typeof body.approved === 'boolean') patch.approved = body.approved;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await supabase
    .from('lead_outreach_drafts')
    .update(patch)
    .eq('id', draftId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, draft: data });
}

async function handleDelete(req, res, draftId) {
  const { error } = await supabase
    .from('lead_outreach_drafts').delete().eq('id', draftId);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
