// Smartlead.ai server client.
// ----------------------------------------------------------------
// API base: https://server.smartlead.ai/api/v1
// Auth: ?api_key=<KEY> as query param on every request
//
// Used by Hailey + the drip orchestrator to:
//   - List + create + update cold-email campaigns
//   - Add leads to a campaign (single + bulk)
//   - Read campaign analytics (sent, delivered, opened, clicked, replied)
//   - Manage email-sequence templates
//   - Pause/resume/clone campaigns
//   - Read connected mailbox status (warming vs ready)
//
// All functions return parsed JSON or throw with a clear error.
// Network errors surface as { ok: false, error } when caller passes
// { soft: true } — otherwise they throw.

const BASE = 'https://server.smartlead.ai/api/v1';

function key() {
  const k = process.env.SMARTLEAD_API_KEY;
  if (!k) throw new Error('SMARTLEAD_API_KEY not set');
  return k;
}

async function request(method, path, { query = {}, body = null, soft = false } = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set('api_key', key());
  for (const [k, v] of Object.entries(query)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const opts = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body != null) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    if (soft) return { ok: false, error: 'network_error: ' + err.message };
    throw new Error(`smartlead network error: ${err.message}`);
  }

  let data;
  try { data = await res.json(); } catch { data = await res.text(); }

  if (!res.ok) {
    const msg = `smartlead ${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 300)}`;
    if (soft) return { ok: false, error: msg, status: res.status };
    throw new Error(msg);
  }

  return data;
}

// ----------------------------------------------------------------
// Email accounts (mailboxes)
// ----------------------------------------------------------------
export async function listEmailAccounts({ limit = 50, offset = 0 } = {}) {
  return request('GET', '/email-accounts/', { query: { limit, offset } });
}

export async function getEmailAccount(emailAccountId) {
  return request('GET', `/email-accounts/${emailAccountId}`);
}

// ----------------------------------------------------------------
// Campaigns
// ----------------------------------------------------------------
export async function listCampaigns() {
  return request('GET', '/campaigns/');
}

export async function getCampaign(campaignId) {
  return request('GET', `/campaigns/${campaignId}`);
}

// Create a new Smartlead campaign. Wraps both the create + initial config
// because the create endpoint by itself returns a near-empty campaign.
export async function createCampaign({ name, client_id = null }) {
  return request('POST', '/campaigns/create', {
    body: { name, client_id },
  });
}

// Update a campaign's general settings (sequence, daily limits, etc.)
export async function updateCampaignSettings(campaignId, settings) {
  return request('POST', `/campaigns/${campaignId}/settings`, {
    body: settings,
  });
}

// Update the sequence (the actual email steps + their content + delays)
//
// sequences: [{
//   seq_number: 1,
//   seq_delay_details: { delay_in_days: 0 },
//   variant_distribution_type: 'MANUAL_EQUAL',  // or 'AI_EQUAL_DISTRIBUTION' for A/B
//   seq_variants: [{
//     subject: 'Saw your block took hail Friday',
//     email_body: '<the body>',
//     variant_label: 'A',
//   }]
// }, ...]
export async function updateCampaignSequence(campaignId, sequences) {
  return request('POST', `/campaigns/${campaignId}/sequences`, {
    body: { sequences },
  });
}

// Attach mailbox(es) to a campaign as senders.
// email_account_ids: [123, 456, ...]
export async function attachMailboxesToCampaign(campaignId, emailAccountIds) {
  return request('POST', `/campaigns/${campaignId}/email-accounts`, {
    body: { email_account_ids: emailAccountIds },
  });
}

// Lifecycle controls
export async function startCampaign(campaignId) {
  return request('POST', `/campaigns/${campaignId}/status`, {
    body: { status: 'START' },
  });
}
export async function pauseCampaign(campaignId) {
  return request('POST', `/campaigns/${campaignId}/status`, {
    body: { status: 'PAUSED' },
  });
}
export async function stopCampaign(campaignId) {
  return request('POST', `/campaigns/${campaignId}/status`, {
    body: { status: 'STOPPED' },
  });
}

// ----------------------------------------------------------------
// Leads
// ----------------------------------------------------------------

