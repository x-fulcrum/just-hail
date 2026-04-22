// POST /api/admin/strategist  (streams Server-Sent Events)
// ---------------------------------------------------------------
// Charlie's advanced hail-canvassing + sales agent.
//
// Body: {
//   messages: [{role, content}, ...],
//   settings?: { maxTokens?: number }   // default 16000, max 64000
// }
//
// Stream protocol (one JSON object per SSE `data:` line):
//   { type: 'text_delta',     text }
//   { type: 'thinking_delta', text }
//   { type: 'tool_start',     id, name, input? }
//   { type: 'tool_result',    id, ok, preview }
//   { type: 'iter_end',       iteration }       (one claude turn done)
//   { type: 'done',           usage, steps }    (all turns done)
//   { type: 'error',          message }

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../lib/supabase.js';
import {
  tavilySearch, exaSearch, exaSocialSearch, jinaRead,
  perplexityResearch, nominatimSearch, nominatimReverse, nwsActiveAlerts,
} from '../../lib/research.js';
import { getStormData, getSwathPolygons, getImpactedPlaces } from '../../lib/ihm-web.js';

const client = new Anthropic();

export const config = { api: { bodyParser: false }, maxDuration: 60 };

// =================================================================
// System prompt
// =================================================================
const SYSTEM_PROMPT = `
You are Charlie Ohnstad's Hail Canvassing + Sales Strategist for Just Hail — a 4-person expert paintless dent repair (PDR) team. 18 years in business, same phone (512) 221-3013 since 2008, based in Leander TX (shop moves with storms). 24,800+ vehicles restored. Bills insurance direct w/ 38 carriers. Lifetime workmanship warranty.

YOUR MISSION: Help Charlie replace his entire traditional sales team by making surgical decisions about where to pull polygons, which storms to chase, who to contact, and how to engage. You are the tip of the spear.

TOOLS — USE THEM AGGRESSIVELY AND IN PARALLEL WHEN POSSIBLE:

Hail + storm data:
- fetch_ihm_swath_polygons : get the actual storm swath polygons for a date (with size tiers)
- fetch_ihm_storms         : individual hail pins for a date + bounding box
- fetch_ihm_impacted_places: zip/city-level counts of impacted places for a date (GOOD first call to scope a storm)
- get_recent_storms        : storms that hit our IHM webhook
- nws_active_alerts        : National Weather Service live alerts (by state)

Just Hail's CRM state:
- search_our_campaigns     : what polygons Charlie has already pulled
- get_campaign_detail      : full info on one campaign (sample leads + bounds)
- query_leads              : search leads table w/ filters (campaign_id, zip, city, name, has_email, has_phone)
- query_drafts             : search drafts (pending/approved/sent/failed) w/ filters
- lead_stats               : aggregate counts grouped by campaign/city/zip/state

Research:
- perplexity_research      : deep research w/ citations (multi-source, prefers recent)
- tavily_search            : general web news search
- exa_social_search        : semantic search of Reddit/X/NextDoor/FB/TikTok/Insta — WHERE PEOPLE POST HAIL DAMAGE
- exa_general_search       : semantic search (non-social)
- jina_read_url            : extract full clean text from a specific URL

Geo utilities:
- reverse_geocode          : lat/lng → city/state/zip
- forward_geocode          : address → lat/lng

HOW TO REASON:
1. For "where should I canvass" questions: start with fetch_ihm_impacted_places to see the damage distribution, cross-reference search_our_campaigns to see gaps, then exa_social_search for uncovered areas with posting activity.
2. Run tools IN PARALLEL when they're independent. Don't call them one by one if you can fire 3 at once.
3. Be decisive. Charlie's time is money. Specific zips, specific streets, specific post URLs — no "maybe" or "probably." If a tool returns nothing, say so plainly and pivot.
4. When you find social posts from real people with hail damage, surface the URL + the specific text so Charlie can reach out.
5. Charlie closes 100% of warm leads. Your job is to feed him qualified signals, not to write copy (he has other tools for drafting).
6. Format: short paragraphs, bolded action items, numbered lists when ordering matters. No marketing filler.
7. If a tool fails, try an alternative — don't get stuck.
8. CRM schema:
   - campaigns: id, name, status, target_input.polygon, property_hits, contact_hits, created_at
   - leads: id, campaign_id, first_name, last_name, email, phone, mobile, street, city, state, zip
   - drafts: id, lead_id, channel (email/sms), status (pending/approved/sent/failed/rejected), subject, body, created_at, sent_at
   - storm_events: id, received_at, event_type, swath_size_in, city, state, zip, lat, lng
`.trim();

