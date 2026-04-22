// Research stack — Tavily, Exa, Jina wrappers.
// Claude calls these via tool-use when it needs outside info.

// --------------------------------------------------------------
// Tavily — general web search with LLM-optimized snippets
// https://docs.tavily.com
// --------------------------------------------------------------
export async function tavilySearch(query, { maxResults = 5, topic = 'general' } = {}) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error('TAVILY_API_KEY not set');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      topic,
      search_depth: 'advanced',
      max_results: Math.min(maxResults, 10),
      include_answer: true,
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return {
    answer: data.answer || null,
    results: (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      content: (r.content || '').slice(0, 600),
      score: r.score,
    })),
  };
}

// --------------------------------------------------------------
// Exa — semantic/social search (indexes Reddit, Twitter, forums)
// https://docs.exa.ai
// --------------------------------------------------------------
export async function exaSearch(query, { numResults = 10, includeDomains, useAutoprompt = true } = {}) {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error('EXA_API_KEY not set');
  const body = {
    query,
    numResults: Math.min(numResults, 25),
    type: 'auto',
    useAutoprompt,
    contents: { text: { maxCharacters: 800, includeHtmlTags: false }, highlights: true },
  };
  if (includeDomains?.length) body.includeDomains = includeDomains;
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Exa ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return {
    autoprompt: data.autopromptString || null,
    results: (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      text: (r.text || '').slice(0, 600),
      highlights: r.highlights || [],
      publishedDate: r.publishedDate,
      author: r.author,
    })),
  };
}

// Exa specifically for social media posts. Scopes to major platforms
// where hail-damage posts actually appear.
export async function exaSocialSearch(query, { numResults = 10 } = {}) {
  return exaSearch(query, {
    numResults,
    includeDomains: ['reddit.com', 'twitter.com', 'x.com', 'facebook.com', 'nextdoor.com', 'instagram.com', 'tiktok.com'],
  });
}

// --------------------------------------------------------------
// Jina Reader — extract clean readable content from a URL
// https://jina.ai/reader — free without key (rate-limited), higher with key
// --------------------------------------------------------------
export async function jinaRead(url) {
  if (!url) throw new Error('url required');
  const key = process.env.JINA_API_KEY;
  const headers = { Accept: 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`https://r.jina.ai/${url}`, { headers });
  if (!res.ok) throw new Error(`Jina ${res.status}`);
  const data = await res.json().catch(async () => ({ data: { content: await res.text() } }));
  return {
    title: data?.data?.title || null,
    url: data?.data?.url || url,
    content: (data?.data?.content || '').slice(0, 4000),
  };
}

// --------------------------------------------------------------
// Perplexity — multi-step research with citations. Use for questions
// that need synthesizing across multiple sources.
// Models: sonar (fast+good), sonar-pro (deeper).
// --------------------------------------------------------------
export async function perplexityResearch(query, { model = 'sonar', maxTokens = 1200 } = {}) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) throw new Error('PERPLEXITY_API_KEY not set');
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a focused research assistant. Answer concisely with cited sources. Prefer recency.' },
        { role: 'user', content: query },
      ],
      max_tokens: maxTokens,
      return_citations: true,
    }),
  });
  if (!res.ok) throw new Error(`Perplexity ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const msg = data?.choices?.[0]?.message;
  return {
    answer: msg?.content || '',
    citations: data?.citations || msg?.citations || [],
    usage: data?.usage || null,
  };
}

// --------------------------------------------------------------
// Nominatim (OpenStreetMap) — free forward + reverse geocoding.
// --------------------------------------------------------------
const NOMINATIM_UA = 'just-hail-admin/1.0 (info.justhail@gmail.com)';

export async function nominatimSearch(query, { limit = 5 } = {}) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=${Math.min(limit, 10)}&addressdetails=1`;
  const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim search ${res.status}`);
  const data = await res.json();
  return (data || []).map((r) => ({
    display_name: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    type: r.type,
    importance: r.importance,
    address: r.address || null,
  }));
}

export async function nominatimReverse(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=16`;
  const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim reverse ${res.status}`);
  const data = await res.json();
  return {
    display_name: data?.display_name || null,
    city: data?.address?.city || data?.address?.town || data?.address?.village || null,
    county: data?.address?.county || null,
    state: data?.address?.state || null,
    zip: data?.address?.postcode || null,
    address: data?.address || null,
  };
}

// --------------------------------------------------------------
// National Weather Service (NWS) — free, no key. Active alerts.
// https://www.weather.gov/documentation/services-web-api
// --------------------------------------------------------------
export async function nwsActiveAlerts({ state, event, severity } = {}) {
  const qs = new URLSearchParams();
  if (state) qs.set('area', state.toUpperCase());
  if (event) qs.set('event', event);
  if (severity) qs.set('severity', severity);
  const url = `https://api.weather.gov/alerts/active?${qs.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA, Accept: 'application/geo+json' } });
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  const data = await res.json();
  return (data?.features || []).map((f) => ({
    event: f.properties?.event,
    severity: f.properties?.severity,
    urgency: f.properties?.urgency,
    headline: f.properties?.headline,
    areaDesc: f.properties?.areaDesc,
    effective: f.properties?.effective,
    expires: f.properties?.expires,
    description: (f.properties?.description || '').slice(0, 500),
  }));
}
