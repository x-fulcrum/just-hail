// Claude-powered outreach draft generation.
// ----------------------------------------------------------------
// Given a lead + campaign context, generates personalized SMS and
// email copy that sounds like Charlie wrote it himself.
//
// Uses Anthropic SDK directly (server-side) with claude-opus-4-7.
// Output is structured JSON so we can save cleanly into
// lead_outreach_drafts.

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Sender voice. The HARD rules at the top are enforced post-generation
// by validateDraft() — keep them in sync if you change them.
const SENDER_PROFILE = `
You are Charlie, owner of Just Hail.

==============================================================
HARD RULES — these are non-negotiable. Output that breaks any
of them will be rejected and regenerated.
==============================================================

1. NAME: First name only. Sign off as "Charlie" — never use the
   last name "Ohnstad" anywhere in the body, subject, or sig.

2. SCOPE: Just Hail repairs **vehicles only** — paintless dent
   repair (PDR) on cars, trucks, SUVs, vans. NEVER mention or
   imply any of: roofs, roofing, shingles, gutters, siding,
   home exterior, structures, "your home", "your house",
   "your property" (in a damage context). The hail event itself
   can be referenced as having hit the street/neighborhood —
   but the SERVICE OFFERED is always vehicle PDR.

3. NO FABRICATED STORM SPECIFICS: Don't invent hail-stone sizes
   ("golf-ball", "tennis-ball", "softball", "1.75 inches", etc.)
   unless the storm_context input explicitly provides a verified
   size. Stay vague if unsure: "the recent hail" / "after the
   storm rolled through" / "with hail in the area."

4. NO HEDGING OVERLOAD: The "I'm not a door-knocker / not a rep /
   not a traveling crew" framing is fine sparingly, but DO NOT
   pile two of those phrases into one short message. Pick one
   or none.

5. EMAIL SIGNATURE BLOCK — use exactly this format:
   — Charlie
   Just Hail | Leander, TX
   (512) 221-3013

6. SMS SIGNATURE — "— Charlie, Just Hail"

==============================================================

Who you are (use these facts; they're true):
- A 4-person expert PDR team based in Leander, TX
- Same phone (512) 221-3013, same name, every day for 18 years (since 2008)
- 24,800+ vehicles restored
- A+ BBB accredited since 2008, 4.9/5 on Google (832 reviews)
- Bill insurance direct (38 carriers); most customers pay $0 out
  of pocket after deductible waivers under Texas "act of nature"
  comp-claim provisions
- Lifetime workmanship warranty, transferable by VIN

Voice:
- Plain-spoken Texan. Short sentences. No marketing fluff.
- You'd rather lose a lead than sound like a scammer or pressure
  salesman. No "act now," "limited time," "call now before it's
  too late."
- You answer your own phone. You close every inquiry yourself.
- Trust markers (use sparingly, vary which one you pick):
  "same number for 18 years," "I'm the owner," "I actually
  answer this number."
`.trim();

function buildPrompt({ lead, campaign, stormContext }) {
  const street    = lead.street || '';
  const cityState = [lead.city, lead.state].filter(Boolean).join(', ');
  const addressLine = [street, cityState, lead.zip].filter(Boolean).join(', ');

  const neighborhoodHint = campaign?.name ? `Campaign label: "${campaign.name}".` : '';
  const territoryHint = campaign?.target_input?.territory_id
    ? `IHM Territory #${campaign.target_input.territory_id}.`
    : '';

  const storm = stormContext
    ? `Storm context:\n${stormContext}`
    : "Storm context: A recent hail event in Central Texas. No verified hail-stone size provided — DO NOT invent one. Speak about \"the recent hail\" / \"the storm that came through\" in general terms.";

  return `
# Lead

Name: ${lead.first_name || '(unknown)'} ${lead.last_name || ''}
Address: ${addressLine || '(address unknown)'}
Phone (mobile): ${lead.mobile || lead.phone || '(none)'}
Email: ${lead.email || '(none)'}
${neighborhoodHint}
${territoryHint}

# ${storm}

# Task

Write TWO outreach drafts for this lead, in JSON. The tone is Charlie
texting/emailing a vehicle owner he's never met who lives in a
hail-affected area. Personal, short, local, no marketing fluff.
The pitch is **vehicle PDR only** — see HARD RULE #2 above.

Output ONLY this JSON object, no prose:

{
  "sms": {
    "body": "...",            // under 300 chars, 1-2 sentences, 1 CTA, vehicle-focused
    "approx_chars": N
  },
  "email": {
    "subject": "...",         // under 60 chars; pattern that works:
                              //   "Hail check on {Street} — quick note"
                              //   "Quick note about your {Street} address"
                              // Lowercase-ish is fine. No clickbait, no exclamation points.
    "body": "..."             // ~100-180 words, plain text. No "Dear"/"Sincerely". Reads like a quick note from a shop owner. Body MUST be vehicle-focused (PDR, dents, factory finish). Body MUST end with the exact signature block from HARD RULE #5, then an opt-out line: "Reply NO if you'd rather I not reach out again."
  },
  "personalization_used": [ "first_name", "street" ]
}

Style rules (in addition to the HARD RULES at the top):
- Don't start with "Hi {name},". Use "{name} —" or "{name}, quick note from Charlie at Just Hail..." or just open without a greeting.
- If first_name is unknown, don't address by name at all.
- If street is unknown, don't invent one — reference the neighborhood/city.
- No emojis.
- Never promise a specific dollar amount. "Most customers pay $0 out of pocket" is OK (it's true). "You'll get $5,000" is not.
`.trim();
}

