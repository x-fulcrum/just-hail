// GET    /api/admin/campaigns/:id   → campaign + leads
// DELETE /api/admin/campaigns/:id   → deletes campaign + all its leads
//
// Delete is gated by an X-Admin-Confirm header that must match the
// admin confirm code (currently "1234"). This is a weak UX confirm
// layered on top of the admin.html passcode gate, not real auth.
// Phase-3+: replace with a proper admin session token.

import { supabase } from '../../../lib/supabase.js';

const ADMIN_CONFIRM_CODE = '1234';

export default async function handler(req, res) {
  const { id } = req.query;
  const campaignId = parseInt(id, 10);
  if (!campaignId) return res.status(400).json({ error: 'Invalid campaign id' });

  if (req.method === 'GET') return handleGet(req, res, campaignId);
  if (req.method === 'DELETE') return handleDelete(req, res, campaignId);

  res.setHeader('Allow', 'GET, DELETE');
  return res.status(405).json({ error: 'Method Not Allowed' });
}

async function handleGet(req, res, campaignId) {
  const [{ data: campaign, error: cErr }, { data: leads, error: lErr }] = await Promise.all([
    supabase.from('campaigns').select('*').eq('id', campaignId).single(),
    supabase.from('leads')
      .select('id, created_at, first_name, last_name, email, phone, mobile, street, city, state, zip, estimated_home_value, year_built, source, status, opted_out')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  if (cErr) return res.status(500).json({ error: cErr.message });
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (lErr) return res.status(500).json({ error: lErr.message });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ campaign, leads: leads || [] });
}

async function handleDelete(req, res, campaignId) {
  const confirm = req.headers['x-admin-confirm'];
  if (confirm !== ADMIN_CONFIRM_CODE) {
    return res.status(401).json({ error: 'Invalid or missing confirm code' });
  }

  // Delete leads tied to this campaign first, then the campaign itself.
  // leads.campaign_id has ON DELETE SET NULL — we want to actually delete
  // the leads for this flow (cleanup of stale test data), so explicit.
  const { error: lErr, count: leadsDeleted } = await supabase
    .from('leads')
    .delete({ count: 'exact' })
    .eq('campaign_id', campaignId);
  if (lErr) return res.status(500).json({ error: 'lead delete failed: ' + lErr.message });

  const { error: cErr } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', campaignId);
  if (cErr) return res.status(500).json({ error: 'campaign delete failed: ' + cErr.message });

  return res.status(200).json({
    ok: true,
    campaign_id: campaignId,
    leads_deleted: leadsDeleted ?? 0,
  });
}
