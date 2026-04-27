// /api/admin/drip
// ----------------------------------------------------------------
// Single endpoint for managing drip campaigns + sequences from the
// admin UI. Routes by `action` field (POST) or query param (GET).
//
//   POST { action: 'create_campaign', name, sequence_id, source_campaign_id?, storm_event_id?, metadata? }
//   POST { action: 'enroll', drip_campaign_id, lead_ids[] }
//   POST { action: 'enroll_from_polygon', drip_campaign_id, source_campaign_id }
//   POST { action: 'pause',  drip_campaign_id }
//   POST { action: 'resume', drip_campaign_id }
//   POST { action: 'abort',  drip_campaign_id }
//   POST { action: 'pause_lead',  drip_lead_state_id }
//   POST { action: 'resume_lead', drip_lead_state_id }
//   POST { action: 'force_send', drip_lead_state_id, channel, body, subject? }
//   POST { action: 'seed_default_sequences' }
//
//   GET  ?type=campaigns          → list all drip campaigns
//   GET  ?type=campaign&id=N      → details of one + its lead state counters
//   GET  ?type=sequences          → list all drip sequence templates
//   GET  ?type=sequence&id=N      → one sequence with full steps array
//   GET  ?type=lead&id=N          → drip_lead_state row + full timeline of touches
//   GET  ?type=campaign_leads&id=N&status=active → list leads in a drip with optional filter

import { supabase } from '../../lib/supabase.js';
import { enrollLeads } from '../../lib/drip-engine.js';
import { seedDefaults } from '../../lib/drip-sequences.js';
import { send as sendSms } from '../../lib/twilio-sms.js';

export const config = { api: { bodyParser: true }, maxDuration: 30 };

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[admin/drip]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ─────────────────── GET ───────────────────
async function handleGet(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const type = url.searchParams.get('type') || 'campaigns';
  const id = url.searchParams.get('id');

  if (type === 'campaigns') {
    const { data, error } = await supabase
      .from('drip_campaigns')
      .select(`
        id, name, status, sequence_id, source_campaign_id, storm_event_id,
        created_at, launched_at, completed_at,
        total_leads, active_leads, completed_leads, opted_out_leads, bounced_leads, hot_leads,
        emails_queued, emails_sent, emails_opened, emails_clicked, emails_replied, emails_bounced,
        sms_queued, sms_sent, sms_replied, voicemails_dropped, calls_made,
        drip_sequences ( name, total_days ),
        campaigns ( name )
      `)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return res.status(200).json({ ok: true, campaigns: data || [] });
  }

  if (type === 'campaign' && id) {
    const [{ data: campaign }, { data: seq }] = await Promise.all([
      supabase.from('drip_campaigns').select('*, drip_sequences(*), campaigns(*)').eq('id', id).single(),
      supabase.from('drip_sequences').select('*').eq('id',
        (await supabase.from('drip_campaigns').select('sequence_id').eq('id', id).single()).data?.sequence_id
      ).maybeSingle(),
    ]);
    if (!campaign) return res.status(404).json({ ok: false, error: 'not found' });

    // Recent touches (last 50) for this campaign
    const { data: recentTouches } = await supabase
      .from('drip_touches')
      .select('id, created_at, channel, event_type, recipient, lead_id, step_number')
      .eq('drip_campaign_id', id)
      .order('created_at', { ascending: false })
      .limit(50);

    return res.status(200).json({ ok: true, campaign, sequence: seq, recent_touches: recentTouches || [] });
  }

  if (type === 'sequences') {
    const { data } = await supabase
      .from('drip_sequences')
      .select('id, name, description, is_default, is_archived, total_days, created_at')
      .eq('is_archived', false)
      .order('is_default', { ascending: false })
      .order('name');
    return res.status(200).json({ ok: true, sequences: data || [] });
  }

  if (type === 'sequence' && id) {
    const { data } = await supabase.from('drip_sequences').select('*').eq('id', id).single();
    return res.status(200).json({ ok: true, sequence: data });
  }

  if (type === 'lead' && id) {
    // id is drip_lead_state.id
    const { data: state } = await supabase
      .from('drip_lead_state')
      .select(`
        *,
        leads ( id, first_name, last_name, email, phone, mobile, street, city, state, zip, status, opted_out ),
        drip_campaigns ( id, name, sequence_id, drip_sequences(*) )
      `)
      .eq('id', id)
      .single();
    if (!state) return res.status(404).json({ ok: false, error: 'not found' });

    const { data: timeline } = await supabase
      .from('drip_touches')
      .select('id, created_at, channel, event_type, recipient, sender, subject, body, step_number, error_message, link_clicked, reply_body')
      .eq('drip_lead_state_id', id)
      .order('created_at', { ascending: true });

    return res.status(200).json({ ok: true, state, timeline: timeline || [] });
  }

  if (type === 'campaign_leads' && id) {
    const status = url.searchParams.get('status');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 500);
    let q = supabase
      .from('drip_lead_state')
      .select('id, lead_id, status, current_step, next_step, scheduled_at, hot_lead, engagement_score, total_emails_opened, total_emails_clicked, total_replies, leads ( first_name, last_name, email, phone, mobile, street, city, state )')
      .eq('drip_campaign_id', id)
      .order('engagement_score', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);
    const { data } = await q;
    return res.status(200).json({ ok: true, leads: data || [] });
  }

  return res.status(400).json({ ok: false, error: 'unknown type' });
}

