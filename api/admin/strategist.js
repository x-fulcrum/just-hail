// POST /api/admin/strategist
// ---------------------------------------------------------------
// Multi-turn chat with Claude Opus 4.7 as Charlie's Hail Canvassing
// Strategist. Claude has access to tools that query:
//   - Just Hail's own campaigns / leads (Supabase)
//   - IHM storm data (via our session-cookie proxy)
//   - General web search (Tavily)
//   - Social/forum search (Exa — where people actually post hail damage)
//   - URL content extraction (Jina Reader)
//
// Body: { messages: [{role, content}, ...] }
// Response: { reply, steps, usage }
//   - reply   : final assistant text
//   - steps   : tool calls executed this turn (so UI can show "searched
//               Exa for X", "queried 3 campaigns", etc.)

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../lib/supabase.js';
import { tavilySearch, exaSearch, exaSocialSearch, jinaRead } from '../../lib/research.js';
import { getStormData } from '../../lib/ihm-web.js';

const client = new Anthropic();

export const config = { api: { bodyParser: false }, maxDuration: 60 };

// ---------------------------------------------------------------
// Strategist system prompt — who Claude is, how to act
// ---------------------------------------------------------------
const SYSTEM_PROMPT = `
You are the Hail Canvassing Strategist for Just Hail — a 4-person expert paintless dent repair (PDR) team owned by Charlie Ohnstad. 18 years in business, same phone number (512) 221-3013 since 2008, currently based in Leander, TX (shop moves with storms).

Your job is to help Charlie make SURGICAL decisions about where to pull polygons, which storms to chase, and where to find inquiry-ready customers. Charlie closes 100% of warm leads he talks to — your job is to surface signals, not generate noise.

You have these tools:
- search_our_campaigns: query Just Hail's Supabase campaigns table (polygons Charlie has pulled)
- get_campaign_detail: full info on one campaign including lead counts
- get_recent_storms: hail webhooks that landed in our system
- fetch_ihm_storms: live hail data from IHM for a date + geographic bounding box
- tavily_search: general web search — news, local coverage, forecasts
- exa_social_search: semantic search of social media (Reddit, Twitter/X, NextDoor, Facebook, TikTok). THIS is the superpower — use it to find people actually posting hail damage photos and asking for repair referrals.
- exa_general_search: semantic web search for anything non-social
- jina_read_url: extract full readable content from a specific URL (use after a search surfaces a promising result)

HOW TO REASON:
1. When Charlie asks "where should I go next?" — first see what he's already covered (search_our_campaigns), then look at recent storms (fetch_ihm_storms or get_recent_storms), then search Exa social for people posting damage in the uncovered areas.
2. When he asks about a specific area or storm — combine Tavily (news) + Exa (social posts) to give him a real-time read.
3. Don't make stuff up. If tools return nothing useful, say so.
4. Be decisive. Give specific neighborhoods, specific zip codes, specific URLs to posts. Skip "maybe" — Charlie's time is money.
5. When you find specific social posts mentioning hail damage in an identifiable location, format them clearly with the URL so Charlie can click through. These are potential warm leads.
6. Short paragraphs. Numbered lists. Bold the action items. No marketing-speak.
7. If you use a tool and it fails, try an alternative. Don't get stuck.

BUSINESS FACTS you can leverage in responses:
- Leander, TX shop (308 Hazelwood St Ste 1, 78641) is current base of ops — but Charlie moves crews to wherever storms justify it
- Service area extends through Central Texas primarily, but Charlie chases storms nationwide
- Bills insurance direct with 38 carriers; most customers pay $0 out of pocket
- Lifetime workmanship warranty
- 24,800+ vehicles restored over 18 years
`.trim();

// ---------------------------------------------------------------
// Tool definitions (schema Claude sees)
// ---------------------------------------------------------------
const TOOLS = [
  {
    name: 'search_our_campaigns',
    description: "Search Just Hail's campaigns table in Supabase. Returns a list of polygons Charlie has pulled, with lead counts, status, dates. Use this to see what's already been covered.",
    input_schema: {
      type: 'object',
      properties: {
        query:  { type: 'string', description: 'Optional text filter — matches campaign.name' },
        limit:  { type: 'integer', default: 20, maximum: 50 },
      },
    },
  },
  {
    name: 'get_campaign_detail',
    description: 'Full info on one campaign: leads, polygon coordinates, metadata. Use AFTER search_our_campaigns to drill into a specific one.',
    input_schema: {
      type: 'object',
      properties: { campaign_id: { type: 'integer' } },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_recent_storms',
    description: "Recent storm events that hit Just Hail's webhook endpoint (from IHM's hail alert subscription). Returns events of all types.",
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', default: 14, maximum: 90 } },
    },
  },
  {
    name: 'fetch_ihm_storms',
    description: "Live query to IHM's StormData API. Returns hail swath data for a date range within a geographic bounding box. Use this to see where recent hail actually fell.",
    input_schema: {
      type: 'object',
      properties: {
        begin: { type: 'string', description: 'Start date in M/D/YYYY format' },
        end:   { type: 'string', description: 'End date in M/D/YYYY format (same as begin for single day)' },
        neLat: { type: 'number', description: 'Northeast corner latitude of bounding box' },
        neLng: { type: 'number' },
        swLat: { type: 'number' },
        swLng: { type: 'number' },
      },
      required: ['begin', 'end'],
    },
  },
  {
    name: 'tavily_search',
    description: 'General web search for news, forecasts, reports. Returns snippets + URLs. Use for "what happened in X" or local news coverage of storms.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'integer', default: 5, maximum: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'exa_social_search',
    description: "Semantic search of social media platforms (Reddit, Twitter/X, Facebook, NextDoor, TikTok, Instagram). USE THIS to find people actually posting hail damage photos, asking for repair shops, or discussing recent storms in their neighborhood. Query in natural language: 'people posting hail damage photos Cedar Park Texas April 2026' — return includes post URL, snippet, highlights, author when available.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language query about what you want to find' },
        num_results: { type: 'integer', default: 8, maximum: 15 },
      },
      required: ['query'],
    },
  },
  {
    name: 'exa_general_search',
    description: 'Semantic web search (non-social). Good for finding structured info, like lists of affected zips, city press releases, storm summaries.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        num_results: { type: 'integer', default: 5, maximum: 15 },
      },
      required: ['query'],
    },
  },
  {
    name: 'jina_read_url',
    description: "Extract clean readable content from a specific URL (strips nav, ads, boilerplate). Use after a search returns a promising link and you want the full article/post text.",
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
];

