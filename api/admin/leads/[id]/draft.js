// POST /api/admin/leads/:id/draft
//
// Generates SMS + email outreach drafts for a single lead using Claude.
// Upserts into lead_outreach_drafts (one row per lead per channel,
// keyed by lead_id + channel; re-drafting overwrites the unsent draft).
//
// Body (optional):
//   { storm_context: "..." }   — free-text storm detail Charlie adds
//
// Response:
//   {
//     ok, lead_id,
//     sms:   { body, draft_id, approved },
//     email: { subject, body, draft_id, approved },
//     personalization_used: [...]
//   }

import { supabase } from '../../../../lib/supabase.js';
import { draftForLead } from '../../../../lib/drafts.js';

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
  const leadId = parseInt(req.query.id, 10);
  if (!leadId) return res.status(400).json({ error: 'Invalid lead id' });

  const body = await readJson(req);
  const storm_context = body?.storm_context || null;

  // Load lead + its campaign for context
  const { data: lead, error: lErr } = await supabase
    .from('leads').select('*').eq('id', leadId).single();
  if (lErr || !lead) return res.status(404).json({ error: 'Lead not found' });

  let campaign = null;
  if (lead.campaign_id) {
    const { data } = await supabase.from('campaigns').select('*').eq('id', lead.campaign_id).single();
    campaign = data;
  }

  let draft;
  try {
    draft = await draftForLead({ lead, campaign, stormContext: storm_context });
  } catch (err) {
    console.error('[drafts] claude call failed:', err);
    return res.status(502).json({ error: 'Claude drafting failed', details: err.message });
  }

  // Upsert SMS draft
  const now = new Date().toISOString();

  // Drop any existing UNAPPROVED drafts for this lead+channel (keep approved history)
  await supabase.from('lead_outreach_drafts')
    .delete()
    .eq('lead_id', leadId)
    .eq('approved', false)
    .in('channel', ['sms', 'email']);

  const { data: smsRow, error: sErr } = await supabase
    .from('lead_outreach_drafts')
    .insert({
      lead_id: leadId,
      campaign_id: lead.campaign_id,
      channel: 'sms',
      body: draft.sms.body,
      model: draft.model,
      approved: false,
      created_at: now,
    })
    .select('id')
    .single();
  if (sErr) return res.status(500).json({ error: 'sms insert failed: ' + sErr.message });

  const { data: emailRow, error: eErr } = await supabase
    .from('lead_outreach_drafts')
    .insert({
      lead_id: leadId,
      campaign_id: lead.campaign_id,
      channel: 'email',
      subject: draft.email.subject,
      body: draft.email.body,
      model: draft.model,
      approved: false,
      created_at: now,
    })
    .select('id')
    .single();
  if (eErr) return res.status(500).json({ error: 'email insert failed: ' + eErr.message });

  return res.status(200).json({
    ok: true,
    lead_id: leadId,
    sms: { body: draft.sms.body, draft_id: smsRow.id, approved: false },
    email: { subject: draft.email.subject, body: draft.email.body, draft_id: emailRow.id, approved: false },
    personalization_used: draft.personalization_used,
    usage: draft.usage,
  });
}