// Add up to ~400 leads to a campaign in one request.
// leads: [{
//   first_name, last_name, email, phone_number,
//   company_name, website, location, custom_fields: { ... }
// }, ...]
//
// Returns: { upload_count, total_leads, ... } or duplicate counts.
export async function addLeadsToCampaign(campaignId, leads, opts = {}) {
  const body = {
    lead_list: leads.map(normalizeLead),
    settings: {
      ignore_global_block_list: !!opts.ignore_global_block_list,
      ignore_unsubscribe_list: !!opts.ignore_unsubscribe_list,
      ignore_duplicate_leads_in_other_campaign: !!opts.ignore_duplicate_leads_in_other_campaign,
    },
  };
  return request('POST', `/campaigns/${campaignId}/leads`, { body });
}

function normalizeLead(l) {
  return {
    first_name:   l.first_name || l.firstName || '',
    last_name:    l.last_name || l.lastName || '',
    email:        l.email || '',
    phone_number: l.phone_number || l.phone || l.mobile || '',
    company_name: l.company_name || '',
    website:      l.website || '',
    location:     l.location || l.city || '',
    custom_fields: {
      ...(l.custom_fields || {}),
      // Bake in our internal IDs so Smartlead webhooks can echo them back
      ...(l.lead_id      ? { jh_lead_id:      String(l.lead_id) }      : {}),
      ...(l.drip_id      ? { jh_drip_id:      String(l.drip_id) }      : {}),
      ...(l.drip_step    ? { jh_drip_step:    String(l.drip_step) }    : {}),
      ...(l.campaign_id  ? { jh_campaign_id:  String(l.campaign_id) }  : {}),
      ...(l.street       ? { jh_street:       l.street }               : {}),
      ...(l.storm_date   ? { jh_storm_date:   l.storm_date }           : {}),
    },
  };
}

// Get leads of a campaign with optional filtering
export async function getCampaignLeads(campaignId, { limit = 100, offset = 0 } = {}) {
  return request('GET', `/campaigns/${campaignId}/leads`, { query: { limit, offset } });
}

// Get the message history for one lead in one campaign (replies, sends, etc.)
export async function getLeadMessageHistory(campaignId, leadId) {
  return request('GET', `/campaigns/${campaignId}/leads/${leadId}/message-history`);
}

// Pause / resume one specific lead within a campaign
export async function pauseLead(campaignId, leadId) {
  return request('POST', `/leads/${leadId}/pause`, { body: { campaign_id: campaignId } });
}
export async function resumeLead(campaignId, leadId) {
  return request('POST', `/leads/${leadId}/resume`, {
    body: { campaign_id: campaignId, resume_lead_with_delay_days: 0 },
  });
}
export async function unsubscribeLead(campaignId, leadId) {
  return request('POST', `/leads/${leadId}/unsubscribe`, { body: { campaign_id: campaignId } });
}
export async function deleteLead(campaignId, leadId) {
  return request('DELETE', `/campaigns/${campaignId}/leads/${leadId}`);
}

// ----------------------------------------------------------------
// Analytics
// ----------------------------------------------------------------
export async function getCampaignAnalytics(campaignId) {
  return request('GET', `/campaigns/${campaignId}/analytics`);
}

export async function getCampaignTopLevelAnalytics(campaignId) {
  return request('GET', `/campaigns/${campaignId}/analytics-by-date`, {
    query: { start_date: '2024-01-01', end_date: new Date().toISOString().slice(0, 10) },
  });
}

// ----------------------------------------------------------------
// Webhooks (set up an endpoint to receive Smartlead events)
// ----------------------------------------------------------------
export async function listWebhooks(campaignId) {
  return request('GET', `/campaigns/${campaignId}/webhooks`);
}
export async function createWebhook(campaignId, { name, url, event_types, categories = [] }) {
  // event_types: array of "EMAIL_SENT","EMAIL_OPEN","EMAIL_LINK_CLICK","EMAIL_REPLY","EMAIL_BOUNCE","LEAD_UNSUBSCRIBED","LEAD_CATEGORY_UPDATED"
  return request('POST', `/campaigns/${campaignId}/webhooks`, {
    body: { name, webhook_url: url, event_types, categories },
  });
}
export async function deleteWebhook(campaignId, webhookId) {
  return request('DELETE', `/campaigns/${campaignId}/webhooks/${webhookId}`);
}

// ----------------------------------------------------------------
// Health check (for the API Health strip)
// ----------------------------------------------------------------
export async function healthCheck() {
  if (!process.env.SMARTLEAD_API_KEY) {
    return { ok: false, configured: false, reason: 'no_api_key' };
  }
  const start = Date.now();
  try {
    await request('GET', '/email-accounts/', { query: { limit: 1 } });
    return { ok: true, configured: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false, configured: true,
      latency_ms: Date.now() - start,
      error: err.message?.slice(0, 200) || 'unknown',
    };
  }
}
