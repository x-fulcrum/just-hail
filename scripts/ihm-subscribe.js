#!/usr/bin/env node
/**
 * Interactive Hail Maps — subscription manager
 *
 * Usage (run from project root):
 *   node scripts/ihm-subscribe.js list-types     # list available webhook types
 *   node scripts/ihm-subscribe.js list           # list current subscriptions
 *   node scripts/ihm-subscribe.js subscribe      # subscribe to the default set
 *   node scripts/ihm-subscribe.js unsubscribe    # unsubscribe from all defaults
 *   node scripts/ihm-subscribe.js test           # subscribe to TEST alert
 *   node scripts/ihm-subscribe.js logs <typeId>  # recent delivery logs
 *
 * Reads env from .env.local when run locally. On Vercel the env comes
 * from the project env vars.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env.local manually — we don't want to add dotenv as a dep for
// something this simple. Silent failure if file is missing (Vercel).
function loadEnvLocal() {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const envPath = resolve(__dirname, '..', '.env.local');
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (!process.env[key] && val) process.env[key] = val;
    }
  } catch {
    // fine — no local env file
  }
}
loadEnvLocal();

const { ihmGet, ihmPost } = await import('../lib/ihm.js');

const SITE_URL = process.env.SITE_URL;
const WEBHOOK_SECRET = process.env.IHM_WEBHOOK_SECRET;

if (!SITE_URL) throw new Error('SITE_URL must be set');
if (!WEBHOOK_SECRET) throw new Error('IHM_WEBHOOK_SECRET must be set');

const WEBHOOK_URL = `${SITE_URL.replace(/\/$/, '')}/api/ihm-webhook`;

// Default categories we want to subscribe to on Phase 1.
// These are HAIL_ALERT categories per the Discover JSON.
const DEFAULT_CATEGORIES = [
  'HAIL_DETECTED',
  'HAIL_SPOTTED',
  'HAIL_FORECAST',
  'HAIL_PROXIMITY',
  'IMPACT_REPORT',
];

// ---------------------------------------------------------------------
async function listTypes() {
  const types = await ihmGet('/AgentApi/WebhookTypes');
  console.log(JSON.stringify(types, null, 2));
}

async function listSubs() {
  const subs = await ihmGet('/AgentApi/Webhooks');
  console.log(JSON.stringify(subs, null, 2));
}

// Find the webhook type id for a specific event type (e.g. 'monitoring_alert')
async function findTypeId(nameMatch) {
  const types = await ihmGet('/AgentApi/WebhookTypes');
  // Discover doesn't specify shape of /WebhookTypes response; adapt defensively.
  const arr = Array.isArray(types) ? types : (types.types || types.data || []);
  const match = arr.find((t) => {
    const n = (t.Name || t.name || t.eventType || t.type || '').toLowerCase();
    return n.includes(nameMatch.toLowerCase());
  });
  if (!match) throw new Error(`No webhook type matching "${nameMatch}" in: ${JSON.stringify(arr)}`);
  return match.AgentWebhookType_id ?? match.id ?? match.type_id;
}

async function subscribeOne({ typeId, category }) {
  const body = {
    AgentWebhookType_id: typeId,
    WebhookUrl: WEBHOOK_URL,
    WebhookSecret: WEBHOOK_SECRET,
  };
  if (category) body.AlertCategory = category;
  const result = await ihmPost('/AgentApi/Subscribe', body);
  console.log(`  ✓ subscribed: type=${typeId}${category ? ` category=${category}` : ''}`);
  return result;
}

async function subscribeDefaults() {
  console.log('→ Listing webhook types to find IDs...');
  const types = await ihmGet('/AgentApi/WebhookTypes');
  console.log(JSON.stringify(types, null, 2));

  // Try to find hail_alert type (or whatever it's called in the API response)
  const arr = Array.isArray(types) ? types : (types.types || types.data || []);

  // Naïve match — refine once we see the actual response shape
  const hailAlertType = arr.find((t) => {
    const n = (t.Name || t.name || t.eventType || t.type || '').toLowerCase();
    return n.includes('hail') && n.includes('alert');
  });
  const monitoringType = arr.find((t) => {
    const n = (t.Name || t.name || t.eventType || t.type || '').toLowerCase();
    return n.includes('monitoring');
  });
  const markerStatusType = arr.find((t) => {
    const n = (t.Name || t.name || t.eventType || t.type || '').toLowerCase();
    return (n.includes('marker') && n.includes('status')) || n.includes('status_changed');
  });

  const hailAlertId    = hailAlertType?.AgentWebhookType_id ?? hailAlertType?.id;
  const monitoringId   = monitoringType?.AgentWebhookType_id ?? monitoringType?.id;
  const markerStatusId = markerStatusType?.AgentWebhookType_id ?? markerStatusType?.id;

  console.log(`\n→ Resolved:`);
  console.log(`    hail_alert type id:        ${hailAlertId    ?? '(not found)'}`);
  console.log(`    monitoring_alert type id:  ${monitoringId   ?? '(not found)'}`);
  console.log(`    marker_status type id:     ${markerStatusId ?? '(not found)'}`);

  console.log(`\n→ Subscribing webhooks to ${WEBHOOK_URL}`);

  if (monitoringId)   await subscribeOne({ typeId: monitoringId });
  if (markerStatusId) await subscribeOne({ typeId: markerStatusId });
  if (hailAlertId) {
    for (const cat of DEFAULT_CATEGORIES) {
      await subscribeOne({ typeId: hailAlertId, category: cat });
    }
  }

  console.log('\n→ Current subscriptions:');
  console.log(JSON.stringify(await ihmGet('/AgentApi/Webhooks'), null, 2));
}

async function subscribeTest() {
  const types = await ihmGet('/AgentApi/WebhookTypes');
  const arr = Array.isArray(types) ? types : (types.types || types.data || []);
  const hailAlertType = arr.find((t) => {
    const n = (t.Name || t.name || t.eventType || t.type || '').toLowerCase();
    return n.includes('hail') && n.includes('alert');
  });
  const hailAlertId = hailAlertType?.AgentWebhookType_id ?? hailAlertType?.id;
  if (!hailAlertId) {
    console.error('Could not find hail_alert webhook type');
    console.error('Available types:', JSON.stringify(arr, null, 2));
    process.exit(1);
  }
  await subscribeOne({ typeId: hailAlertId, category: 'TEST' });
  console.log('\n✓ Subscribed to TEST alerts. Trigger one from IHM to verify.');
}

async function unsubscribeAll() {
  const subs = await ihmGet('/AgentApi/Webhooks');
  const arr = Array.isArray(subs) ? subs : (subs.subscriptions || subs.data || []);
  console.log(`→ Found ${arr.length} existing subscriptions`);
  for (const s of arr) {
    const typeId = s.AgentWebhookType_id ?? s.type_id ?? s.typeId;
    const body = { AgentWebhookType_id: typeId };
    if (s.UserEmail) body.UserEmail = s.UserEmail;
    if (s.AlertCategory) body.AlertCategory = s.AlertCategory;
    try {
      await ihmPost('/AgentApi/Unsubscribe', body);
      console.log(`  ✓ unsubscribed: ${JSON.stringify(body)}`);
    } catch (e) {
      console.error(`  ✗ failed: ${JSON.stringify(body)} → ${e.message}`);
    }
  }
}

async function showLogs(typeId) {
  if (!typeId) throw new Error('Usage: logs <AgentWebhookType_id>');
  const logs = await ihmGet('/AgentApi/WebhookLogs', { AgentWebhookType_id: typeId });
  console.log(JSON.stringify(logs, null, 2));
}

// ---------------------------------------------------------------------
const cmd = process.argv[2];
const arg = process.argv[3];

try {
  switch (cmd) {
    case 'list-types':  await listTypes(); break;
    case 'list':        await listSubs(); break;
    case 'subscribe':   await subscribeDefaults(); break;
    case 'test':        await subscribeTest(); break;
    case 'unsubscribe': await unsubscribeAll(); break;
    case 'logs':        await showLogs(arg); break;
    default:
      console.log('Usage:');
      console.log('  node scripts/ihm-subscribe.js list-types');
      console.log('  node scripts/ihm-subscribe.js list');
      console.log('  node scripts/ihm-subscribe.js subscribe');
      console.log('  node scripts/ihm-subscribe.js test');
      console.log('  node scripts/ihm-subscribe.js unsubscribe');
      console.log('  node scripts/ihm-subscribe.js logs <AgentWebhookType_id>');
      process.exit(1);
  }
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
}
