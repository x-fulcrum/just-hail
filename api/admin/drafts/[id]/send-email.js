// POST /api/admin/drafts/:id/send-email
//
// Sends an approved email draft to the associated lead. Idempotent:
// once sent, the draft's sent_at is set and further calls return 409.
//
// Response: { ok, resend_id, to, subject }

import { supabase } from '../../../../lib/supabase.js';
import { sendEmail } from '../../../../lib/email.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const draftId = parseInt(req.query.id, 10);
  if (!draftId) return res.status(400).json({ error: 'Invalid draft id' });

  // Load draft
  const { data: draft, error: dErr } = await supabase
    .from('lead_outreach_drafts').select('*').eq('id', draftId).single();
  if (dErr || !draft) return res.status(404).json({ error: 'Draft not found' });
  if (draft.channel !== 'email') return res.status(400).json({ error: 'Draft is not an email draft' });
  if (!draft.approved) return res.status(400).json({ error: 'Draft not approved yet' });
  if (draft.sent_at) return res.status(409).json({ error: 'Draft already sent', sent_at: draft.sent_at });

  // Load lead
  const { data: lead } = await supabase.from('leads').select('*').eq('id', draft.lead_id).single();
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (lead.opted_out) return res.status(400).json({ error: 'Lead has opted out' });
  if (!lead.email)    return res.status(400).json({ error: 'Lead has no email address' });

  try {
    const result = await sendEmail({
      to: lead.email,
      subject: draft.subject,
      text: draft.body,
      tags: [
        { name: 'campaign_id', value: String(draft.campaign_id || 'none') },
        { name: 'lead_id',     value: String(lead.id) },
        { name: 'draft_id',    value: String(draft.id) },
      ],
    });

    // Mark sent
    const now = new Date().toISOString();
    await supabase
      .from('lead_outreach_drafts')
      .update({ sent_at: now, sent_status: 'delivered', sent_provider_id: result.id })
      .eq('id', draftId);
    await supabase
      .from('leads')
      .update({ status: 'contacted', last_touched_at: now, last_channel: 'email' })
      .eq('id', lead.id);

    return res.status(200).json({ ok: true, resend_id: result.id, to: lead.email, subject: draft.subject });
  } catch (err) {
    console.error('[send-email]', err);
    await supabase
      .from('lead_outreach_drafts')
      .update({ sent_status: 'failed' })
      .eq('id', draftId);
    return res.status(err.status || 500).json({
      ok: false,
      error: err.message,
      hint: err.status === 403 ? 'Sender not verified in Resend — add/verify a domain in Resend dashboard, or set RESEND_FROM=onboarding@resend.dev for sandbox testing.' : undefined,
    });
  }
}
