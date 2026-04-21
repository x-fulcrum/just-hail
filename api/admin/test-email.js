// POST /api/admin/test-email
//
// Quick smoke-test endpoint for Resend. Sends one email to a specified
// address to verify deliverability. Not used for real lead outreach —
// that's /api/admin/drafts/[id]/send-email.
//
// Body:
//   { to: "you@example.com" }   — required
//   { subject, text }            — optional, defaults below
//
// Response: { ok, resend_id, preview: { from, to, subject } }

import { sendEmail } from '../../lib/email.js';

export const config = { api: { bodyParser: false } };

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
  const body = await readJson(req);
  const to = body?.to;
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'to must be a valid email' });
  }

  const subject = body.subject || '[Just Hail test] Email pipeline is live';
  const text = body.text || `This is a test from Charlie's Just Hail command center.

If you're reading this, Resend is wired up correctly and Phase 3B email sending is ready for real outreach.

Timestamp: ${new Date().toISOString()}`;

  try {
    const result = await sendEmail({ to, subject, text });
    return res.status(200).json({
      ok: true,
      resend_id: result.id,
      preview: { from: process.env.RESEND_FROM, to, subject },
    });
  } catch (err) {
    console.error('[test-email]', err);
    return res.status(err.status || 500).json({
      ok: false,
      error: err.message,
      hint: err.status === 403
        ? 'Sender domain/email not verified in Resend yet. For immediate testing, set RESEND_FROM to "onboarding@resend.dev" in Vercel env and retry.'
        : undefined,
    });
  }
}
