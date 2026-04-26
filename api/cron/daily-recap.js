// GET /api/cron/daily-recap
// ----------------------------------------------------------------
// Vercel cron-triggered endpoint. Fires daily at 23:00 UTC = 6pm
// Central Daylight Time (5pm Central Standard during winter).
//
// Builds the day's stats from call_logs + sms_messages + leads,
// dispatches jh-recap-caller, which calls Charlie at 6pm and reads
// the recap aloud. Charlie can ask follow-up actions on the call;
// those come back via /api/webhooks/lindy/recap-action.
//
// Auth: Vercel cron requests have header `x-vercel-cron-signature`
// or come from the Vercel cron infra. We additionally allow manual
// trigger with the LINDY_CALLBACK_SECRET (so we can test without
// waiting until 6pm).

import { dailyRecap } from '../../lib/lindy.js';
import { buildRecapStats } from '../admin/lindy.js';

export const config = { maxDuration: 60 };

function authOk(req) {
  // Vercel cron sends an internal signature
  if (req.headers['x-vercel-cron-signature']) return true;
  // Manual trigger via secret
  const secret = process.env.LINDY_CALLBACK_SECRET;
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const fromQs = url.searchParams.get('secret');
  return secret && (auth === secret || fromQs === secret);
}

export default async function handler(req, res) {
  if (!authOk(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  try {
    const stats = await buildRecapStats();
    const summaries = stats._hot_lead_summaries || [];
    delete stats._hot_lead_summaries;

    // Skip the call entirely if the day was completely quiet — no reason
    // to wake Charlie up at 6pm just to say "nothing happened today."
    const totallyQuiet =
      stats.inbound_calls_today === 0 &&
      stats.outbound_calls_made === 0 &&
      stats.sms_threads_active === 0 &&
      stats.new_leads_today === 0;
    if (totallyQuiet) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'quiet_day', stats });
    }

    const result = await dailyRecap({
      to_phone: process.env.RECAP_PHONE || '+15122213013',
      stats,
      hot_lead_summaries: summaries,
    });

    return res.status(200).json({
      ok: result.ok,
      job_id: result.job_id,
      http_status: result.http_status,
      stats_summary: {
        inbound_calls: stats.inbound_calls_today,
        outbound_calls: stats.outbound_calls_made,
        new_leads: stats.new_leads_today,
        hot_replies: stats.hot_replies_pending,
        booked_tomorrow: stats.inspections_tomorrow,
      },
    });
  } catch (err) {
    console.error('[cron/daily-recap]', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
