// Default drip sequence templates.
// ----------------------------------------------------------------
// These are the OUT-OF-THE-BOX templates Hailey can use immediately.
// Each is a JSON structure that gets stored in `drip_sequences.steps`.
//
// Template variables (replaced per-lead at send time):
//   {{first_name}}, {{last_name}}, {{street}}, {{city}}, {{zip}},
//   {{vehicle}}, {{storm_date}}, {{storm_size}}
//
// Sequence design philosophy for Just Hail:
//   - Cold email → drives traffic to justhail.net (form opt-in)
//   - SMS only AFTER form opt-in (not used in cold drip — TCPA risk)
//   - Voicemail drops as a re-engagement tool (mid-sequence)
//   - Final email = "last note from Charlie" (closing the loop)
//
// All emails follow the cold-email DO/DON'T list from the conversion
// stack research:
//   - No open tracking pixels
//   - Plain-text style HTML
//   - Sender name "Charlie at Just Hail"
//   - Subject 3-7 words, no ! $ FREE all caps
//   - One soft CTA, full URL (no shorteners)

import { supabase } from './supabase.js';

// ----------------------------------------------------------------
// DEFCON-1 — the 5-step, 14-day "own this polygon" sequence
// ----------------------------------------------------------------
export const DEFCON_1 = {
  name: 'Defcon-1 — Own the polygon',
  description: 'Standard 14-day cold-email sequence for hail-affected polygons. Drives leads to justhail.net to opt in via the contact form. SMS + RVM are reserved for opted-in leads only (TCPA-safe).',
  is_default: true,
  total_days: 14,
  sender_pool: {
    email_mailboxes: ['smartlead_default'],   // use whichever mailboxes are connected
    sms_from: process.env.TWILIO_TF_PHONE_NUMBER || null,
    voice_from: process.env.TWILIO_PHONE_NUMBER || null,
  },
  steps: [
    {
      step_number: 1,
      delay_hours: 0,
      channel: 'email',
      template_key: 'defcon_d0_intro',
      subject: 'hail on {{street}} friday',
      body:
`{{first_name}} —

Quick note from Charlie at Just Hail. Saw the hail came down hard on {{street}} {{storm_date}}.

If your vehicle took damage we do paintless dent repair, billed direct to most insurance carriers. Most folks pay $0 out of pocket after the deductible waiver under Texas "act of nature" comp.

Free inspection — I drive to you. No pressure either way.

If you want a look, the form takes 60 seconds: https://justhail.net

— Charlie
Just Hail | Leander, TX
(512) 221-3013

Reply UNSUB to opt out.`,
      skip_if: ['opted_out', 'bounced_hard', 'do_not_contact'],
    },
    {
      step_number: 2,
      delay_hours: 48,                            // 2 days after step 1
      channel: 'email',
      template_key: 'defcon_d2_followup',
      subject: 'still time on the hail claim',
      body:
`{{first_name}} —

Following up on the note about {{street}}. Wanted to share two things in case it helps:

1. Most Texas comp policies waive the deductible on hail. So even if your deductible is $1000, the typical out-of-pocket on a hail PDR job is $0.
2. We've billed 38 carriers direct. Whoever you have, we probably already know your adjuster's process.

If you want me to swing by and look, the easiest way is the form: https://justhail.net

— Charlie
Just Hail | Leander, TX
(512) 221-3013

Reply UNSUB to opt out.`,
      skip_if: ['opted_out', 'bounced_hard', 'do_not_contact', 'engaged'],
    },
    {
      step_number: 3,
      delay_hours: 96,                            // 4 days after step 2 (day 6)
      channel: 'voicemail',
      template_key: 'defcon_d6_vm',
      // Voicemail uses pre-recorded audio; body holds the script we recorded
      body:
`Hey {{first_name}}, this is Charlie with Just Hail in Leander. Saw the hail hit your block on {{storm_date}} — wanted to make sure you knew we cover paintless dent repair direct-bill on most insurance, usually zero out-of-pocket. No pressure, just leaving you my number — five-one-two two-two-one three-zero-one-three. Or text me back here. Thanks.`,
      skip_if: ['opted_out', 'do_not_contact', 'no_phone'],
      requires_phone: true,
    },
    {
      step_number: 4,
      delay_hours: 96,                            // 4 days after step 3 (day 10)
      channel: 'email',
      template_key: 'defcon_d10_value',
      subject: 'before / after on a recent hail job',
      body:
`{{first_name}} —

Last quick note. Wanted to send you proof of work in case you're on the fence:

https://justhail.net/gallery

That's a hood from a 2021 F-150 that took golf-ball-size hail in Cedar Park last year. ~3 hours of PDR, no paint. Owner paid $0 — Allstate waived the deductible.

If you'd rather just talk, here's the form: https://justhail.net

Or call me at (512) 221-3013.

— Charlie
Just Hail | Leander, TX

Reply UNSUB to opt out.`,
      skip_if: ['opted_out', 'bounced_hard', 'do_not_contact', 'engaged'],
    },
    {
      step_number: 5,
      delay_hours: 96,                            // 4 days after step 4 (day 14)
      channel: 'email',
      template_key: 'defcon_d14_close',
      subject: 'last note from charlie',
      body:
`{{first_name}} —

I'll stop after this. Three quick reasons to take the inspection:

→ Free, mobile, takes 20 minutes.
→ No commitment after.
→ If your insurance is any of the big 38 we bill direct, you'll likely owe nothing.

If today's not the day, no worries. Save my number for when it is — (512) 221-3013.

— Charlie
Just Hail | Leander, TX

Reply UNSUB to opt out.`,
      skip_if: ['opted_out', 'bounced_hard', 'do_not_contact', 'engaged'],
    },
  ],
};

