// Resend email client
// --------------------------------------------------------------
// Sends plain-text email via Resend's HTTPS API. We use fetch
// directly (no SDK dep) — the API is simple.
//
// Requires:
//   RESEND_API_KEY   — from resend.com API Keys
//   RESEND_FROM      — verified sender. Either:
//                        "Name <user@verified-domain.com>"
//                        or "onboarding@resend.dev" (Resend sandbox)
//
// Every email we send includes CAN-SPAM footer (physical address +
// unsubscribe link) because our leads didn't explicitly opt in. This
// is legally required for US commercial email.

const RESEND_BASE = 'https://api.resend.com';

const CANSPAM_FOOTER_TEXT = `
---
Just Hail, LLC
308 Hazelwood St. Ste 1, Leander, TX 78641
(512) 221-3013 · justhail.net

You're receiving this email because your property sits in an area with recent hail activity. Reply with STOP or UNSUBSCRIBE to be removed from future emails.
`.trim();

export function withFooter(body) {
  return body.trimEnd() + '\n\n' + CANSPAM_FOOTER_TEXT;
}

export async function sendEmail({ to, subject, text, replyTo, tags }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY and RESEND_FROM must be set');
  }
  if (!to || !subject || !text) {
    throw new Error('to, subject, text are required');
  }

  const res = await fetch(RESEND_BASE + '/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      text: withFooter(text),
      reply_to: replyTo || 'info.justhail@gmail.com',
      tags: tags || [],
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Resend ${res.status}: ${json.message || JSON.stringify(json).slice(0, 300)}`);
    err.status = res.status;
    err.raw = json;
    throw err;
  }
  return json; // { id: 're_...' }
}
