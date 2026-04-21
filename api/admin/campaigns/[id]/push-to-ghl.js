// POST /api/admin/campaigns/:id/push-to-ghl
//
// Pushes every lead in a campaign up to GHL as a contact, tagging them
// so your GHL workflows can pick them up and run the cadence.
//
// Body (optional):
//   { tags: ["storm-2026-04-18", "size-1.5in"] }  — extra campaign tags
//   { dryRun: true }                               — count only, no push
//
// Response:
//   { ok, total, pushed, skipped, failed, sample: [{lead_id, ghl_contact_id}] }
//
// Tag scheme the UI + your GHL workflows can rely on:
//   just-hail              — every contact we create
//   campaign-{id}          — this specific campaign
//   src-ihm_territory      — came from an IHM territory pull
//   jh-new-lead            — fresh push, triggers the cold-outreach workflow
// (Any extra tags passed in body.tags are appended.)

import { supabase } from '../../../../lib/supabase.js';
import { upsertContact } from '../../../../lib/ghl.js';

export const config = { api: { bodyParser: false }, maxDuration: 60 };

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
  const campaignId = parseInt(req.query.id, 10);
  if (!campaignId) return res.status(400).json({ error: 'Invalid campaign id' });

  const body = await readJson(req);
  const dryRun = body?.dryRun === true;
  const extraTags = Array.isArray(body?.tags) ? body.tags.filter(Boolean) : [];

  // Always tag new-lead so a single GHL workflow can listen for it.
  extraTags.push('jh-new-lead');

  // Load leads
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, first_name, last_name, email, phone, mobile, street, city, state, zip, opted_out, source, campaign_id, ghl_contact_id')
    .eq('campaign_id', campaignId)
    .eq('opted_out', false);
  if (error) return res.status(500).json({ error: error.message });
  if (!leads?.length) return res.status(200).json({ ok: true, total: 0, pushed: 0, skipped: 0, failed: 0 });

  // Skip leads with neither email nor phone — can't contact them through GHL
  const pushable = leads.filter((l) => l.email || l.mobile || l.phone);
  const skipped = leads.length - pushable.length;

  if (dryRun) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      total: leads.length,
      pushable: pushable.length,
      skipped,
      extraTags,
    });
  }

  let pushed = 0;
  let failed = 0;
  const sample = [];

  // GHL rate-limits around ~10 req/sec. Do this sequentially with a tiny
  // pacing delay to stay well under. For 2k+ leads we'll want async jobs
  // later; for now, a 60s function max with sequential calls ~= 600 leads.
  for (const lead of pushable) {
    try {
      const result = await upsertContact(lead, extraTags);
      const ghlId = result?.contact?.id || result?.id;
      if (ghlId) {
        await supabase
          .from('leads')
          .update({ ghl_contact_id: ghlId, updated_at: new Date().toISOString() })
          .eq('id', lead.id);
        pushed++;
        if (sample.length < 3) sample.push({ lead_id: lead.id, ghl_contact_id: ghlId });
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      console.error('[push-to-ghl] lead', lead.id, 'failed:', err.message);
      if (err.status === 401 || err.status === 403) {
        return res.status(err.status).json({
          ok: false,
          error: 'GHL auth failed — check GHL_PRIVATE_TOKEN (rotate if needed) and GHL_LOCATION_ID',
          pushed, failed: failed + (pushable.length - pushed - failed),
        });
      }
    }
    // Small pacing delay
    await new Promise((r) => setTimeout(r, 120));
  }

  return res.status(200).json({
    ok: true,
    total: leads.length,
    pushable: pushable.length,
    pushed,
    skipped,
    failed,
    sample,
  });
}
