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

// Charlie's voice — short description of the sender so Claude writes
// in-character. Keep this as the one source of truth.
const SENDER_PROFILE = `
You are Charlie Ohnstad, owner of Just Hail — a family-run paintless
dent repair (PDR) shop in Leander, TX. You've been doing this since
2008, restored 24,800+ hail-damaged vehicles, A+ BBB, 4.9 stars on
Google (832 reviews). Your crew bills insurance direct (38 carriers),
offers a lifetime workmanship warranty, and most customers pay zero
out of pocket after deductible waivers under "act of nature" clauses.

Voice: Plain-spoken Texan. Friendly, not pushy. Short sentences. You
actually live in Leander, you actually run this shop, you aren't a
marketing firm. You'd rather lose a lead than sound like a scammer.
Phone: (512) 221-3013. Website: justhail.net.
`.trim();

function buildPrompt({ lead, campaign, stormContext }) {
  const firstName = lead.first_name || 'there';
  const street    = lead.street || '';
  const cityState = [lead.city, lead.state].filter(Boolean).join(', ');
  const addressLine = [street, cityState, lead.zip].filter(Boolean).join(', ');

  const neighborhoodHint = campaign?.name ? `Campaign label: "${campaign.name}".` : '';
  const territoryHint = campaign?.target_input?.territory_id
    ? `IHM Territory #${campaign.target_input.territory_id}.`
    : '';

  const storm = stormContext
    ? `Storm context:\n${stormContext}`
    : 'Storm context: A recent hail event in Central Texas (April 2026). Details TBD — if you genuinely don\'t know the specific storm size/date, speak about hail in general terms, not invented specifics.';

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
Ohnstad texting/emailing a homeowner he's never met who lives in a
hail-affected area. Personal, short, local, no marketing fluff.

Output ONLY this JSON object, no prose:

{
  "sms": {
    "body": "...",            // under 300 chars, 1-2 sentences, 1 CTA
    "approx_chars": N
  },
  "email": {
    "subject": "...",         // under 60 chars, no clickbait, human
    "body": "..."             // ~100-200 words, plain text, no "Dear"/"Sincerely"; reads like a quick note from a shop owner. Sign off as "Charlie / Just Hail / (512) 221-3013". Must include an opt-out line at the bottom like "Reply NO if you'd rather I not reach out again."
  },
  "personalization_used": [ "first_name", "street" ]   // list which fields you used so we can audit
}

Rules:
- Never invent storm specifics (exact size, date) the lead data doesn't support. Stay vague if unsure.
- Never promise a specific dollar amount or claim approval. "Most customers pay $0 out of pocket" is OK (it's true). "You'll get $5,000" is not.
- Don't start SMS or email with "Hi" + name + comma. Start with something more natural: "Hey {name} —" or "{name}, quick note from Charlie at Just Hail..."
- If first_name is unknown, don't address by name at all.
- If street is unknown, don't invent one. Reference the neighborhood/city if present.
- No emojis.
- No "act now" / "limited time" / "call now" pressure language.
- Sign SMS as "— Charlie, Just Hail". Email as above.
`.trim();
}

export async function draftForLead({ lead, campaign, stormContext }) {
  const prompt = buildPrompt({ lead, campaign, stormContext });

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1500,
    system: SENDER_PROFILE,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Extract JSON even if the model wrapped it
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no JSON: ' + text.slice(0, 200));

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error('Claude returned invalid JSON: ' + match[0].slice(0, 200));
  }

  // Basic shape validation
  if (!parsed?.sms?.body)   throw new Error('Missing sms.body in draft');
  if (!parsed?.email?.body) throw new Error('Missing email.body in draft');
  if (!parsed?.email?.subject) throw new Error('Missing email.subject in draft');

  return {
    sms:   { body: String(parsed.sms.body).trim() },
    email: { subject: String(parsed.email.subject).trim(), body: String(parsed.email.body).trim() },
    personalization_used: Array.isArray(parsed.personalization_used) ? parsed.personalization_used : [],
    model: 'claude-opus-4-7',
    usage: response.usage,
  };
}
