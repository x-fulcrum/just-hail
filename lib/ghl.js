// GoHighLevel v2.0 API client (Private Integration Token auth)
// --------------------------------------------------------------
// We use GHL as the orchestration brain: contacts + pipeline + workflow
// engine. Delivery (email/SMS/RVM) stays with specialist providers
// (Resend, SlyText, SlyBroadcast) for better deliverability; GHL just
// knows "this contact exists and is in stage X" and fires workflows
// you configure in the GHL UI.
//
// Auth: Bearer pit-{token} + Version header on every request.
// Base:  https://services.leadconnectorhq.com

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

function headers() {
  const t = process.env.GHL_PRIVATE_TOKEN;
  if (!t) throw new Error('GHL_PRIVATE_TOKEN must be set');
  return {
    Authorization: `Bearer ${t}`,
    Version: GHL_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function locationId() {
  const l = process.env.GHL_LOCATION_ID;
  if (!l) throw new Error('GHL_LOCATION_ID must be set');
  return l;
}

async function ghl(method, path, body) {
  const res = await fetch(GHL_BASE + path, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`GHL ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.raw = json;
    throw err;
  }
  return json;
}

// ----------------------------------------------------------------
// Contact upsert — creates or updates by email/phone match.
// GHL's /contacts/upsert endpoint handles the dedupe.
// ----------------------------------------------------------------
export async function upsertContact(lead, extraTags = []) {
  // Normalize phone to E.164 if we can (US +1 assumed)
  const e164 = normalizeUSPhone(lead.mobile || lead.phone);

  // GHL requires at least email OR phone
  if (!lead.email && !e164) {
    throw new Error('Lead has no email or phone — cannot push to GHL');
  }

  const tags = [
    'just-hail',
    lead.source ? `src-${lead.source}` : null,
    lead.campaign_id ? `campaign-${lead.campaign_id}` : null,
    ...extraTags,
  ].filter(Boolean);

  const body = {
    locationId: locationId(),
    firstName:  lead.first_name || undefined,
    lastName:   lead.last_name  || undefined,
    email:      lead.email      || undefined,
    phone:      e164            || undefined,
    address1:   lead.street     || undefined,
    city:       lead.city       || undefined,
    state:      lead.state      || undefined,
    postalCode: lead.zip        || undefined,
    source:     `Just Hail ${lead.source || 'import'}`,
    tags,
  };

  return ghl('POST', '/contacts/upsert', body);
  // Response: { new: bool, contact: { id, ... }, traceId }
}

// Add tags to an existing GHL contact (triggers any workflow listening
// on tag-added events — this is how we fire cadences).
export async function addTags(contactId, tags) {
  return ghl('POST', `/contacts/${contactId}/tags`, { tags });
}

// Remove tags (useful when marking opt-out, stopping a workflow).
export async function removeTags(contactId, tags) {
  return ghl('DELETE', `/contacts/${contactId}/tags`, { tags });
}

// Get contact by id (for debugging / verification).
export async function getContact(contactId) {
  return ghl('GET', `/contacts/${contactId}`);
}

// ----------------------------------------------------------------
// Phone normalization — GHL wants E.164.
// ----------------------------------------------------------------
function normalizeUSPhone(input) {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}
