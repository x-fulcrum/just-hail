-- =====================================================================
-- Migration 010 — Distinguish "queued at Smartlead" from "actually sent"
-- =====================================================================
-- The drip-engine logs event_type='queued' when a lead is handed to
-- Smartlead, and event_type='sent' only fires when Smartlead's
-- EMAIL_SENT webhook says the email was actually delivered.
--
-- This adds emails_queued + sms_queued to the campaign rollup so the
-- admin UI can distinguish "in flight at Smartlead" from "actually
-- delivered". Without this, "Sent: 0" looked like nothing was happening
-- when in reality 187 leads were already in Smartlead's 20-min-spaced
-- send queue.
-- =====================================================================

ALTER TABLE public.drip_campaigns
  ADD COLUMN IF NOT EXISTS emails_queued int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_queued    int NOT NULL DEFAULT 0;

-- Extend the existing bump trigger to count 'queued' events too.
-- (Replaces 008 + 009's function — same name, additive behavior.)
CREATE OR REPLACE FUNCTION public.bump_drip_campaign_counter()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.drip_campaign_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.channel = 'email' THEN
    IF    NEW.event_type = 'sent'    THEN UPDATE public.drip_campaigns SET emails_sent     = emails_sent     + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'queued'  THEN UPDATE public.drip_campaigns SET emails_queued   = emails_queued   + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'opened'  THEN UPDATE public.drip_campaigns SET emails_opened   = emails_opened   + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'clicked' THEN UPDATE public.drip_campaigns SET emails_clicked  = emails_clicked  + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'replied' THEN UPDATE public.drip_campaigns SET emails_replied  = emails_replied  + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'bounced' THEN UPDATE public.drip_campaigns SET emails_bounced  = emails_bounced  + 1 WHERE id = NEW.drip_campaign_id;
    END IF;
  ELSIF NEW.channel = 'sms' THEN
    IF    NEW.event_type = 'sent'    THEN UPDATE public.drip_campaigns SET sms_sent    = sms_sent    + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'queued'  THEN UPDATE public.drip_campaigns SET sms_queued  = sms_queued  + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'replied' THEN UPDATE public.drip_campaigns SET sms_replied = sms_replied + 1 WHERE id = NEW.drip_campaign_id;
    END IF;
  ELSIF NEW.channel = 'voicemail' AND NEW.event_type = 'sent' THEN
    UPDATE public.drip_campaigns SET voicemails_dropped = voicemails_dropped + 1 WHERE id = NEW.drip_campaign_id;
  ELSIF NEW.channel = 'call'      AND NEW.event_type = 'sent' THEN
    UPDATE public.drip_campaigns SET calls_made = calls_made + 1 WHERE id = NEW.drip_campaign_id;
  END IF;

  -- Per-lead rollup (counts both 'queued' and 'sent' as touches that
  -- "happened to this lead" so total_emails_sent reflects the full count
  -- of times we tried to reach them via this channel).
  IF NEW.drip_lead_state_id IS NOT NULL AND NEW.event_type IN ('sent','queued') THEN
    IF NEW.channel = 'email' THEN
      UPDATE public.drip_lead_state
        SET total_emails_sent = total_emails_sent + 1,
            last_sender = COALESCE(NEW.sender, last_sender),
            last_sender_channel = 'email'
        WHERE id = NEW.drip_lead_state_id;
    ELSIF NEW.channel = 'sms' THEN
      UPDATE public.drip_lead_state
        SET total_sms_sent = total_sms_sent + 1,
            last_sender = COALESCE(NEW.sender, last_sender),
            last_sender_channel = 'sms'
        WHERE id = NEW.drip_lead_state_id;
    ELSIF NEW.channel = 'voicemail' AND NEW.event_type = 'sent' THEN
      UPDATE public.drip_lead_state
        SET total_voicemails_dropped = total_voicemails_dropped + 1,
            last_sender = COALESCE(NEW.sender, last_sender),
            last_sender_channel = 'voicemail'
        WHERE id = NEW.drip_lead_state_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill emails_queued + sms_queued from existing drip_touches
UPDATE public.drip_campaigns d
SET emails_queued = COALESCE(t.email_q, 0),
    sms_queued    = COALESCE(t.sms_q, 0)
FROM (
  SELECT
    drip_campaign_id,
    count(*) FILTER (WHERE channel='email' AND event_type='queued')::int AS email_q,
    count(*) FILTER (WHERE channel='sms'   AND event_type='queued')::int AS sms_q
  FROM public.drip_touches
  WHERE drip_campaign_id IS NOT NULL
  GROUP BY drip_campaign_id
) t
WHERE d.id = t.drip_campaign_id;