// ---------------------------------------------------------------
// Tool executor — runs the actual function when Claude calls a tool
// ---------------------------------------------------------------
async function runTool(name, input) {
  try {
    switch (name) {
      case 'search_our_campaigns': {
        const { query = null, limit = 20 } = input;
        let q = supabase.from('campaigns').select('id, name, status, target_type, target_input, created_at, property_hits, contact_hits, enrichment_finished_at').order('created_at', { ascending: false }).limit(Math.min(limit, 50));
        if (query) q = q.ilike('name', `%${query}%`);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return {
          campaigns: (data || []).map((c) => ({
            id: c.id, name: c.name, status: c.status,
            created_at: c.created_at,
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
            id: c.id, name: c.name, status: c.status,
            created_at: c.created_at,
            target_type: c.target_type,
            territory_id: c.target_input?.territory_id || null,
            polygon_points: c.target_input?.polygon?.length || 0,
            polygon_bounds: c.target_input?.polygon ? bboxOfPolygon(c.target_input.polygon) : null,
            leads: c.property_hits || 0,
            contacts: c.contact_hits || 0,
          },
          sample_leads: leads || [],
        };
      }
      case 'get_recent_storms': {
        const days = Math.min(parseInt(input.days || 14, 10), 90);
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const { data } = await supabase.from('storm_events').select('id, received_at, event_type, alert_category, swath_size_in, street, city, state, zip, lat, lng').gt('received_at', since).order('received_at', { ascending: false }).limit(100);
        return { events: data || [] };
      }
      case 'fetch_ihm_storms': {
        const { begin, end, neLat, neLng, swLat, swLng } = input;
        const data = await getStormData({ begin, end, neLat, neLng, swLat, swLng });
        const preview = JSON.stringify(data);
        return { raw: preview.length > 3000 ? preview.slice(0, 3000) + '…' : preview };
      }
      case 'tavily_search': {
        return await tavilySearch(input.query, { maxResults: input.max_results });
      }
      case 'exa_social_search': {
        return await exaSocialSearch(input.query, { numResults: input.num_results });
      }
      case 'exa_general_search': {
        return await exaSearch(input.query, { numResults: input.num_results });
      }
      case 'jina_read_url': {
        return await jinaRead(input.url);
      }
      default:
        return { error: 'unknown tool: ' + name };
    }
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

function bboxOfPolygon(points) {
  let n = -90, s = 90, e = -180, w = 180;
  for (const p of points) {
    n = Math.max(n, p.lat); s = Math.min(s, p.lat);
    e = Math.max(e, p.lng); w = Math.min(w, p.lng);
  }
  return { neLat: n, neLng: e, swLat: s, swLng: w };
}

// ---------------------------------------------------------------
// Chat handler — runs Claude tool loop for ONE user turn
// ---------------------------------------------------------------
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
  const inputMessages = Array.isArray(body?.messages) ? body.messages : [];
  if (!inputMessages.length) return res.status(400).json({ error: 'messages[] required' });

  // Copy so we don't mutate the client's array
  const messages = inputMessages.map((m) => ({ role: m.role, content: m.content }));

  const steps = [];
  let finalText = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const MAX_ITER = 6;

  try {
    for (let iter = 0; iter < MAX_ITER; iter++) {
      const resp = await client.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });
      totalInputTokens  += resp.usage?.input_tokens  || 0;
      totalOutputTokens += resp.usage?.output_tokens || 0;

      // Collect text and tool_use blocks
      const textOut = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const toolCalls = resp.content.filter((b) => b.type === 'tool_use');

      // Always append assistant turn (text + tool_use) to history
      messages.push({ role: 'assistant', content: resp.content });

      if (resp.stop_reason === 'end_turn' || toolCalls.length === 0) {
        finalText = textOut;
        break;
      }

      // Execute tool calls
      const toolResults = [];
      for (const call of toolCalls) {
        const result = await runTool(call.name, call.input || {});
        steps.push({ tool: call.name, input: call.input, ok: !result.error, preview: summarizeResult(result) });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(result).slice(0, 30000),
          is_error: !!result.error,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    if (!finalText) {
      finalText = '(Strategist hit the tool-call cap without finalizing. Try re-asking.)';
    }
    return res.status(200).json({
      ok: true,
      reply: finalText,
      steps,
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    });
  } catch (err) {
    console.error('[strategist]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

function summarizeResult(result) {
  if (!result) return null;
  if (result.error) return `error: ${result.error}`;
  if (result.campaigns) return `${result.campaigns.length} campaigns`;
  if (result.events) return `${result.events.length} storm events`;
  if (result.results) return `${result.results.length} results${result.answer ? ' + answer' : ''}`;
  if (result.campaign) return `campaign #${result.campaign.id}`;
  if (result.content) return `${result.content.length} chars`;
  return 'ok';
}
