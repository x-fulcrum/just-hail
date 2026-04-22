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