// ----------------------------------------------------------------
// Post-generation validation. Catches the most common drift
// (last name, roofing, fabricated sizes) BEFORE we save the draft.
// Returns null if clean, else an array of violation strings.
// ----------------------------------------------------------------
const FORBIDDEN_PATTERNS = [
  // Last name leak
  { rx: /\bOhnstad\b/i,                     label: 'last-name "Ohnstad" used (rule #1: first name only)' },
  // Wrong scope — roofing / home exterior
  { rx: /\b(roof(ing|s)?|shingle|gutter|siding|chimney|fascia|soffit)\b/i,
    label: 'roofing / home-exterior reference (rule #2: vehicles only)' },
  { rx: /\b(your|the)\s+(home|house|property)\b(?!\s*owner)/i,
    label: '"your home/house/property" damage framing (rule #2: vehicles only)' },
  // Fabricated sizes — only allowed if stormContext provided one (caller injects via allowedSizes)
  { rx: /\b(golf[\s-]?ball|tennis[\s-]?ball|baseball|softball|hen[\s-]?egg|ping[\s-]?pong)[\s-]?(size|sized)?\b/i,
    label: 'fabricated hail-stone size (rule #3: only if storm_context provides one)',
    sizeRule: true },
  // Signature checks
  { rx: /Sincerely|Best regards|Warm regards|Cheers,|Yours truly/i,
    label: 'corporate sign-off (use the simple "— Charlie" block from rule #5)' },
];

function validateDraft({ sms, email, allowSizeMention = false }) {
  const text = `${email.subject || ''}\n${email.body || ''}\n${sms.body || ''}`;
  const violations = [];
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.sizeRule && allowSizeMention) continue;
    const m = text.match(rule.rx);
    if (m) violations.push(`${rule.label} — found "${m[0]}"`);
  }
  // Email body must end with the signature
  if (email.body && !/—\s*Charlie\s*\n+\s*Just Hail\s*\|\s*Leander,?\s*TX/.test(email.body)) {
    violations.push('email body missing the required "— Charlie / Just Hail | Leander, TX" sig block (rule #5)');
  }
  return violations.length ? violations : null;
}

export async function draftForLead({ lead, campaign, stormContext }) {
  const prompt = buildPrompt({ lead, campaign, stormContext });
  // Allow size words in the output ONLY if the storm context provides them
  const allowSizeMention = !!(stormContext && /\b(\d+(\.\d+)?\s*(in|inch|inches|"|″)|golf|tennis|baseball|softball|ping|hen|marble|quarter)\b/i.test(stormContext));

  // Try once; if validation fails, regenerate once with a corrective prompt.
  let lastViolations = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = [{ role: 'user', content: prompt }];
    if (lastViolations) {
      messages.push({
        role: 'assistant',
        content: '(my previous draft was rejected — let me retry following all the HARD RULES)',
      });
      messages.push({
        role: 'user',
        content: `Your previous output broke these rules:\n- ${lastViolations.join('\n- ')}\n\nRegenerate the JSON, fully compliant. Output ONLY the JSON object.`,
      });
    }

    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1500,
      system: SENDER_PROFILE,
      messages,
    });

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude returned no JSON: ' + text.slice(0, 200));
    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch (e) { throw new Error('Claude returned invalid JSON: ' + match[0].slice(0, 200)); }

    if (!parsed?.sms?.body)      throw new Error('Missing sms.body in draft');
    if (!parsed?.email?.body)    throw new Error('Missing email.body in draft');
    if (!parsed?.email?.subject) throw new Error('Missing email.subject in draft');

    const violations = validateDraft({
      sms: { body: parsed.sms.body },
      email: { subject: parsed.email.subject, body: parsed.email.body },
      allowSizeMention,
    });

    if (!violations) {
      return {
        sms:   { body: String(parsed.sms.body).trim() },
        email: { subject: String(parsed.email.subject).trim(), body: String(parsed.email.body).trim() },
        personalization_used: Array.isArray(parsed.personalization_used) ? parsed.personalization_used : [],
        model: 'claude-opus-4-7',
        usage: response.usage,
        regenerations: attempt,
      };
    }
    lastViolations = violations;
    console.warn('[draftForLead] attempt', attempt + 1, 'rejected:', violations);
  }

  // After 2 attempts, accept the last one but flag it for human review.
  throw new Error('Draft failed validation twice. Violations: ' + lastViolations.join('; '));
}
