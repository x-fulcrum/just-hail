// Exercise every underlying Strategist tool against production-equivalent creds.
// Run: node --env-file=.env.local scripts/test-strategist-tools.mjs
//
// Reports pass/fail + error for each tool so we can spot regressions without
// burning Claude tokens via the full Strategist endpoint.

import { createClient } from '@supabase/supabase-js';
import {
  tavilySearch, exaSearch, exaSocialSearch, jinaRead,
  perplexityResearch, nominatimSearch, nominatimReverse, nwsActiveAlerts,
} from '../lib/research.js';
import { getStormData, getSwathPolygons } from '../lib/ihm-web.js';
import { getSpcOutlookSummary } from '../lib/spc.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ------------------------------------------------------------
// Tool cases
// ------------------------------------------------------------
const CASES = [
  // IHM (user's reported pain point). StormData REQUIRES bbox — use CONUS-wide.
  ['fetch_ihm_storms',         () => getStormData({ begin: '4/18/2026', end: '4/18/2026', neLat: 50, neLng: -65, swLat: 24, swLng: -125 })],
  ['fetch_ihm_swath_polygons', () => getSwathPolygons({ begin: '4/18/2026', showObserved: false })],

  // SPC forecasts
  ['get_hail_outlook day=1 cat',  () => getSpcOutlookSummary(1, 'cat')],
  ['get_hail_outlook day=2 hail', () => getSpcOutlookSummary(2, 'hail')],
  ['get_hail_outlook day=5 prob', () => getSpcOutlookSummary(5, 'prob')],

  // Research
  ['tavily_search',       () => tavilySearch('hail damage cedar park texas april 2026', { maxResults: 3 })],
  ['exa_social_search',   () => exaSocialSearch('hail damage round rock texas', { numResults: 3 })],
  ['exa_general_search',  () => exaSearch('texas hail forecast week', { numResults: 3 })],
  ['jina_read_url',       () => jinaRead('https://www.spc.noaa.gov/')],
  ['perplexity_research', () => perplexityResearch('What is the severe weather outlook for Texas this week?', { maxTokens: 300 })],

  // Geo
  ['reverse_geocode', () => nominatimReverse(30.5083, -97.8789)],
  ['forward_geocode', () => nominatimSearch('Round Rock, TX', { limit: 2 })],

  // NWS
  ['nws_active_alerts TX', () => nwsActiveAlerts({ state: 'TX' })],

  // CRM queries
  ['search_our_campaigns', async () => {
    const { data, error } = await supabase.from('campaigns').select('id, name, status').limit(3);
    if (error) throw new Error(error.message);
    return { campaigns: data };
  }],
  ['query_leads', async () => {
    const { data, error } = await supabase.from('leads').select('id, campaign_id, city, zip').limit(3);
    if (error) throw new Error(error.message);
    return { leads: data };
  }],
  ['query_drafts', async () => {
    const { data, error } = await supabase.from('lead_outreach_drafts').select('id, lead_id, campaign_id, channel, approved, sent_at, sent_status').limit(3);
    if (error) throw new Error(error.message);
    return { drafts: data };
  }],

  // Engagement tools — read-only probes. We do NOT actually draft, send, or push
  // in the automated harness (those are destructive). We verify the underlying
  // primitives work by checking GHL auth (read-only contact search) and
  // confirming lib functions load. Write ops are tested manually in the UI.
  ['get_lead_full (probe)', async () => {
    const { data } = await supabase.from('leads').select('id').limit(1);
    if (!data?.length) return { skipped: 'no leads in table' };
    const leadId = data[0].id;
    const [{ data: lead }, { data: drafts }] = await Promise.all([
      supabase.from('leads').select('id, first_name, email, phone, campaign_id').eq('id', leadId).single(),
      supabase.from('lead_outreach_drafts').select('id, channel, approved, sent_at').eq('lead_id', leadId),
    ]);
    return { lead, draft_count: drafts?.length || 0 };
  }],
  ['ghl auth probe', async () => {
    // Hit the GHL contacts endpoint with a harmless query to prove auth works
    const t = process.env.GHL_PRIVATE_TOKEN, l = process.env.GHL_LOCATION_ID;
    if (!t || !l) throw new Error('GHL_PRIVATE_TOKEN / GHL_LOCATION_ID missing');
    const res = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${l}&limit=1`, {
      headers: { Authorization: `Bearer ${t}`, Version: '2021-07-28', Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) throw new Error(`auth failed: ${res.status}`);
    const j = await res.json().catch(() => ({}));
    return { status: res.status, contact_count_sample: j?.contacts?.length ?? null };
  }],
  ['resend auth probe', async () => {
    const k = process.env.RESEND_API_KEY;
    if (!k) throw new Error('RESEND_API_KEY missing');
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${k}`, Accept: 'application/json' },
    });
    if (res.status === 401) throw new Error('resend key invalid');
    const j = await res.json().catch(() => ({}));
    return { status: res.status, domain_count: (j?.data?.length ?? 0) };
  }],
];

// ------------------------------------------------------------
// Runner
// ------------------------------------------------------------
function summarize(result) {
  if (!result) return 'null';
  if (Array.isArray(result)) return `Array(${result.length})` + (result[0] ? ` e.g. ${JSON.stringify(result[0]).slice(0, 100)}` : '');
  if (typeof result === 'object') {
    const k = Object.keys(result);
    const counts = k
      .filter((key) => Array.isArray(result[key]))
      .map((key) => `${key}:${result[key].length}`)
      .join(', ');
    return `{${k.slice(0, 6).join(', ')}${k.length > 6 ? '...' : ''}}` + (counts ? `  (${counts})` : '');
  }
  return String(result).slice(0, 100);
}

console.log(`Running ${CASES.length} tool tests…\n`);
const start = Date.now();
const results = await Promise.allSettled(CASES.map(async ([name, fn]) => {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { name, ok: true, ms: Date.now() - t0, summary: summarize(r) };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - t0, error: err.message || String(err) };
  }
}));

console.log(`\nResults (${Date.now() - start}ms total):`);
console.log('='.repeat(80));
for (const r of results) {
  const row = r.value;
  const icon = row.ok ? '✓' : '✗';
  const tail = row.ok ? row.summary : `ERR: ${row.error}`;
  console.log(`${icon} ${row.name.padEnd(32)} ${String(row.ms).padStart(5)}ms  ${tail}`);
}

const passed = results.filter((r) => r.value.ok).length;
const failed = results.filter((r) => !r.value.ok).length;
console.log('='.repeat(80));
console.log(`${passed}/${CASES.length} passed · ${failed} failed`);
process.exit(failed ? 1 : 0);
