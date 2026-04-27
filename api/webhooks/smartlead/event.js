// POST /api/webhooks/smartlead/event
// ----------------------------------------------------------------
// Smartlead fires these events to us:
//   EMAIL_SENT, EMAIL_OPEN, EMAIL_LINK_CLICK, EMAIL_REPLY,
//   EMAIL_BOUNCE, LEAD_UNSUBSCRIBED, LEAD_CATEGORY_UPDATED
//
// Each event includes the lead's custom_fields where we baked
// `jh_lead_id`, `jh_drip_id`, `jh_drip_step` so we can attribute
// the event back to our drip_lead_state.

import { supabase } from '../../../lib/supabase.js';
import { capture as posthogCapture } from '../../../lib/posthog.js';

export const config = { api: { bodyParser: true }, maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  try {
    const body = req.body || {};
    // Smartlead's webhook shape varies by event type; common fields:
    //   event_type, campaign_id, lead_id (smartlead's), email,
    //   lead_data: { custom_fields: { jh_lead_id, jh_drip_id, jh_drip_step } }
    //   timestamp, message_id, ...
    const eventType = String(body.event_type || body.event || '').toUpperCase();
    const cfields = body.lead_data?.custom_fields || body.custom_fields || {};
    const jhLeadId = parseInt(cfields.jh_lead_id, 10) || null;
    const jhDripId = parseInt(cfields.jh_drip_id, 10) || null;
    const jhStep   = parseInt(cfields.jh_drip_step, 10) || null;
    const recipient = body.email || body.lead_data?.email || null;
    // Which warm mailbox actually sent? Smartlead exposes this in several
    // shapes depending on event type — try them all so the leads UI can
    // show "sent from yates@justsdr.co" instead of "(smartlead pool)".
    const fromEmail =
      body.from_email
      || body.email_account?.from_email
      || body.email_account?.email
      || body.sender_email
      || body.sender?.email
      || null;

    // Map Smartlead event → our event_type
    const map = {
      EMAIL_SENT:           'sent',
      EMAIL_OPEN:           'opened',
      EMAIL_LINK_CLICK:     'clicked',
      EMAIL_REPLY:          'replied',
      EMAIL_BOUNCE:         'bounced',
      LEAD_UNSUBSCRIBED:    'opt_out',
      LEAD_CATEGORY_UPDATED: 'category_change',
    };
    const ourEventType = map[eventType] || eventType.toLowerCase();

    // Find the matching state row (if attribution worked)
    let stateRow = null;
    if (jhDripId && jhLeadId) {
      const { data } = await supabase
        .from('drip_lead_state')
        .select('id, drip_campaign_id, lead_id, current_step, hot_lead, total_emails_opened, total_emails_clicked, total_replies, engagement_score')
        .eq('drip_campaign_id', jhDripId)
        .eq('lead_id', jhLeadId)
        .maybeSingle();
      stateRow = data;
    }

    // Insert touch row. The `sender` column captures which warm mailbox
    // delivered (yates@/gordon.pierce@/belinda.ramos@) so the admin UI
    // shows actual mailbox attribution, not just "smartlead pool".
    await supabase.from('drip_touches').insert({
      drip_campaign_id:  jhDripId,
      lead_id:           jhLeadId,
      drip_lead_state_id: stateRow?.id ?? null,
      step_number:       jhStep,
      channel:           'email',
      event_type:        ourEventType,
      recipient:         recipient,
      sender:            fromEmail,
      provider:          'smartlead',
      provider_message_id: body.message_id || body.smartlead_message_id || null,
      provider_response: body,
      link_clicked:      body.url || body.link_url || null,
      reply_body:        body.reply_message || body.reply_text || null,
    });

    // Update aggregate counters on drip_lead_state + the campaign
    if (stateRow) {
      const updates = { last_action_at: new Date().toISOString() };
      let newOpened = stateRow.total_emails_opened;
      let newClicked = stateRow.total_emails_clicked;
      let newReplies = stateRow.total_replies;
      let newScore = stateRow.engagement_score;
      let newHot = stateRow.hot_lead;

      switch (ourEventType) {
        case 'opened':
          newOpened++; newScore = Math.min(100, newScore + 5); break;
        case 'clicked':
          newClicked++; newScore = Math.min(100, newScore + 15); break;
        case 'replied':
          newReplies++; newScore = Math.min(100, newScore + 30); newHot = true; break;
        case 'bounced':
          updates.status = 'bounced_out';
          updates.scheduled_at = null;
          break;
        case 'opt_out':
          updates.status = 'opted_out';
          updates.opted_out_at = new Date().toISOString();
          updates.scheduled_at = null;
          // Also flag the lead globally
          if (jhLeadId) {
            await supabase.from('leads').update({
              opted_out: true,
              status: 'do_not_contact',
            }).eq('id', jhLeadId);
            // Audit
            await supabase.from('consent_log').insert({
              lead_id: jhLeadId,
              channel: 'email',
              action: 'opt_out',
              source: 'smartlead_event',
              trigger_message: body.reply_message || 'EMAIL_UNSUBSCRIBED',
              raw_payload: body,
            });
          }
          break;
      }

      Object.assign(updates, {
        total_emails_opened: newOpened,
        total_emails_clicked: newClicked,
        total_replies: newReplies,
        engagement_score: newScore,
        hot_lead: newHot,
      });
      await supabase.from('drip_lead_state').update(updates).eq('id', stateRow.id);
    }

    // Mirror engagement event into PostHog so the cross-channel timeline lives there too
    if (jhLeadId && ['opened', 'clicked', 'replied', 'bounced', 'opt_out'].includes(ourEventType)) {
      try {
        await posthogCapture({
          event: 'email_' + ourEventType,
          distinctId: 'lead_' + jhLeadId,
          properties: {
            drip_id: jhDripId,
            drip_step: jhStep,
            recipient,
            link_clicked: body.url || null,
          },
        });
      } catch {}
    }

    return res.status(200).json({ ok: true, event: ourEventType });
  } catch (err) {
    console.error('[smartlead webhook]', err);
    return res.status(200).json({ ok: false, error: err.message });   // 200 so Smartlead doesn't retry forever
  }
}
