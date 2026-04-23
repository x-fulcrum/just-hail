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
import { getStormData, getSwathPolygons } from '../../lib/ihm-web.js';
import { getSpcOutlookSummary, getSpcMultiDayOutlook } from '../../lib/spc.js';
import { draftForLead } from '../../lib/drafts.js';
import { sendEmail } from '../../lib/email.js';
import { upsertContact, addTags, removeTags } from '../../lib/ghl.js';

const client = new Anthropic();

export const config = { api: { bodyParser: false }, maxDuration: 60 };

// =================================================================
// System prompt
// =================================================================
const SYSTEM_PROMPT = `
You are Charlie Ohnstad's Hail Canvassing + Sales Strategist for Just Hail — a 4-person expert paintless dent repair (PDR) team. 18 years in business, same phone (512) 221-3013 since 2008, based in Leander TX (shop moves with storms). 24,800+ vehicles restored. Bills insurance direct w/ 38 carriers. Lifetime workmanship warranty.

YOUR MISSION: Help Charlie replace his entire traditional sales team by making surgical decisions about where to pull polygons, which storms to chase, who to contact, and how to engage. You are the tip of the spear.

TOOLS — USE THEM AGGRESSIVELY AND IN PARALLEL WHEN POSSIBLE:

Hail + storm data (past + present):
- fetch_ihm_swath_polygons : get the actual storm swath polygons for a date (with size tiers) — BEST first call to scope a storm
- fetch_ihm_storms         : individual hail pins for a date + bounding box (defaults to CONUS)
- get_recent_storms        : storms that hit our IHM webhook
- nws_active_alerts        : National Weather Service live alerts (by state)

Hail FORECAST (future — what's coming):
- get_hail_outlook         : NOAA Storm Prediction Center convective outlook, Day 1 (today) through Day 8. Always use this when Charlie asks about FUTURE hail risk, upcoming storms, or where to position for the next event. Day 1-2 have hail-specific probability; Day 3+ have categorical/severe-probability.

Just Hail's CRM state (read):
- search_our_campaigns     : what polygons Charlie has already pulled
- get_campaign_detail      : full info on one campaign (sample leads + bounds)
- query_leads              : search leads table w/ filters (campaign_id, zip, city, name, has_email, has_phone)
- query_drafts             : search drafts (pending/approved/sent/failed) w/ filters
- lead_stats               : aggregate counts grouped by campaign/city/zip/state
- get_lead_full            : deep snapshot of one lead (row + all drafts) — call BEFORE drafting/sending

Engagement (write):
- draft_outreach_for_lead  : generate SMS + email drafts with Claude (saves approved=false). SAFE to call proactively — drafts don't send anything.
- approve_draft            : flip approved=true on a specific draft. DESTRUCTIVE intent (draft becomes sendable). REQUIRES explicit user confirmation in chat before calling.
- send_approved_email_draft: actually emails the lead via Resend. MOST DESTRUCTIVE — real email goes out. REQUIRES explicit user confirmation naming the specific draft_id. Never chain approve→send without user saying "send it" in between.
- push_lead_to_ghl         : upsert a GHL contact for a lead (adds default tags + triggers workflows). Reversible; safe to call when the user asks.
- tag_ghl_contact          : add or remove tags on a GHL contact. Safe; used to trigger or pause GHL workflows.

ENGAGEMENT SAFETY RULES (NON-NEGOTIABLE):
- Drafting is fine to do proactively when Charlie asks for outreach content.
- NEVER approve a draft without Charlie explicitly saying "approve" or similar.
- NEVER send an email without Charlie explicitly saying "send" and specifying which draft. Recap the subject + first line before sending, so Charlie can veto.
- Always surface the draft_id + who it's going to + subject + preview of the first ~120 chars before asking for send confirmation.
- If Charlie says "send all approved drafts" or "send to the whole campaign", REFUSE until you've listed every recipient for him to eyeball. No blast sends without per-email visibility.

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
   - lead_outreach_drafts: id, created_at, lead_id, campaign_id, channel (email/sms), subject, body, model, approved (bool), sent_at, sent_status. Query via query_drafts — derives status (pending/approved/sent/failed) from approved + sent_at + sent_status.
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
    description: 'Individual hail-impact pins from IHM for a date + viewport. Each pin has Lat/Long/Size/Comments. Viewport (neLat/neLng/swLat/swLng) is REQUIRED by IHM — if omitted we default to CONUS-wide.',
    input_schema: { type: 'object', required: ['begin'], properties: {
      begin: { type: 'string', description: 'M/D/YYYY' },
      end:   { type: 'string', description: 'M/D/YYYY (defaults to begin)' },
      neLat: { type: 'number' }, neLng: { type: 'number' },
      swLat: { type: 'number' }, swLng: { type: 'number' },
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
  { name: 'get_hail_outlook',
    description: 'NOAA Storm Prediction Center (SPC) convective outlook for Day 1-8. FORECAST DATA — use when Charlie asks about TODAY or FUTURE hail risk anywhere in the US. Day 1=today, Day 2=tomorrow, ..., Day 8=a week out. Day 1 & 2 have both categorical risk AND hail-specific probability; Day 3 has categorical + general severe probability; Day 4-8 are general severe probability only. Returns tier labels, colors, bbox, centroid for each risk zone.',
    input_schema: { type: 'object', properties: {
      day:  { type: 'integer', description: '1-8. Omit to get Days 1-3 at once.' },
      days: { type: 'array', items: { type: 'integer' }, description: 'Array of days (e.g. [1,2,3,4,5]) — ignored if `day` is provided.' },
      kind: { type: 'string', enum: ['cat','hail','prob'], description: "cat=categorical risk (default, all days); hail=hail-specific probability (Day 1-2 only); prob=general severe probability (Day 3+)." },
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
    description: 'Search the lead_outreach_drafts table. Drafts are Claude-written email/SMS per-lead. Filter by status (pending/approved/sent/failed), channel, or campaign.',
    input_schema: { type: 'object', properties: {
      campaign_id: { type: 'integer' },
      status:      { type: 'string', enum: ['pending','approved','sent','failed'], description: 'pending=not yet approved, approved=approved but not sent, sent=delivered, failed=send attempt failed' },
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

  // ============================================================
  // Engagement tools — Phase 3b (write operations w/ safety gates)
  // ============================================================
  { name: 'get_lead_full',
    description: 'Full read-only snapshot of one lead: row + all associated drafts + campaign info. Call this BEFORE drafting or contacting a lead so you know what exists already and which channels are still available.',
    input_schema: { type: 'object', required: ['lead_id'], properties: {
      lead_id: { type: 'integer' },
    }}},
  { name: 'draft_outreach_for_lead',
    description: "Generate AI-written SMS + email drafts for one lead using Claude (Charlie's voice). Saves BOTH channels as separate rows in lead_outreach_drafts with approved=false. SAFE to call proactively when asked — drafts don't send anything. Re-drafting deletes any existing UNAPPROVED drafts for this lead+channel first (approved history preserved). Returns sms_draft_id, email_draft_id + previews.",
    input_schema: { type: 'object', required: ['lead_id'], properties: {
      lead_id:        { type: 'integer' },
      storm_context:  { type: 'string', description: "Optional free-text storm context Charlie wants worked in (e.g. '4/18 Cedar Park hail, 1.75\"+')" },
    }}},
  { name: 'approve_draft',
    description: "Flip a draft's `approved` flag to TRUE. Does NOT send — just marks the draft as sendable. REQUIRES `confirm: true` AND explicit user authorization in chat (e.g. Charlie said 'approve draft 42'). NEVER call this proactively without a direct user instruction.",
    input_schema: { type: 'object', required: ['draft_id', 'confirm'], properties: {
      draft_id: { type: 'integer' },
      confirm:  { type: 'boolean', description: 'MUST be true. Gate to prevent accidental approval.' },
    }}},
  { name: 'send_approved_email_draft',
    description: "Send an already-approved email draft to the lead via Resend. REAL EMAIL goes out. Most destructive tool. REQUIREMENTS: draft must exist, be an email draft, have approved=true, and not already be sent. MUST pass `confirm: true`. Before calling, always recap to Charlie: draft_id, recipient email, subject, and first ~120 chars of body — then wait for an explicit 'send it' or similar.",
    input_schema: { type: 'object', required: ['draft_id', 'confirm'], properties: {
      draft_id: { type: 'integer' },
      confirm:  { type: 'boolean', description: 'MUST be true. Gate to prevent accidental send.' },
    }}},
  { name: 'push_lead_to_ghl',
    description: "Upsert a single lead as a GoHighLevel contact. Adds default tags (just-hail, campaign-{id}, src-{source} if present) plus any extra_tags. Tag-added events trigger any GHL workflows listening for them — this is how Charlie fires cadences. Reversible (remove the contact in GHL), so safe to call when asked.",
    input_schema: { type: 'object', required: ['lead_id'], properties: {
      lead_id:    { type: 'integer' },
      extra_tags: { type: 'array', items: { type: 'string' }, description: 'Additional tags to attach — e.g. ["jh-strategist-routed", "priority-high"]' },
    }}},
  { name: 'tag_ghl_contact',
    description: "Add or remove tags from an existing GHL contact. Pass remove=true to REMOVE. Tag changes are the primary way to trigger/pause GHL workflows (e.g. add 'pause-cadence' to stop a running sequence).",
    input_schema: { type: 'object', required: ['ghl_contact_id', 'tags'], properties: {
      ghl_contact_id: { type: 'string', description: 'The GHL contact id returned from push_lead_to_ghl or lookup.' },
      tags:           { type: 'array', items: { type: 'string' }, minItems: 1 },
      remove:         { type: 'boolean', description: 'true to remove these tags; false (default) to add them.' },
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
        // IHM's /Api/StormData requires all four bbox params — supply a
        // CONUS-wide default when the caller omits them.
        const args = {
          begin: input.begin,
          end:   input.end || input.begin,
          neLat: input.neLat ?? 50,
          neLng: input.neLng ?? -65,
          swLat: input.swLat ?? 24,
          swLng: input.swLng ?? -125,
        };
        const data = await getStormData(args);
        const arr = Array.isArray(data) ? data : [];
        return {
          count: arr.length,
          bbox: { neLat: args.neLat, neLng: args.neLng, swLat: args.swLat, swLng: args.swLng },
          pins: arr.slice(0, 30).map((p) => ({
            lat: p.Lat, lng: p.Long, size_in: p.Size, heat: p.Heat,
            comments: String(p.Comments || '').replace(/<br\s*\/?>/gi, ' ').slice(0, 160),
          })),
        };
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
      case 'get_hail_outlook': {
        const kind = input.kind || 'cat';
        if (input.day) {
          return await getSpcOutlookSummary(input.day, kind);
        }
        const days = Array.isArray(input.days) && input.days.length ? input.days : [1, 2, 3];
        return { outlooks: await getSpcMultiDayOutlook({ days, kind }) };
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
        // Real table: lead_outreach_drafts
        // Columns: id, created_at, lead_id, campaign_id, channel, subject, body,
        //          model, approved, sent_at, sent_status, sent_provider_id.
        // No single `status` column — we derive it from approved + sent_at + sent_status.
        let q = supabase
          .from('lead_outreach_drafts')
          .select('id, created_at, lead_id, campaign_id, channel, subject, body, model, approved, sent_at, sent_status')
          .order('created_at', { ascending: false })
          .limit(Math.min(input.limit || 50, 200));
        if (input.campaign_id) q = q.eq('campaign_id', input.campaign_id);
        if (input.channel)     q = q.eq('channel', input.channel);
        if (input.since_days) {
          const cutoff = new Date(Date.now() - input.since_days * 86400000).toISOString();
          q = q.gte('created_at', cutoff);
        }
        // Derived status filters map to (approved, sent_at, sent_status) combos.
        if (input.status === 'pending')  q = q.eq('approved', false).is('sent_at', null);
        if (input.status === 'approved') q = q.eq('approved', true ).is('sent_at', null);
        if (input.status === 'sent')     q = q.not('sent_at', 'is', null).neq('sent_status', 'failed');
        if (input.status === 'failed')   q = q.eq('sent_status', 'failed');

        const { data, error } = await q;
        if (error) return { error: error.message };
        return {
          count: data?.length || 0,
          drafts: (data || []).map((d) => ({
            id: d.id,
            created_at: d.created_at,
            lead_id: d.lead_id,
            campaign_id: d.campaign_id,
            channel: d.channel,
            subject: d.subject,
            body: (d.body || '').slice(0, 400),
            model: d.model,
            approved: d.approved,
            sent_at: d.sent_at,
            sent_status: d.sent_status,
            derived_status: d.sent_status === 'failed' ? 'failed'
                          : d.sent_at ? 'sent'
                          : d.approved ? 'approved'
                          : 'pending',
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

      // ====== Engagement (Phase 3b) ======
      case 'get_lead_full': {
        const id = parseInt(input.lead_id, 10);
        if (!id) return { error: 'lead_id required' };
        const [{ data: lead }, { data: drafts }] = await Promise.all([
          supabase.from('leads').select('*').eq('id', id).single(),
          supabase.from('lead_outreach_drafts').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
        ]);
        if (!lead) return { error: 'lead not found' };
        let campaign = null;
        if (lead.campaign_id) {
          const { data } = await supabase.from('campaigns').select('id, name, status, target_type, created_at, target_input').eq('id', lead.campaign_id).single();
          if (data) campaign = {
            id: data.id, name: data.name, status: data.status, created_at: data.created_at,
            territory_id: data.target_input?.territory_id || null,
            polygon_points: data.target_input?.polygon?.length || 0,
          };
        }
        return {
          lead: {
            id: lead.id, campaign_id: lead.campaign_id,
            first_name: lead.first_name, last_name: lead.last_name,
            email: lead.email, phone: lead.phone, mobile: lead.mobile,
            street: lead.street, city: lead.city, state: lead.state, zip: lead.zip,
            source: lead.source, status: lead.status,
            opted_out: lead.opted_out || false,
            last_touched_at: lead.last_touched_at || null,
            last_channel: lead.last_channel || null,
          },
          campaign,
          drafts: (drafts || []).map((d) => ({
            id: d.id, channel: d.channel, approved: d.approved,
            subject: d.subject, body: (d.body || '').slice(0, 400),
            sent_at: d.sent_at, sent_status: d.sent_status,
            derived_status: d.sent_status === 'failed' ? 'failed'
                          : d.sent_at ? 'sent'
                          : d.approved ? 'approved'
                          : 'pending',
            created_at: d.created_at,
          })),
        };
      }

      case 'draft_outreach_for_lead': {
        const id = parseInt(input.lead_id, 10);
        if (!id) return { error: 'lead_id required' };
        const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single();
        if (!lead) return { error: 'lead not found' };
        let campaign = null;
        if (lead.campaign_id) {
          const { data } = await supabase.from('campaigns').select('*').eq('id', lead.campaign_id).single();
          campaign = data;
        }
        let draft;
        try {
          draft = await draftForLead({ lead, campaign, stormContext: input.storm_context || null });
        } catch (err) {
          return { error: `drafting failed: ${err.message}` };
        }
        // Drop any existing UNAPPROVED drafts for this lead on these channels (preserve approved history).
        await supabase.from('lead_outreach_drafts')
          .delete().eq('lead_id', id).eq('approved', false).in('channel', ['sms', 'email']);
        const now = new Date().toISOString();
        const [{ data: smsRow, error: sErr }, { data: emRow, error: eErr }] = await Promise.all([
          supabase.from('lead_outreach_drafts').insert({
            lead_id: id, campaign_id: lead.campaign_id, channel: 'sms',
            body: draft.sms.body, model: draft.model, approved: false, created_at: now,
          }).select('id').single(),
          supabase.from('lead_outreach_drafts').insert({
            lead_id: id, campaign_id: lead.campaign_id, channel: 'email',
            subject: draft.email.subject, body: draft.email.body,
            model: draft.model, approved: false, created_at: now,
          }).select('id').single(),
        ]);
        if (sErr) return { error: 'sms insert failed: ' + sErr.message };
        if (eErr) return { error: 'email insert failed: ' + eErr.message };
        return {
          lead_id: id,
          sms_draft_id: smsRow.id,
          email_draft_id: emRow.id,
          sms_body: draft.sms.body,
          email_subject: draft.email.subject,
          email_body_preview: draft.email.body.slice(0, 400),
          personalization_used: draft.personalization_used,
          approved: false,
        };
      }

      case 'approve_draft': {
        const id = parseInt(input.draft_id, 10);
        if (!id) return { error: 'draft_id required' };
        if (input.confirm !== true) return { error: 'confirm must be true — user must explicitly authorize approval' };
        const { data: before } = await supabase.from('lead_outreach_drafts').select('*').eq('id', id).single();
        if (!before) return { error: 'draft not found' };
        if (before.approved) return { ok: true, draft_id: id, already_approved: true };
        if (before.sent_at)  return { error: `draft ${id} already sent at ${before.sent_at} — nothing to approve` };
        const { error } = await supabase.from('lead_outreach_drafts').update({ approved: true }).eq('id', id);
        if (error) return { error: error.message };
        return {
          ok: true, draft_id: id, approved: true,
          channel: before.channel, lead_id: before.lead_id,
          subject: before.subject, body_preview: (before.body || '').slice(0, 200),
        };
      }

      case 'send_approved_email_draft': {
        const id = parseInt(input.draft_id, 10);
        if (!id) return { error: 'draft_id required' };
        if (input.confirm !== true) return { error: 'confirm must be true — user must explicitly authorize send' };
        const { data: draft } = await supabase.from('lead_outreach_drafts').select('*').eq('id', id).single();
        if (!draft) return { error: 'draft not found' };
        if (draft.channel !== 'email') return { error: 'draft is not an email draft' };
        if (!draft.approved) return { error: 'draft not approved — call approve_draft first' };
        if (draft.sent_at)   return { error: `already sent at ${draft.sent_at}` };
        const { data: lead } = await supabase.from('leads').select('*').eq('id', draft.lead_id).single();
        if (!lead) return { error: 'lead not found' };
        if (lead.opted_out) return { error: 'lead has opted out' };
        if (!lead.email)    return { error: 'lead has no email address' };
        try {
          const result = await sendEmail({
            to: lead.email, subject: draft.subject, text: draft.body,
            tags: [
              { name: 'campaign_id', value: String(draft.campaign_id || 'none') },
              { name: 'lead_id',     value: String(lead.id) },
              { name: 'draft_id',    value: String(draft.id) },
              { name: 'source',      value: 'strategist' },
            ],
          });
          const now = new Date().toISOString();
          await Promise.all([
            supabase.from('lead_outreach_drafts').update({ sent_at: now, sent_status: 'delivered', sent_provider_id: result.id }).eq('id', id),
            supabase.from('leads').update({ status: 'contacted', last_touched_at: now, last_channel: 'email' }).eq('id', lead.id),
          ]);
          return { ok: true, draft_id: id, resend_id: result.id, to: lead.email, subject: draft.subject, sent_at: now };
        } catch (err) {
          await supabase.from('lead_outreach_drafts').update({ sent_status: 'failed' }).eq('id', id);
          return { error: `send failed: ${err.message}`, hint: err.status === 403 ? 'Sender domain not verified in Resend — check RESEND_FROM.' : undefined };
        }
      }

      case 'push_lead_to_ghl': {
        const id = parseInt(input.lead_id, 10);
        if (!id) return { error: 'lead_id required' };
        const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single();
        if (!lead) return { error: 'lead not found' };
        const extraTags = Array.isArray(input.extra_tags) ? input.extra_tags : [];
        try {
          const result = await upsertContact(lead, ['jh-new-lead', ...extraTags]);
          return {
            ok: true, lead_id: id,
            ghl_contact_id: result?.contact?.id || null,
            is_new: !!result?.new,
            tags_applied: ['just-hail', lead.source ? `src-${lead.source}` : null, lead.campaign_id ? `campaign-${lead.campaign_id}` : null, 'jh-new-lead', ...extraTags].filter(Boolean),
          };
        } catch (err) {
          return { error: `GHL push failed: ${err.message}`, hint: err.status === 401 || err.status === 403 ? 'GHL token missing contacts.write / contacts.readonly scope — enable in GHL Private Integration settings.' : undefined };
        }
      }

      case 'tag_ghl_contact': {
        const cid = String(input.ghl_contact_id || '').trim();
        if (!cid) return { error: 'ghl_contact_id required' };
        const tags = Array.isArray(input.tags) ? input.tags.filter(Boolean) : [];
        if (!tags.length) return { error: 'tags array must have at least one entry' };
        try {
          const result = input.remove === true ? await removeTags(cid, tags) : await addTags(cid, tags);
          return { ok: true, ghl_contact_id: cid, tags, action: input.remove ? 'removed' : 'added', result };
        } catch (err) {
          return { error: `GHL tag failed: ${err.message}`, hint: err.status === 401 || err.status === 403 ? 'GHL token missing tags.write scope.' : undefined };
        }
      }

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
