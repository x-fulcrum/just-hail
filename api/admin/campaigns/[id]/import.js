// POST /api/admin/campaigns/:id/import
//
// Accepts a CSV body (IHM export — or any CSV with recognizable headers)
// and upserts one lead per row under the given campaign.
//
// Request:
//   Content-Type: text/csv  (or text/plain; we parse the body as CSV)
//   Body:         raw CSV text
//
//   Optional JSON header "X-Column-Map" to force column mapping, e.g.:
//     X-Column-Map: {"email":"Owner Email","phone":"Primary Phone"}
//   If not provided, we fuzzy-match common header names (IHM, BatchData,
//   generic).
//
// Response:
//   { ok, imported, skipped, sample_header, detected_map }
//
// Notes:
//   - Idempotent via (source, external_key) unique constraint. External
//     key defaults to a row hash if the CSV doesn't have an obvious ID
//     column. Re-importing the same CSV twice won't duplicate rows.

import Papa from 'papaparse';
import crypto from 'node:crypto';
import { supabase } from '../../../../lib/supabase.js';

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

// Canonical lead fields → the header tokens we recognize for each.
// Match is case-insensitive, trimmed, and normalized (strip non-alnum).
const FIELD_SYNONYMS = {
  first_name:          ['first name', 'firstname', 'first', 'owner first name', 'owner first'],
  last_name:           ['last name', 'lastname', 'last', 'owner last name', 'owner last', 'surname'],
  full_name:           ['full name', 'name', 'owner', 'owner name', 'owner full name', 'customer name', 'contact name'],
  email:               ['email', 'email address', 'owner email', 'primary email', 'e-mail'],
  phone:               ['phone', 'phone number', 'primary phone', 'owner phone', 'mobile', 'mobile phone', 'mobile number', 'cell', 'cell phone'],
  mobile:              ['mobile', 'mobile phone', 'mobile number', 'cell', 'cell phone', 'mobile number'],
  street:              ['street', 'address', 'street address', 'property address', 'site address', 'address line 1', 'address1'],
  city:                ['city', 'town', 'property city'],
  state:               ['state', 'property state', 'st'],
  zip:                 ['zip', 'zipcode', 'zip code', 'postal code', 'postal', 'property zip'],
  lat:                 ['lat', 'latitude', 'property latitude'],
  lng:                 ['lng', 'lon', 'long', 'longitude', 'property longitude'],
  estimated_home_value:['estimated value', 'home value', 'property value', 'est value', 'estimated home value', 'market value'],
  year_built:          ['year built', 'year_built', 'built'],
  external_key:        ['id', 'external id', 'record id', 'marker id', 'recon marker id', 'source id', 'apn'],
};

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildColumnMap(headers, userOverrides = {}) {
  const normalized = headers.map(normalizeHeader);
  const map = {};
  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    if (userOverrides[field]) {
      const idx = headers.indexOf(userOverrides[field]);
      if (idx >= 0) map[field] = idx;
      continue;
    }
    const normSyns = synonyms.map(normalizeHeader);
    const idx = normalized.findIndex((h) => normSyns.includes(h));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

function pick(row, map, field) {
  const idx = map[field];
  if (idx === undefined) return null;
  const v = row[idx];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function splitFullName(full) {
  if (!full) return { first: null, last: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function rowHash(row) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(row))
    .digest('hex')
    .slice(0, 24);
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const { id } = req.query;
  const campaignId = parseInt(id, 10);
  if (!campaignId) return res.status(400).json({ error: 'Invalid campaign id' });

  const { data: campaign } = await supabase
    .from('campaigns').select('id').eq('id', campaignId).single();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const csvText = (await readRawBody(req)).trim();
  if (!csvText) return res.status(400).json({ error: 'Empty body — send CSV text' });

  // Parse user column overrides if supplied
  let userOverrides = {};
  try {
    const cm = req.headers['x-column-map'];
    if (cm) userOverrides = JSON.parse(cm);
  } catch { /* ignore */ }

  // Parse
  const parsed = Papa.parse(csvText, {
    header: false,
    skipEmptyLines: 'greedy',
  });
  if (parsed.errors?.length) {
    return res.status(400).json({
      error: 'CSV parse error',
      details: parsed.errors.slice(0, 3),
    });
  }
  const rows = parsed.data || [];
  if (rows.length < 2) return res.status(400).json({ error: 'CSV needs header row + at least one data row' });

  const headers = rows[0].map((h) => String(h).trim());
  const dataRows = rows.slice(1);
  const map = buildColumnMap(headers, userOverrides);

  // Preview mode — don't import, just return column detection
  if (req.headers['x-preview'] === '1') {
    return res.status(200).json({
      ok: true,
      preview: true,
      sample_header: headers,
      detected_map: Object.fromEntries(
        Object.entries(map).map(([field, idx]) => [field, headers[idx]])
      ),
      sample_rows: dataRows.slice(0, 3),
      total_rows: dataRows.length,
    });
  }

  // Build lead rows
  const now = new Date().toISOString();
  const leadRows = [];
  for (const row of dataRows) {
    const fullName = pick(row, map, 'full_name');
    const split = splitFullName(fullName);

    const firstName = pick(row, map, 'first_name') ?? split.first;
    const lastName  = pick(row, map, 'last_name')  ?? split.last;
    const street    = pick(row, map, 'street');
    const zip       = pick(row, map, 'zip');

    // Minimum viable lead = has something to contact or locate
    const phone = pick(row, map, 'phone');
    const email = pick(row, map, 'email');
    if (!phone && !email && !street) continue;

    const external_key = pick(row, map, 'external_key') || rowHash(row);

    leadRows.push({
      source:              'ihm_csv',
      external_key,
      source_system_id:    external_key,
      campaign_id:         campaignId,
      first_name:          firstName,
      last_name:           lastName,
      email,
      phone,
      mobile:              pick(row, map, 'mobile'),
      street,
      city:                pick(row, map, 'city'),
      state:               pick(row, map, 'state'),
      zip,
      lat:                 parseMaybeNumber(pick(row, map, 'lat')),
      lng:                 parseMaybeNumber(pick(row, map, 'lng')),
      estimated_home_value:parseMaybeInt(pick(row, map, 'estimated_home_value')),
      year_built:          parseMaybeInt(pick(row, map, 'year_built')),
      status:              'new',
      updated_at:          now,
    });
  }

  if (leadRows.length === 0) {
    return res.status(400).json({ error: 'No usable rows — every row is missing phone/email/street. Check column mapping.' });
  }

  const { data, error } = await supabase
    .from('leads')
    .upsert(leadRows, { onConflict: 'source,external_key', ignoreDuplicates: false })
    .select('id');
  if (error) return res.status(500).json({ error: error.message });

  // Mark campaign ready
  await supabase
    .from('campaigns')
    .update({
      status: 'ready',
      property_hits: leadRows.length,
      enrichment_finished_at: now,
    })
    .eq('id', campaignId);

  return res.status(200).json({
    ok: true,
    imported: data?.length ?? leadRows.length,
    skipped:  dataRows.length - leadRows.length,
    sample_header: headers,
    detected_map: Object.fromEntries(
      Object.entries(map).map(([field, idx]) => [field, headers[idx]])
    ),
  });
}

function parseMaybeNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function parseMaybeInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d\-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