// =================================================================
// Tool definitions
// =================================================================
const TOOLS = [
  // ---- Hail data ----
  { name: 'fetch_ihm_swath_polygons',
    description: 'Get IHM hail-swath polygons for a date. Returns an array of {sizeTier, points:[{lat,lng}]}. Swaths are the BIG colored shapes IHM shows — better than pins for understanding storm coverage.',
    input_schema: { type: 'object', required: ['begin'], properties: {
      begin: { type: 'string', description: 'Date in M/D/YYYY format' },
      showObserved: { type: 'boolean', description: 'Include confirmed-report swaths (default false = radar only)' },
    }}},
  { name: 'fetch_ihm_storms',
    description: 'Individual hail-impact pins from IHM for a date + viewport. Each pin has Lat/Long/Size/Comments.',
    input_schema: { type: 'object', required: ['begin'], properties: {
      begin: { type: 'string' }, end: { type: 'string' },
      neLat: { type: 'number' }, neLng: { type: 'number' },
      swLat: { type: 'number' }, swLng: { type: 'number' },
    }}},
  { name: 'fetch_ihm_impacted_places',
    description: 'Quick list of zips/cities with hail activity on a date. GREAT as a first call to scope "where did hail hit today" before pulling detailed pins or polygons.',
    input_schema: { type: 'object', required: ['date'], properties: {
      date: { type: 'string', description: 'M/D/YYYY' },
    }}},
  { name: 'get_recent_storms',
    description: "Storm events that hit Just Hail's webhook endpoint from IHM alerts.",
    input_schema: { type: 'object', properties: { days: { type: 'integer', default: 14, maximum: 90 } }}},
  { name: 'nws_active_alerts',
    description: 'National Weather Service active alerts (severe thunderstorm warnings, hail advisories, etc.). Free, no key.',
    input_schema: { type: 'object', properties: {
      state: { type: 'string', description: '2-letter state abbrev (TX, OK, etc.)' },
      event: { type: 'string', description: 'Event type filter (e.g. "Severe Thunderstorm Warning")' },
      severity: { type: 'string', enum: ['Extreme','Severe','Moderate','Minor','Unknown'] },
    }}},

  // ---- Our CRM ----
  { name: 'search_our_campaigns',
    description: "Campaigns in Charlie's Supabase. Each campaign = one polygon he's pulled.",
    input_schema: { type: 'object', properties: {
      query: { type: 'string', description: 'Optional name filter' },
      limit: { type: 'integer', default: 20, maximum: 50 },
    }}},
  { name: 'get_campaign_detail',
    description: 'Full info on one campaign incl. bounding box + 25 sample leads.',
    input_schema: { type: 'object', required: ['campaign_id'], properties: {
      campaign_id: { type: 'integer' },
    }}},
  { name: 'query_leads',
    description: 'Search the leads table with filters. Returns matching leads (up to 200). Combine filters as needed.',
    input_schema: { type: 'object', properties: {
      campaign_id: { type: 'integer' },
      zip:         { type: 'string', description: 'Exact zip' },
      city:        { type: 'string', description: 'Partial match, case-insensitive' },
      name:        { type: 'string', description: 'Partial first OR last name match' },
      has_email:   { type: 'boolean' },
      has_phone:   { type: 'boolean' },
      limit:       { type: 'integer', default: 50, maximum: 200 },
    }}},
  { name: 'query_drafts',
    description: 'Search the drafts table. Drafts are Claude-written email/SMS per-lead. Filter by status, channel, campaign.',
    input_schema: { type: 'object', properties: {
      campaign_id: { type: 'integer' },
      status:      { type: 'string', enum: ['pending','approved','sent','failed','rejected'] },
      channel:     { type: 'string', enum: ['email','sms'] },
      since_days:  { type: 'integer', description: 'Only drafts created in the last N days' },
      limit:       { type: 'integer', default: 50, maximum: 200 },
    }}},
  { name: 'lead_stats',
    description: 'Aggregate lead counts. Group by campaign, city, or zip. Optionally filter by campaign_id.',
    input_schema: { type: 'object', required: ['group_by'], properties: {
      group_by:    { type: 'string', enum: ['campaign','city','zip','state'] },
      campaign_id: { type: 'integer', description: 'Optional — scope stats to a single campaign' },
      limit:       { type: 'integer', default: 30, maximum: 100 },
    }}},

  // ---- Research ----
  { name: 'perplexity_research',
    description: 'Deep multi-source research with citations. Best for questions that need synthesis across several sources. Slower than Tavily/Exa but more thorough.',
    input_schema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string' },
      model: { type: 'string', enum: ['sonar','sonar-pro'], default: 'sonar' },
    }}},
  { name: 'tavily_search',
    description: 'General web news search. Returns snippets + URLs. Good for recent news coverage.',
    input_schema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string' },
      max_results: { type: 'integer', default: 5, maximum: 10 },
    }}},
  { name: 'exa_social_search',
    description: "Semantic search of Reddit/X/NextDoor/FB/TikTok/Instagram. THE SUPERPOWER — finds people actually posting hail damage. Natural-language query.",
    input_schema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string' },
      num_results: { type: 'integer', default: 8, maximum: 15 },
    }}},
  { name: 'exa_general_search',
    description: 'Semantic web search (non-social).',
    input_schema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string' },
      num_results: { type: 'integer', default: 5, maximum: 15 },
    }}},
  { name: 'jina_read_url',
    description: 'Extract clean readable content from a specific URL. Use after a search returns a promising link.',
    input_schema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } }}},

  // ---- Geo ----
  { name: 'reverse_geocode',
    description: 'lat/lng → {city, state, zip}. Uses free Nominatim (OpenStreetMap).',
    input_schema: { type: 'object', required: ['lat','lng'], properties: {
      lat: { type: 'number' }, lng: { type: 'number' },
    }}},
  { name: 'forward_geocode',
    description: 'Address/place query → [{lat,lng,display_name,address}]. Use to resolve a place Charlie mentions to coordinates.',
    input_schema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string' },
      limit: { type: 'integer', default: 3, maximum: 10 },
    }}},
];

