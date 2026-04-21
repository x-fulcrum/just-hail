// POST /api/admin/campaigns/:id/enrich
//
// Kicks off BatchData enrichment for a campaign. For small targets
// (take ≤ 50 properties) we run synchronously and return the full
// result. For larger, we'd switch to BatchData's async endpoints +
// webhook callback — deferred to Phase 2b.
//
// Flow:
//   1. Mark campaign status='enriching', stamp enrichment_started_at
//   2. Call BatchData /property/search with the campaign's target
//   3. For each result, upsert a lead row (source='batchdata', campaign_id=id)
//   4. Kick off skip-trace-v3 for newly-found properties to fill contacts
//   5. Update lead rows with phone/email
//   6. Mark campaign status='ready', stamp enrichment_finished_at + stats
//   7. Return summary
//
// If BatchData returns 403 insufficient_balance, we set the campaign
// status='draft' (so user can retry after loading balance) and return
// a clear error to the UI.

import { supabase } from '../../../../lib/supabase.js';
import { searchProperties, skipTraceV3 } from '../../../../lib/batchdata.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { id } = req.query;
  const campaignId = parseInt(id, 10);
  if (!campaignId) return res.status(400).json({ error: 'Invalid campaign id' });

  // Load campaign
  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();
  if (cErr || !campaign) return res.status(404).json({ error: 'Campaign not found' });

  if (campaign.status === 'enriching') {
    return res.status(409).json({ error: 'Already enriching — wait for it to finish' });
  }

  // Caller options:
  //   { mock: true }        — use mock data, no BatchData call
  //   { dryRun: true }      — return estimated cost only, do not hit BatchData
  //   { take: N }           — record count; default 3, hard cap 25 during dev
  //   { skipTrace: false }  — skip the skip-trace step (search only)
  //   { confirmCost: true } — required when live + take > 5, acknowledges spend
  const body = await readJson(req);
  const forceMock = body?.mock === true;
  const dryRun    = body?.dryRun === true;
  const take      = Math.min(parseInt(body?.take, 10) || 3, 25);
  const doSkipTrace = body?.skipTrace !== false;
  const confirmCost = body?.confirmCost === true;

  // Cost guardrail: require explicit confirm for live enrichment > 5 records
  // Assumed per-record cost (pessimistic): $0.60 search + $0.60 skip-trace = $1.20
  const COST_SEARCH  = 0.60;
  const COST_SKIP    = 0.60;
  const estimatedUsd = (take * COST_SEARCH) + (doSkipTrace ? take * COST_SKIP : 0);

  if (dryRun) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      take,
      skipTrace: doSkipTrace,
      estimated_usd_max: estimatedUsd,
      note: 'This is an upper-bound estimate. Actual per-record cost depends on your BatchData plan. Live run will return actual cost.',
    });
  }

  if (!forceMock && take > 5 && !confirmCost) {
    return res.status(400).json({
      ok: false,
      error: 'confirmCost required',
      estimated_usd_max: estimatedUsd,
      note: 'Live enrichments over 5 records require {"confirmCost": true} in the request body to prevent accidental spend.',
    });
  }

  // Mark enriching
  await supabase
    .from('campaigns')
    .update({ status: 'enriching', enrichment_started_at: new Date().toISOString() })
    .eq('id', campaignId);

  try {
    // 1) Property search
    if (forceMock) process.env.BATCHDATA_MOCK = '1';
    const search = await searchProperties(campaign.target_input, { take });
    const properties = search.properties || [];

    // 2) Upsert leads — one row per property
    const now = new Date().toISOString();
    const leadRows = properties.map((p) => {
      const [firstName, ...rest] = (p.owner_name || '').split(' ');
      return {
        source: 'batchdata',
        external_key: p.bd_id,
        source_system_id: p.bd_id,
        campaign_id: campaignId,
        first_name: firstName || null,
        last_name: rest.join(' ') || null,
        street: p.street,
        city: p.city,
        state: p.state,
        zip: p.zip,
        lat: p.lat,
        lng: p.lng,
        estimated_home_value: p.estimated_value,
        year_built: p.year_built,
        bedroom_count: p.bedrooms,
        bathroom_count: p.bathrooms,
        square_feet: p.square_feet,
        status: 'new',
        updated_at: now,
      };
    });

    let insertedLeads = [];
    if (leadRows.length) {
      const { data, error } = await supabase
        .from('leads')
        .upsert(leadRows, { onConflict: 'source,external_key', ignoreDuplicates: false })
        .select('id, external_key, street, city, state, zip, first_name, last_name');
      if (error) throw new Error(`lead upsert failed: ${error.message}`);
      insertedLeads = data || [];
    }

    // 3) Skip-trace for phone/email (optional)
    let contactHits = 0;
    if (doSkipTrace && insertedLeads.length) {
      const requests = insertedLeads.map((l) => ({
        propertyAddress: {
          street: l.street,
          city: l.city,
          state: l.state,
          zip: l.zip,
        },
        name: {
          first: l.first_name,
          last: l.last_name,
        },
      }));
      const skip = await skipTraceV3(requests);
      const contacts = skip.contacts || [];

      // Update leads with primary phone + email found
      for (let i = 0; i < insertedLeads.length; i++) {
        const contact = contacts[i];
        if (!contact) continue;
        const person = contact.persons?.[0] || {};
        const phone = person.phoneNumbers?.find((p) => !p.dncFlag)?.number || person.phoneNumbers?.[0]?.number || null;
        const email = person.emails?.[0]?.email || null;
        if (phone || email) contactHits++;
        if (phone || email) {
          await supabase.from('leads')
            .update({
              phone: phone || null,
              email: email || null,
              updated_at: now,
            })
            .eq('id', insertedLeads[i].id);
        }
      }
    }

    // 4) Mark campaign ready
    await supabase
      .from('campaigns')
      .update({
        status: 'ready',
        enrichment_finished_at: new Date().toISOString(),
        property_hits: properties.length,
        contact_hits: contactHits,
      })
      .eq('id', campaignId);

    return res.status(200).json({
      ok: true,
      properties_found: properties.length,
      leads_upserted: insertedLeads.length,
      contact_hits: contactHits,
      mock: forceMock || process.env.BATCHDATA_MOCK === '1',
    });
  } catch (err) {
    // Reset campaign state
    await supabase
      .from('campaigns')
      .update({ status: 'draft' })
      .eq('id', campaignId);

    const payload = { ok: false, error: err.message };
    if (err.code === 403) payload.reason = 'insufficient_balance';
    return res.status(err.code || 500).json(payload);
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};
