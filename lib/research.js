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
