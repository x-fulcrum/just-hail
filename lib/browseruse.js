// BrowserUse Cloud client — autonomous browser agent.
// ----------------------------------------------------------------
// Use cases for Hailey:
//   - Log into IHM and re-pull cookies when our session expires
//   - Drive insurance carrier portals to upload claim docs
//   - Scrape JS-heavy county records that block fetch+Firecrawl
//   - Verify a URL is alive + render a screenshot
//
// API: https://api.browser-use.com/api/v3
// Auth: X-Browser-Use-API-Key header (NOT Bearer)
// Docs: https://docs.browser-use.com (sessions endpoint)
//
// "Sessions" replaced the older "tasks" terminology in v3. Each
// session is one autonomous browser run. Create → poll → get result.

const BASE = 'https://api.browser-use.com/api/v3';

function key() {
  const k = process.env.BROWSERUSE_API_KEY;
  if (!k) throw new Error('BROWSERUSE_API_KEY not set');
  return k;
}

function authHeaders() {
  return {
    'X-Browser-Use-API-Key': key(),
    'content-type': 'application/json',
  };
}

// ----------------------------------------------------------------
// run — kick off a new session. Returns { session_id, ... }
// ----------------------------------------------------------------
export async function run({ task, llm = null, max_steps = 30, allowed_domains = null, save_browser_data = false }) {
  if (!task) throw new Error('task (string) required');
  const body = {
    task,
    ...(llm ? { model: llm } : {}),
    ...(max_steps ? { max_steps } : {}),
    ...(allowed_domains ? { allowed_domains } : {}),
    ...(save_browser_data ? { save_browser_data } : {}),
  };
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`browseruse run ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();  // { session_id, live_url, ... }
}

// ----------------------------------------------------------------
// status — poll a session by ID
// ----------------------------------------------------------------
export async function status(sessionId) {
  const res = await fetch(`${BASE}/sessions/${sessionId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`browseruse status ${res.status}`);
  return res.json();  // { id, status, output, step_count, cost, live_url, ... }
}

// ----------------------------------------------------------------
// stop — cancel a running session
// ----------------------------------------------------------------
export async function stop(sessionId) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/stop`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`browseruse stop ${res.status}`);
  return res.json();
}

// ----------------------------------------------------------------
// runAndWait — fire + poll until done (blocks up to maxWaitMs)
// ----------------------------------------------------------------
export async function runAndWait({ task, llm = null, max_steps = 30, allowed_domains = null, maxWaitMs = 180_000, pollIntervalMs = 3_000 }) {
  const created = await run({ task, llm, max_steps, allowed_domains });
  const sessionId = created.session_id || created.id;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const s = await status(sessionId);
    const st = (s.status || '').toLowerCase();
    if (['finished', 'completed', 'failed', 'stopped', 'idle', 'success', 'error'].includes(st)) {
      return s;
    }
  }
  // Timeout — return current status
  return await status(sessionId);
}

// ----------------------------------------------------------------
// listSessions — recent sessions (useful for admin UI)
// ----------------------------------------------------------------
export async function listSessions({ limit = 20 } = {}) {
  const res = await fetch(`${BASE}/sessions?limit=${limit}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`browseruse list ${res.status}`);
  return res.json();
}
// Backwards-compat alias for any callers using the old name
export const listTasks = listSessions;

// ----------------------------------------------------------------
// healthCheck — list sessions (read-only, no compute cost)
// ----------------------------------------------------------------
export async function healthCheck() {
  if (!process.env.BROWSERUSE_API_KEY) {
    return { ok: false, configured: false, reason: 'no_api_key' };
  }
  const start = Date.now();
  try {
    await listSessions({ limit: 1 });
    return { ok: true, configured: true, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, configured: true, latency_ms: Date.now() - start, error: err.message?.slice(0, 200) };
  }
}
