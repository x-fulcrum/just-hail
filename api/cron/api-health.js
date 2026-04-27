// GET /api/cron/api-health
// ----------------------------------------------------------------
// Vercel cron — runs every minute. Pings each integration's health
// endpoint and writes the result to api_health table. The admin's
// API Health strip reads from that table (no live pings on page load).

import { supabase } from '../../lib/supabase.js';
import * as smartlead from '../../lib/smartlead.js';
import * as bouncer from '../../lib/bouncer.js';
import * as twilioLookup from '../../lib/twilio-lookup.js';
import * as twilioSms from '../../lib/twilio-sms.js';
import * as dnc from '../../lib/dnc.js';
import * as drive from '../../lib/google-drive.js';
import * as sheets from '../../lib/google-sheets.js';
import * as firecrawl from '../../lib/firecrawl.js';
import * as browseruse from '../../lib/browseruse.js';
import * as posthog from '../../lib/posthog.js';

export const config = { maxDuration: 60 };

const SERVICES = [
  ['smartlead',     smartlead],
  ['bouncer',       bouncer],
  ['twilio_lookup', twilioLookup],
  ['twilio_sms',    twilioSms],
  ['dnc',           dnc],
  ['google_drive',  drive],
  ['google_sheets', sheets],
  ['firecrawl',     firecrawl],
  ['browseruse',    browseruse],
  ['posthog',       posthog],
];

function authOk(req) {
  if (req.headers['x-vercel-cron-signature']) return true;
  const secret = process.env.LINDY_CALLBACK_SECRET;
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  return secret && (auth === secret || url.searchParams.get('secret') === secret);
}

export default async function handler(req, res) {
  if (!authOk(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  // Run all health checks in parallel
  const results = await Promise.all(SERVICES.map(async ([name, mod]) => {
    if (!mod.healthCheck) return { service: name, ok: false, error: 'no_health_check' };
    try {
      const r = await mod.healthCheck();
      return { service: name, ...r };
    } catch (err) {
      return { service: name, ok: false, error: err.message?.slice(0, 200) };
    }
  }));

  // Write to api_health table (one row per service)
  const now = new Date().toISOString();
  const upserts = await Promise.all(results.map(async (r) => {
    const { data: existing } = await supabase
      .from('api_health')
      .select('consecutive_fails')
      .eq('service', r.service)
      .maybeSingle();
    const fails = r.ok ? 0 : ((existing?.consecutive_fails || 0) + 1);
    return supabase
      .from('api_health')
      .upsert({
        service: r.service,
        checked_at: now,
        ok: !!r.ok,
        status_code: r.status_code || null,
        latency_ms: r.latency_ms || null,
        error_message: r.error || r.reason || null,
        consecutive_fails: fails,
        notes: r.message || null,
      }, { onConflict: 'service' });
  }));

  return res.status(200).json({
    ok: true,
    checked: results.length,
    summary: results.map(r => ({ service: r.service, ok: r.ok, latency_ms: r.latency_ms })),
    ts: now,
  });
}
