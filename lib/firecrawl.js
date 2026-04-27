// Firecrawl client — hardcore web scraping.
// ----------------------------------------------------------------
// Use cases for Hailey:
//   - Scrape Williamson County appraisal district for property
//     records on a polygon's addresses
//   - Pull insurance carrier websites for "act of nature" comp claim
//     deductible-waiver policy details
//   - Crawl HOA directories
//   - Extract contact info from local business pages

const BASE = 'https://api.firecrawl.dev';

function key() {
  const k = process.env.FIRECRAWL_API_KEY;
  if (!k) throw new Error('FIRECRAWL_API_KEY not set');
  return k;
}

// ----------------------------------------------------------------
// scrape — single page → clean markdown
// ----------------------------------------------------------------
export async function scrape(url, { formats = ['markdown'], waitFor = 0 } = {}) {
  if (!url) throw new Error('url required');
  const res = await fetch(`${BASE}/v1/scrape`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${key()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats,
      waitFor: Math.min(waitFor, 30000),  // max 30s wait
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`firecrawl scrape ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

// ----------------------------------------------------------------
// crawl — multi-page crawl starting from a URL
//   Async — returns a job ID. Poll status() to get results.
// ----------------------------------------------------------------
export async function crawl(url, { limit = 20, scrapeOptions = {} } = {}) {
  const res = await fetch(`${BASE}/v1/crawl`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${key()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      url,
      limit,
      scrapeOptions: { formats: ['markdown'], ...scrapeOptions },
    }),
  });
  if (!res.ok) throw new Error(`firecrawl crawl ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  return res.json();  // { id, url }
}

export async function crawlStatus(jobId) {
  const res = await fetch(`${BASE}/v1/crawl/${jobId}`, {
    headers: { 'authorization': `Bearer ${key()}` },
  });
  if (!res.ok) throw new Error(`firecrawl status ${res.status}`);
  return res.json();
}

// ----------------------------------------------------------------
// extract — schema-driven extraction (powerful for structured data)
//   Pass a JSON schema describing what to extract.
// ----------------------------------------------------------------
export async function extract({ urls, prompt, schema = null }) {
  const res = await fetch(`${BASE}/v1/extract`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${key()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      urls: Array.isArray(urls) ? urls : [urls],
      prompt,
      ...(schema ? { schema } : {}),
    }),
  });
  if (!res.ok) throw new Error(`firecrawl extract ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  return res.json();
}

// ----------------------------------------------------------------
// search — Firecrawl's web search (returns snippets + URLs)
// ----------------------------------------------------------------
export async function search(query, { limit = 10 } = {}) {
  const res = await fetch(`${BASE}/v1/search`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${key()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) throw new Error(`firecrawl search ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  return res.json();
}

// ----------------------------------------------------------------
// healthCheck
// ----------------------------------------------------------------
export async function healthCheck() {
  if (!process.env.FIRECRAWL_API_KEY) {
    return { ok: false, configured: false, reason: 'no_api_key' };
  }
  const start = Date.now();
  try {
    // Cheapest probe: scrape a known stable page
    await scrape('https://example.com', { formats: ['markdown'] });
    return { ok: true, configured: true, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, configured: true, latency_ms: Date.now() - start, error: err.message?.slice(0, 200) };
  }
}
