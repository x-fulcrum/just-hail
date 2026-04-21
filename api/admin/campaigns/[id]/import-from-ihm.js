// POST /api/admin/campaigns/:id/import-from-ihm
//
// Body: { territory_id: number, debug?: boolean }
//
// Pulls contact data from IHM for the given Territory_id, parses the
// HTML table, and upserts one lead per row under this campaign.
//
// Returns:
//   { ok, imported, skipped, sample_contacts, html_length }
//
// If { debug: true }, also returns first 800 chars of the HTML response
// for forensic parser tuning.

import { supabase } from '../../../../lib/supabase.js';
import { getBulkContactListHtml, getTerritoryDetailsHtml, parseContactsFromHtml } from '../../../../lib/ihm-web.js';

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { id } = req.query;
  const campaignId = parseInt(id, 10);
  if (!campaignId) return res.status(400).json({ error: 'Invalid campaign id' });

  const body = await readJson(req);
  const territoryId = parseInt(body?.territory_id, 10);
  const debug = body?.debug === true;
  if (!territoryId) return res.status(400).json({ error: 'territory_id is required' });

  const { data: campaign } = await supabase
    .from('campaigns').select('id').eq('id', campaignId).single();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  // Try BulkContactList first (focused fragment). If empty, fall back
  // to the full Territory Details page, which has the same table inline.
  let html = '';
  let source = 'BulkContactList';
  try {
    html = await getBulkContactListHtml(territoryId);
  } catch (e) {
    return res.status(502).json({ error: 'IHM fetch failed (auth?)', details: e.message });
  }

  let contacts = parseContactsFromHtml(html);

  if (contacts.length === 0) {
    try {
      source = 'TerritoryDetails';
      html = await getTerritoryDetailsHtml(territoryId);
      contacts = parseContactsFromHtml(html);
    } catch (e) {
      return res.status(502).json({ error: 'IHM Territory Details fetch failed', details: e.message });
    }
  }

  if (contacts.length === 0) {
    return res.status(200).json({
      ok: false,
      reason: 'no_contacts_parsed',
      source,
      html_length: html.length,
      html_preview: html.slice(0, 800),
      note: 'Parser found 0 contacts. Either contact data hasn\'t been retrieved for this territory yet (click "Retrieve Contact Data" in IHM first) OR the HTML structure changed. Re-check html_preview.',
    });
  }

  // Build lead rows
  const now = new Date().toISOString();
  const leadRows = contacts.map((c, idx) => ({
    source:          'ihm_territory',
    external_key:    `ihm-t${territoryId}-${idx}-${[c.street, c.zip, c.phone, c.email].filter(Boolean).join('|').slice(0, 80)}`,
    source_system_id:`ihm-t${territoryId}`,
    campaign_id:     campaignId,
    first_name:      c.first_name,
    last_name:       c.last_name,
    email:           c.email,
    phone:           c.phone,
    mobile:          c.mobile,
    street:          c.street,
    city:            c.city,
    state:           c.state,
    zip:             c.zip,
    status:          'new',
    updated_at:      now,
    metadata:        { ihm_territory_id: territoryId, imported_via: source },
  }));

  const { data, error } = await supabase
    .from('leads')
    .upsert(leadRows, { onConflict: 'source,external_key', ignoreDuplicates: false })
    .select('id');
  if (error) return res.status(500).json({ error: error.message });

  await supabase
    .from('campaigns')
    .update({
      status: 'ready',
      property_hits: leadRows.length,
      contact_hits:  leadRows.filter((r) => r.phone || r.email || r.mobile).length,
      enrichment_finished_at: now,
      metadata:      { ihm_territory_id: territoryId, imported_via: source },
    })
    .eq('id', campaignId);

  const response = {
    ok: true,
    imported: data?.length ?? leadRows.length,
    skipped: 0,
    source,
    sample_contacts: contacts.slice(0, 3),
    html_length: html.length,
  };
  if (debug) response.html_preview = html.slice(0, 1500);
  return res.status(200).json(response);
}
