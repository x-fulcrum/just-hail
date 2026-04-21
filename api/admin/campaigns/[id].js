// GET /api/admin/campaigns/:id
//
// Returns the campaign + its associated leads (most recent first).

import { supabase } from '../../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const { id } = req.query;
  const campaignId = parseInt(id, 10);
  if (!campaignId) return res.status(400).json({ error: 'Invalid campaign id' });

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
