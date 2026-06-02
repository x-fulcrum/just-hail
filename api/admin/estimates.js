// GET /api/admin/estimates
// ----------------------------------------------------------------
// The admin's "Estimate requests" section reads from this endpoint.
// Replaces the legacy Google Apps Script JSONP feed (which broke
// the moment Charlie redeployed the Apps Script project and the
// /macros/.../exec URL rotated). Supabase is now the source of
// truth — every form submission lands in /api/form-submit, which
// upserts the lead with source='website_form' + stashes the
// vehicle / severity / timeline / notes into vehicle_estimate jsonb.
//
// Returns the same JSON shape the legacy Apps Script feed did, so
// admin.html's existing render code keeps working:
//
//   {
//     ok: true,
//     leads: [
//       {
//         _row, submitted_at, reference_,
//         name, phone, email, zip,
//         vehicle, year, damage, insurer,
//         severity_label, estimated_range, timeline, notes,
//         status, source, user_agent,
//       },
//       ...
//     ]
//   }
//
// Auth: same ADMIN_KEY the rest of the dashboard uses, sent as
// ?key=... query param (admin.html sends it on every JSONP request).
// We also accept an x-admin-key header for cleaner future callers.

import { supabase } from '../../lib/supabase.js';

export const config = { maxDuration: 10 };

// Status mapping: leads table uses lowercase enum, admin UI expects
// title-case strings ('New' | 'Contacted' | 'Scheduled' | 'Closed').
const STATUS_MAP = {
  new:             'New',
  contacted:       'Contacted',
  engaged:         'Contacted',
  qualified:       'Contacted',
  scheduled:       'Scheduled',
  booked:          'Scheduled',
  signed:          'Scheduled',
  closed:          'Closed',
  closed_lost:     'Closed',
  closed_won:      'Closed',
  do_not_contact:  'Closed',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // Optional admin-key gate. Matches the rest of admin.html's pattern.
  const expectedKey = process.env.ADMIN_KEY || 'jh-leander-2026';
  const sentKey = req.query?.key || req.headers['x-admin-key'];
  if (expectedKey && sentKey !== expectedKey) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, created_at, first_name, last_name, email, phone, mobile, zip, status, external_key, source, source_system_id, vehicle_estimate, metadata')
      .eq('source', 'website_form')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('[admin/estimates] supabase error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    const leads = (data || []).map((row) => {
      const v = row.vehicle_estimate || {};
      const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
      const phoneRaw = row.mobile || row.phone || '';
      // Strip +1 prefix for the table's display (admin renders pretty itself)
      const phone = phoneRaw.replace(/^\+1/, '');
      const status = STATUS_MAP[String(row.status || 'new').toLowerCase()] || 'New';
      return {
        _row:            row.id,                 // used as the row click handle
        submitted_at:    row.created_at,
        reference_:      row.external_key || row.source_system_id || '',
        name:            name || row.email || '(no name)',
        phone,
        email:           row.email || '',
        zip:             row.zip || '',
        vehicle:         v.vehicle || '',
        year:            v.year || '',
        damage:          v.damage || '',
        insurer:         v.insurer || '',
        severity:        v.severity ?? null,
        severity_label:  v.severity_label || '',
        estimated_range: v.estimated_range || '',
        timeline:        v.timeline || '',
        notes:           v.notes || '',
        status,
        source:          row.metadata?.source_url || 'website_form',
        user_agent:      row.metadata?.user_agent || '',
      };
    });

    // Edge-cache lightly so multiple browser tabs share data. 30s is short
    // enough that the admin's auto-refresh keeps feeling live.
    res.setHeader('Cache-Control', 'private, max-age=30, must-revalidate');
    return res.status(200).json({ ok: true, leads });
  } catch (err) {
    console.error('[admin/estimates] unhandled:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