// =================================================================
// Tool runner
// =================================================================
async function runTool(name, input) {
  try {
    switch (name) {
      case 'fetch_ihm_swath_polygons': {
        const data = await getSwathPolygons({ begin: input.begin, showObserved: !!input.showObserved });
        const summarized = data.slice(0, 40).map((p) => ({
          sizeTier: p.sizeTier,
          points: p.points.length,
          bbox: bboxOf(p.points),
        }));
        return { count: data.length, polygons: summarized };
      }
      case 'fetch_ihm_storms': {
        const data = await getStormData(input);
        const arr = Array.isArray(data) ? data : [];
        return {
          count: arr.length,
          pins: arr.slice(0, 30).map((p) => ({
            lat: p.Lat, lng: p.Long, size_in: p.Size, heat: p.Heat,
            comments: String(p.Comments || '').replace(/<br\s*\/?>/gi, ' ').slice(0, 160),
          })),
        };
      }
      case 'fetch_ihm_impacted_places': {
        const data = await getImpactedPlaces({ date: input.date });
        const arr = Array.isArray(data) ? data : (Array.isArray(data?.Places) ? data.Places : []);
        return { count: arr.length, places: arr.slice(0, 50) };
      }
      case 'get_recent_storms': {
        const days = Math.min(parseInt(input.days || 14, 10), 90);
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const { data } = await supabase.from('storm_events').select('id, received_at, event_type, alert_category, swath_size_in, street, city, state, zip, lat, lng').gt('received_at', since).order('received_at', { ascending: false }).limit(100);
        return { events: data || [] };
      }
      case 'nws_active_alerts': {
        return { alerts: await nwsActiveAlerts(input) };
      }

      case 'search_our_campaigns': {
        const { query = null, limit = 20 } = input;
        let q = supabase.from('campaigns').select('id, name, status, target_type, target_input, created_at, property_hits, contact_hits, enrichment_finished_at').order('created_at', { ascending: false }).limit(Math.min(limit, 50));
        if (query) q = q.ilike('name', `%${query}%`);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return {
          campaigns: (data || []).map((c) => ({
            id: c.id, name: c.name, status: c.status, created_at: c.created_at,
            leads: c.property_hits || 0,
            contacts: c.contact_hits || 0,
            ihm_territory_id: c.target_input?.territory_id || null,
            has_polygon: !!c.target_input?.polygon,
          })),
        };
      }
      case 'get_campaign_detail': {
        const id = parseInt(input.campaign_id, 10);
        if (!id) return { error: 'campaign_id required' };
        const [{ data: c }, { data: leads }] = await Promise.all([
          supabase.from('campaigns').select('*').eq('id', id).single(),
          supabase.from('leads').select('id, first_name, last_name, email, phone, mobile, street, city, state, zip').eq('campaign_id', id).limit(25),
        ]);
        if (!c) return { error: 'not found' };
        return {
          campaign: {
            id: c.id, name: c.name, status: c.status, created_at: c.created_at,
            target_type: c.target_type,
            territory_id: c.target_input?.territory_id || null,
            polygon_points: c.target_input?.polygon?.length || 0,
            polygon_bounds: c.target_input?.polygon ? bboxOf(c.target_input.polygon) : null,
            leads: c.property_hits || 0,
            contacts: c.contact_hits || 0,
          },
          sample_leads: leads || [],
        };
      }
      case 'query_leads': {
        let q = supabase.from('leads').select('id, campaign_id, first_name, last_name, email, phone, mobile, street, city, state, zip').limit(Math.min(input.limit || 50, 200));
        if (input.campaign_id) q = q.eq('campaign_id', input.campaign_id);
        if (input.zip)         q = q.eq('zip', input.zip);
        if (input.city)        q = q.ilike('city', `%${input.city}%`);
        if (input.name)        q = q.or(`first_name.ilike.%${input.name}%,last_name.ilike.%${input.name}%`);
        if (input.has_email === true)  q = q.not('email', 'is', null);
        if (input.has_email === false) q = q.is('email', null);
        if (input.has_phone === true)  q = q.or('phone.not.is.null,mobile.not.is.null');
        const { data, error } = await q;
        if (error) return { error: error.message };
        return { count: data?.length || 0, leads: data || [] };
      }
      case 'query_drafts': {
        let q = supabase.from('drafts').select('id, lead_id, channel, status, subject, body, created_at, sent_at').order('created_at', { ascending: false }).limit(Math.min(input.limit || 50, 200));
        if (input.campaign_id) {
          // drafts are joined via lead_id — filter by subquery
          const { data: leadIds } = await supabase.from('leads').select('id').eq('campaign_id', input.campaign_id).limit(5000);
          const ids = (leadIds || []).map((r) => r.id);
          if (!ids.length) return { count: 0, drafts: [] };
          q = q.in('lead_id', ids);
        }
        if (input.status)  q = q.eq('status',  input.status);
        if (input.channel) q = q.eq('channel', input.channel);
        if (input.since_days) {
          const cutoff = new Date(Date.now() - input.since_days * 86400000).toISOString();
          q = q.gte('created_at', cutoff);
        }
        const { data, error } = await q;
        if (error) return { error: error.message };
        return {
          count: data?.length || 0,
          drafts: (data || []).map((d) => ({
            ...d,
            body: (d.body || '').slice(0, 400),
          })),
        };
      }
      case 'lead_stats': {
        // Pull a page of leads, aggregate in-process. Supabase doesn't expose SQL GROUP BY
        // over the REST API without an RPC, so this is the portable option.
        let q = supabase.from('leads').select('campaign_id, city, state, zip').limit(5000);
        if (input.campaign_id) q = q.eq('campaign_id', input.campaign_id);
        const { data, error } = await q;
        if (error) return { error: error.message };
        const counts = {};
        for (const r of data || []) {
          const key = r[input.group_by === 'campaign' ? 'campaign_id' : input.group_by] ?? '(null)';
          counts[key] = (counts[key] || 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, Math.min(input.limit || 30, 100));
        return { group_by: input.group_by, total_scanned: data?.length || 0, groups: sorted.map(([k, v]) => ({ key: k, count: v })) };
      }

      case 'perplexity_research':  return await perplexityResearch(input.query, { model: input.model });
      case 'tavily_search':        return await tavilySearch(input.query, { maxResults: input.max_results });
      case 'exa_social_search':    return await exaSocialSearch(input.query, { numResults: input.num_results });
      case 'exa_general_search':   return await exaSearch(input.query, { numResults: input.num_results });
      case 'jina_read_url':        return await jinaRead(input.url);
      case 'reverse_geocode':      return await nominatimReverse(input.lat, input.lng);
      case 'forward_geocode':      return { results: await nominatimSearch(input.query, { limit: input.limit }) };

      default: return { error: 'unknown tool: ' + name };
    }
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

function bboxOf(points) {
  let n = -90, s = 90, e = -180, w = 180;
  for (const p of points) {
    n = Math.max(n, p.lat); s = Math.min(s, p.lat);
    e = Math.max(e, p.lng); w = Math.min(w, p.lng);
  }
  return { neLat: n, neLng: e, swLat: s, swLng: w };
}

function summarizeResult(result) {
  if (!result) return '';
  if (result.error)      return `err: ${String(result.error).slice(0, 80)}`;
  if (typeof result.count === 'number') return `${result.count} items`;
  if (Array.isArray(result.campaigns)) return `${result.campaigns.length} campaigns`;
  if (Array.isArray(result.events))    return `${result.events.length} events`;
  if (Array.isArray(result.results))   return `${result.results.length} results${result.answer ? ' + answer' : ''}`;
  if (Array.isArray(result.alerts))    return `${result.alerts.length} alerts`;
  if (Array.isArray(result.places))    return `${result.places.length} places`;
  if (Array.isArray(result.rows))      return `${result.row_count} rows`;
  if (result.campaign)                 return `campaign #${result.campaign.id}`;
  if (result.content)                  return `${result.content.length} chars`;
  if (result.answer)                   return `answer + ${Array.isArray(result.citations) ? result.citations.length : 0} citations`;
  return 'ok';
}

// =================================================================
// SSE helpers
// =================================================================
function sseWrite(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

// =================================================================
// Handler — streams SSE
// =================================================================
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = await readJson(req);
  const inputMessages = Array.isArray(body?.messages) ? body.messages : [];
  if (!inputMessages.length) return res.status(400).json({ error: 'messages[] required' });

  const s = body.settings || {};
  const maxTokens = Math.min(Math.max(parseInt(s.maxTokens || 16000, 10), 1024), 64000);
  // NOTE: Claude Opus 4.7 deprecated `temperature` — not forwarded even if sent.

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const messages = inputMessages.map((m) => ({ role: m.role, content: m.content }));
  const steps = [];
  let totalInput = 0, totalOutput = 0;
  const MAX_ITER = 6;

  try {
    for (let iter = 0; iter < MAX_ITER; iter++) {
      const stream = client.messages.stream({
        model: 'claude-opus-4-7',
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      // Forward text deltas to the client as they arrive
      stream.on('text', (delta) => {
        sseWrite(res, { type: 'text_delta', text: delta });
      });

      const finalMsg = await stream.finalMessage();
      totalInput  += finalMsg.usage?.input_tokens  || 0;
      totalOutput += finalMsg.usage?.output_tokens || 0;

      // Append the full assistant turn to history (preserves tool_use + thinking blocks)
      messages.push({ role: 'assistant', content: finalMsg.content });

      const toolCalls = (finalMsg.content || []).filter((b) => b.type === 'tool_use');
      if (finalMsg.stop_reason === 'end_turn' || toolCalls.length === 0) {
        break;
      }

      // Notify UI that tools are starting, then run them in parallel
      for (const call of toolCalls) {
        sseWrite(res, { type: 'tool_start', id: call.id, name: call.name, input: call.input });
      }

      const toolResults = await Promise.all(toolCalls.map(async (call) => {
        const result = await runTool(call.name, call.input || {});
        const preview = summarizeResult(result);
        const ok = !result?.error;
        steps.push({ tool: call.name, input: call.input, ok, preview });
        sseWrite(res, { type: 'tool_result', id: call.id, ok, preview });
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(result).slice(0, 30000),
          is_error: !ok,
        };
      }));

      messages.push({ role: 'user', content: toolResults });
      sseWrite(res, { type: 'iter_end', iteration: iter + 1 });
    }

    sseWrite(res, {
      type: 'done',
      usage: { input_tokens: totalInput, output_tokens: totalOutput },
      steps,
    });
    res.end();
  } catch (err) {
    console.error('[strategist]', err);
    sseWrite(res, { type: 'error', message: err.message || String(err) });
    res.end();
  }
}
