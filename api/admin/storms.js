// GET /api/admin/storms?limit=50&since=ISO_TIMESTAMP
//
// Returns recent storm_events for the admin dashboard command-center
// module. Runs server-side with the service_role key, so RLS is
// bypassed. admin.html calls this — anon key never touches the client.
//
// TODO (Phase 2): gate this behind the admin passcode check. Right now
// it relies on /admin.html already being passcode-gated; an attacker
// who knows the /api/admin/storms path bypasses that. Options:
//   - Cookie set by admin gate, validated here
//   - Shared ADMIN_TOKEN env var checked on Authorization header
// For Phase 1 this is acceptable — the endpoint returns lead data that
// is not yet enriched with PII beyond what's already on IHM markers.

import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const since = req.query.since;

  let q = supabase
    .from('storm_events')
    .select('id, received_at, event_type, alert_category, recon_marker_id, customer_name, street, city, state, zip, lat, lng, swath_size_in, level_detected, marker_status, status_source, external_key')
    .order('received_at', { ascending: false })
    .limit(limit);

  if (since) q = q.gt('received_at', since);

  const { data, error } = await q;
  if (error) {
    console.error('[admin/storms] query failed:', error);
    return res.status(500).json({ error: error.message });
  }

  // Also return counts by event_type for the dashboard summary
  const counts = data.reduce((acc, row) => {
    acc[row.event_type] = (acc[row.event_type] || 0) + 1;
    return acc;
  }, {});

  // Cache-bust so the admin page always gets fresh data
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).json({
    events: data,
    counts,
    fetched_at: new Date().toISOString(),
  });
}