// ----------------------------------------------------------------
// LIGHT — the gentler 3-step sequence for already-engaged leads
// (replied once but didn't book)
// ----------------------------------------------------------------
export const LIGHT_NUDGE = {
  name: 'Light Nudge — re-engage past inquiries',
  description: '3-step gentle re-engagement for leads who replied once but never booked. Spreads over 21 days.',
  is_default: false,
  total_days: 21,
  sender_pool: { email_mailboxes: ['smartlead_default'] },
  steps: [
    {
      step_number: 1,
      delay_hours: 0,
      channel: 'email',
      subject: 'circling back',
      body: `{{first_name}} — Quick check-in on the hail damage we talked about. Still happy to swing by — free, no pressure. Form is at https://justhail.net or text me at (512) 221-3013.\n\n— Charlie, Just Hail`,
      skip_if: ['opted_out', 'engaged'],
    },
    {
      step_number: 2,
      delay_hours: 168,                          // 7 days
      channel: 'email',
      subject: 'one more thing',
      body: `{{first_name}} — One quick thought: even if you've already gotten an estimate elsewhere, second opinion is free and might save you the deductible. Worth 20 min?\n\nhttps://justhail.net or (512) 221-3013.\n\n— Charlie`,
      skip_if: ['opted_out', 'engaged'],
    },
    {
      step_number: 3,
      delay_hours: 336,                          // 14 days (day 21)
      channel: 'email',
      subject: 'last one',
      body: `{{first_name}} — Last note. Hold onto my number for when the next storm hits — (512) 221-3013. Charlie at Just Hail.`,
      skip_if: ['opted_out', 'engaged'],
    },
  ],
};

// ----------------------------------------------------------------
// renderTemplate — interpolate {{vars}} from a lead row
// ----------------------------------------------------------------
export function renderTemplate(template, lead, extra = {}) {
  const vars = {
    first_name: lead?.first_name || 'neighbor',
    last_name:  lead?.last_name || '',
    street:     lead?.street || 'your street',
    city:       lead?.city || 'town',
    zip:        lead?.zip || '',
    vehicle:    lead?.vehicle_estimate?.vehicle || 'your vehicle',
    storm_date: extra.storm_date || 'recently',
    storm_size: extra.storm_size || '',
  };
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

// ----------------------------------------------------------------
// seedDefaults — install both templates into drip_sequences if missing.
// Call once on first deploy or via /api/admin/drip-sequences?seed=1
// ----------------------------------------------------------------
export async function seedDefaults() {
  const results = [];
  for (const tpl of [DEFCON_1, LIGHT_NUDGE]) {
    const { data: existing } = await supabase
      .from('drip_sequences')
      .select('id, name')
      .eq('name', tpl.name)
      .maybeSingle();
    if (existing) {
      results.push({ name: tpl.name, status: 'exists', id: existing.id });
      continue;
    }
    const { data, error } = await supabase
      .from('drip_sequences')
      .insert({
        name: tpl.name,
        description: tpl.description,
        is_default: tpl.is_default,
        total_days: tpl.total_days,
        sender_pool: tpl.sender_pool,
        steps: tpl.steps,
      })
      .select('id, name')
      .single();
    if (error) {
      results.push({ name: tpl.name, status: 'error', error: error.message });
    } else {
      results.push({ name: tpl.name, status: 'created', id: data.id });
    }
  }
  return results;
}
