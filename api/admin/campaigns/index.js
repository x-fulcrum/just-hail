// GET  /api/admin/campaigns       — list campaigns (most recent first)
// POST /api/admin/campaigns       — create a new campaign
//
// Create body: { name, target_type: 'zip'|'polygon'|'radius', target_input: {...}, storm_event_id? }
// Response:    { campaign: {...} }
//
// Side effects: inserts a row into campaigns with status='draft'. Enrichment
// runs via a follow-up POST to /api/admin/campaigns/:id/enrich. Split so we
// can show the campaign immediately and let the (potentially slow) enrichment
// happen async with a progress indicator.

import { supabase } from '../../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'GET')  return listCampaigns(req, res);
  if (req.method === 'POST') return createCampaign(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}

async function listCampaigns(req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, created_at, updated_at, name, status, target_type, target_input, storm_event_id, property_hits, contact_hits, estimated_cost_usd, enrichment_finished_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ campaigns: data });
}

async function createCampaign(req, res) {
  const body = await readJson(req);
  const { name, target_type, target_input, storm_event_id } = body || {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!['zip', 'polygon', 'radius', 'address_list', 'ihm_territory'].includes(target_type)) {
    return res.status(400).json({ error: 'target_type must be zip | polygon | radius | address_list | ihm_territory' });
  }
  if (!target_input || typeof target_input !== 'object') {
    return res.status(400).json({ error: 'target_input object is required' });
  }

  // Validate per type
  if (target_type === 'zip' && !/^\d{5}$/.test(String(target_input.zip || ''))) {
    return res.status(400).json({ error: 'target_input.zip must be a 5-digit ZIP' });
  }
  if (target_type === 'radius') {
    const { lat, lng, radius_miles } = target_input;
    if (typeof lat !== 'number' || typeof lng !== 'number' || typeof radius_miles !== 'number' || radius_miles <= 0 || radius_miles > 50) {
      return res.status(400).json({ error: 'radius requires lat, lng, and radius_miles (0-50)' });
    }
  }
  if (target_type === 'polygon') {
    const p = target_input.polygon;
    if (!Array.isArray(p) || p.length < 3) {
      return res.status(400).json({ error: 'polygon must be an array of >=3 [lat,lng] points' });
    }
  }

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      name,
      status: 'draft',
      target_type,
      target_input,
      storm_event_id: storm_event_id || null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ campaign: data });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

export const config = { api: { bodyParser: false } };
