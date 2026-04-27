// BrowserUse Cloud client — autonomous browser agent.
// ----------------------------------------------------------------
// Use cases for Hailey:
//   - Log into IHM and re-pull cookies when our session expires
//     (replaces the manual ihm-session card eventually)
//   - Drive insurance carrier portals to upload claim docs
//   - Scrape JS-heavy county records that block fetch+Firecrawl
//   - Verify a URL is alive + render a screenshot
//
// API: https://api.browser-use.com/api/v1
// Docs: https://docs.browser-use.com/cloud
//
// All tasks are async. Create a task → get task_id → poll status →
// get result. Tasks expose a live `live_url` that streams the
// browser screen (we can iframe this in the admin to watch Hailey work).

const BASE = 'https://api.browser-use.com/api/v1';

function key() {
  const k = process.env.BROWSERUSE_API_KEY;
  if (!k) throw new Error('BROWSERUSE_API_KEY not set');
  return k;
}

// ----------------------------------------------------------------
// run — kick off a new browser task. Returns { id, live_url, ... }
// ----------------------------------------------------------------
export async function run({ task, llm = 'gpt-4o', max_steps = 30, allowed_domains = null, save_browser_data = false }) {
  if (!task) throw new Error('task (string) required');
  const body = {
    task,
    llm,
    max_steps,
    save_browser_data,
    ...(allowed_domains ? { allowed_domains } : {}),
  };
  const res = await fetch(`${BASE}/run-task`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${key()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`browseruse run ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();  // { id, live_url, ... }
}

// ----------------------------------------------------------------
// status — poll a task by ID
// ----------------------------------------------------------------
export async function status(taskId) {
  const res = await fetch(`${BASE}/task/${taskId}`, {
    headers: { 'authorization': `Bearer ${key()}` },
  });
  if (!res.ok) throw new Error(`browseruse status ${res.status}`);
  return res.json();  // { id, status, output, steps, live_url, ... }
}

// ----------------------------------------------------------------
// stop — cancel a running task
// ----------------------------------------------------------------
export async function stop(taskId) {
  const res = await fetch(`${BASE}/task/${taskId}/stop`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${key()}` },
  });
  if (!res.ok) throw new Error(`browseruse stop ${res.status}`);
  return res.json();
}

// ----------------------------------------------------------------
// runAndWait — fire + poll until done (blocks up to maxWaitMs)
// ----------------------------------------------------------------
export async function runAndWait({ task, llm = 'gpt-4o', max_steps = 30, allowed_domains = null, maxWaitMs = 180_000, pollIntervalMs = 3_000 }) {
  const created = await run({ task, llm, max_steps, allowed_domains });
  const taskId = created.id;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const s = await status(taskId);
    if (s.status === 'finished' || s.status === 'completed' || s.status === 'failed' || s.status === 'stopped') {
      return s;
    }
  }
  // Timeout — return current status
  return await status(taskId);
}

// ----------------------------------------------------------------
// listTasks — recent tasks (useful for the admin UI)
// ----------------------------------------------------------------
export async function listTasks({ limit = 20 } = {}) {
  const res = await fetch(`${BASE}/tasks?limit=${limit}`, {
    headers: { 'authorization': `Bearer ${key()}` },
  });
  if (!res.ok) throw new Error(`browseruse list ${res.status}`);
  return res.json();
}

// ----------------------------------------------------------------
// healthCheck
// ----------------------------------------------------------------
export async function healthCheck() {
  if (!process.env.BROWSERUSE_API_KEY) {
    return { ok: false, configured: false, reason: 'no_api_key' };
  }
  const start = Date.now();
  try {
    // Cheapest probe: list tasks (read-only, no compute spent)
    await listTasks({ limit: 1 });
    return { ok: true, configured: true, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, configured: true, latency_ms: Date.now() - start, error: err.message?.slice(0, 200) };
  }
}