// ─────────────────── POST ───────────────────
async function handlePost(req, res) {
  const body = req.body || {};
  const action = String(body.action || '').toLowerCase();
  const triggered_by_user = (req.headers['x-admin-user'] || 'charlie').toString().slice(0, 60);

  switch (action) {
    case 'create_campaign': {
      const { name, sequence_id, source_campaign_id = null, storm_event_id = null, metadata = {} } = body;
      if (!name || !sequence_id) return res.status(400).json({ ok: false, error: 'name + sequence_id required' });
      const { data, error } = await supabase
        .from('drip_campaigns')
        .insert({
          name,
          sequence_id,
          source_campaign_id,
          storm_event_id,
          status: 'draft',
          triggered_by: 'admin_ui',
          triggered_by_user,
          metadata,
        })
        .select('*')
        .single();
      if (error) return res.status(500).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true, campaign: data });
    }

    case 'enroll': {
      const { drip_campaign_id, lead_ids } = body;
      const result = await enrollLeads({ drip_campaign_id, lead_ids, source: 'admin_ui' });
      return res.status(result.ok ? 200 : 400).json(result);
    }

    case 'enroll_from_polygon': {
      const { drip_campaign_id, source_campaign_id } = body;
      if (!drip_campaign_id || !source_campaign_id) {
        return res.status(400).json({ ok: false, error: 'drip_campaign_id + source_campaign_id required' });
      }
      // Pull all (non-opted-out) leads from the polygon source
      const { data: leads } = await supabase
        .from('leads')
        .select('id')
        .eq('campaign_id', source_campaign_id)
        .eq('opted_out', false)
        .limit(5000);
      if (!leads || !leads.length) return res.status(400).json({ ok: false, error: 'no eligible leads in source campaign' });
      const result = await enrollLeads({
        drip_campaign_id,
        lead_ids: leads.map(l => l.id),
        source: 'admin_ui_polygon',
      });
      return res.status(result.ok ? 200 : 400).json({ ...result, source_lead_count: leads.length });
    }

    case 'pause': {
      const { drip_campaign_id } = body;
      await supabase.from('drip_campaigns').update({
        status: 'paused', paused_at: new Date().toISOString(),
      }).eq('id', drip_campaign_id);
      return res.status(200).json({ ok: true });
    }
    case 'resume': {
      const { drip_campaign_id } = body;
      await supabase.from('drip_campaigns').update({
        status: 'active', paused_at: null,
      }).eq('id', drip_campaign_id);
      return res.status(200).json({ ok: true });
    }
    case 'abort': {
      const { drip_campaign_id } = body;
      await supabase.from('drip_campaigns').update({
        status: 'aborted', completed_at: new Date().toISOString(),
      }).eq('id', drip_campaign_id);
      // Stop all in-flight lead state
      await supabase.from('drip_lead_state').update({
        status: 'completed', scheduled_at: null,
      }).eq('drip_campaign_id', drip_campaign_id).eq('status', 'active');
      return res.status(200).json({ ok: true });
    }

    case 'pause_lead': {
      const { drip_lead_state_id } = body;
      await supabase.from('drip_lead_state').update({ status: 'paused' }).eq('id', drip_lead_state_id);
      return res.status(200).json({ ok: true });
    }
    case 'resume_lead': {
      const { drip_lead_state_id } = body;
      await supabase.from('drip_lead_state').update({ status: 'active' }).eq('id', drip_lead_state_id);
      return res.status(200).json({ ok: true });
    }

    case 'force_send': {
      const { drip_lead_state_id, channel, body: msgBody, subject } = body;
      if (!drip_lead_state_id) return res.status(400).json({ ok: false, error: 'drip_lead_state_id required' });
      if (!msgBody) return res.status(400).json({ ok: false, error: 'body required' });

      const { data: state } = await supabase
        .from('drip_lead_state')
        .select('id, drip_campaign_id, lead_id, leads ( id, first_name, last_name, email, phone, mobile, opted_out )')
        .eq('id', drip_lead_state_id)
        .single();
      if (!state) return res.status(404).json({ ok: false, error: 'state not found' });
      if (state.leads?.opted_out) {
        return res.status(400).json({ ok: false, error: 'lead is opted out — cannot force send' });
      }

      if (channel === 'sms') {
        const phone = state.leads.mobile || state.leads.phone;
        if (!phone) return res.status(400).json({ ok: false, error: 'lead has no phone' });
        const result = await sendSms({
          to: phone,
          body: msgBody,
          lead_id: state.lead_id,
          drip_campaign_id: state.drip_campaign_id,
          drip_lead_state_id: state.id,
          source: 'manual_admin',
        });
        return res.status(result.ok ? 200 : 400).json(result);
      }

      if (channel === 'email') {
        if (!state.leads?.email) return res.status(400).json({ ok: false, error: 'lead has no email' });
        if (!subject) return res.status(400).json({ ok: false, error: 'subject required for email' });

        // Verify email isn't undeliverable / toxic before sending
        const { verify } = await import('../../lib/bouncer.js');
        const verification = await verify(state.leads.email);
        if (verification.drop) {
          return res.status(400).json({ ok: false, error: 'email_undeliverable: ' + verification.status });
        }

        // Send via Resend (simpler than spinning up a Smartlead campaign for one-offs)
        const { sendEmail } = await import('../../lib/email.js');
        let sendResult;
        try {
          sendResult = await sendEmail({
            to: state.leads.email,
            subject,
            text: msgBody,
            tags: [
              { name: 'force_send', value: 'true' },
              { name: 'drip_campaign_id', value: String(state.drip_campaign_id) },
              { name: 'lead_id', value: String(state.lead_id) },
            ],
          });
        } catch (err) {
          await supabase.from('drip_touches').insert({
            drip_campaign_id: state.drip_campaign_id, lead_id: state.lead_id,
            drip_lead_state_id: state.id,
            channel: 'email', event_type: 'failed',
            recipient: state.leads.email, subject, body: msgBody,
            provider: 'resend',
            error_message: 'force_send_failed: ' + err.message,
          });
          return res.status(500).json({ ok: false, error: 'send_failed: ' + err.message });
        }

        await supabase.from('drip_touches').insert({
          drip_campaign_id: state.drip_campaign_id, lead_id: state.lead_id,
          drip_lead_state_id: state.id,
          channel: 'email', event_type: 'sent',
          recipient: state.leads.email, subject, body: msgBody,
          provider: 'resend',
          provider_message_id: sendResult?.id || sendResult?.data?.id || null,
          provider_response: sendResult,
          metadata: { source: 'manual_admin_force_send' },
        });
        await supabase.from('leads').update({
          last_touched_at: new Date().toISOString(),
          last_channel: 'email',
        }).eq('id', state.lead_id);
        return res.status(200).json({ ok: true, channel: 'email', resend_id: sendResult?.id || sendResult?.data?.id });
      }

      return res.status(400).json({ ok: false, error: 'channel must be "sms" or "email", got: ' + channel });
    }

    case 'seed_default_sequences': {
      const result = await seedDefaults();
      return res.status(200).json({ ok: true, results: result });
    }

    default:
      return res.status(400).json({ ok: false, error: 'unknown action: ' + action });
  }
}
