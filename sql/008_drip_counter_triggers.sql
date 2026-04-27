-- =====================================================================
-- Migration 008 — Drip campaign counter auto-bump triggers
-- =====================================================================
-- Problem: drip_campaigns has denormalized counters (emails_sent,
-- emails_opened, hot_leads, active_leads, …) but nothing was incrementing
-- them. The UI showed "0 sent" even after a successful drip-tick because
-- the dispatch path logged a drip_touches row but never updated the
-- aggregate. Same for engagement webhook events.
--
-- Solution: triggers on drip_touches (touch counters) and drip_lead_state
-- (lead-bucket counters). Both auto-bump the campaign so ANY code path
-- that inserts a touch / changes a lead status updates the rollup.
-- This is race-free (UPDATE ... SET x = x + 1 is atomic per row).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Touch-counter trigger
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_drip_campaign_counter()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.drip_campaign_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.channel = 'email' THEN
    IF    NEW.event_type = 'sent'    THEN UPDATE public.drip_campaigns SET emails_sent     = emails_sent     + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'opened'  THEN UPDATE public.drip_campaigns SET emails_opened   = emails_opened   + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'clicked' THEN UPDATE public.drip_campaigns SET emails_clicked  = emails_clicked  + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'replied' THEN UPDATE public.drip_campaigns SET emails_replied  = emails_replied  + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'bounced' THEN UPDATE public.drip_campaigns SET emails_bounced  = emails_bounced  + 1 WHERE id = NEW.drip_campaign_id;
    END IF;
  ELSIF NEW.channel = 'sms' THEN
    IF    NEW.event_type = 'sent'    THEN UPDATE public.drip_campaigns SET sms_sent    = sms_sent    + 1 WHERE id = NEW.drip_campaign_id;
    ELSIF NEW.event_type = 'replied' THEN UPDATE public.drip_campaigns SET sms_replied = sms_replied + 1 WHERE id = NEW.drip_campaign_id;
    END IF;
  ELSIF NEW.channel = 'voicemail' AND NEW.event_type = 'sent' THEN
    UPDATE public.drip_campaigns SET voicemails_dropped = voicemails_dropped + 1 WHERE id = NEW.drip_campaign_id;
  ELSIF NEW.channel = 'call'      AND NEW.event_type = 'sent' THEN
    UPDATE public.drip_campaigns SET calls_made = calls_made + 1 WHERE id = NEW.drip_campaign_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS drip_touches_bump_campaign ON public.drip_touches;
CREATE TRIGGER drip_touches_bump_campaign
  AFTER INSERT ON public.drip_touches
  FOR EACH ROW EXECUTE FUNCTION public.bump_drip_campaign_counter();

-- ---------------------------------------------------------------------
-- Lead-bucket recompute (active/hot/bounced/opted_out/completed/total)
-- A SET-based recompute is simpler + race-safe (every status change
-- triggers a full re-aggregate for that one campaign).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_drip_campaign_lead_buckets(p_campaign_id bigint)
RETURNS void AS $$
  UPDATE public.drip_campaigns d
  SET
    total_leads      = COALESCE(s.total, 0),
    active_leads     = COALESCE(s.active, 0),
    hot_leads        = COALESCE(s.hot, 0),
    bounced_leads    = COALESCE(s.bounced, 0),
    opted_out_leads  = COALESCE(s.opted_out, 0),
    completed_leads  = COALESCE(s.completed, 0)
  FROM (
    SELECT
      drip_campaign_id,
      count(*)::int                                                   AS total,
      count(*) FILTER (WHERE status = 'active')::int                  AS active,
      count(*) FILTER (WHERE hot_lead = true)::int                    AS hot,
      count(*) FILTER (WHERE status = 'bounced_out')::int             AS bounced,
      count(*) FILTER (WHERE status = 'opted_out')::int               AS opted_out,
      count(*) FILTER (WHERE status = 'completed')::int               AS completed
    FROM public.drip_lead_state
    WHERE drip_campaign_id = p_campaign_id
    GROUP BY drip_campaign_id
  ) s
  WHERE d.id = p_campaign_id;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.bump_drip_campaign_lead_buckets()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recompute_drip_campaign_lead_buckets(NEW.drip_campaign_id);
  ELSIF TG_OP = 'UPDATE'
        AND (NEW.status   IS DISTINCT FROM OLD.status
          OR NEW.hot_lead IS DISTINCT FROM OLD.hot_lead) THEN
    PERFORM public.recompute_drip_campaign_lead_buckets(NEW.drip_campaign_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS drip_lead_state_bump_buckets ON public.drip_lead_state;
CREATE TRIGGER drip_lead_state_bump_buckets
  AFTER INSERT OR UPDATE ON public.drip_lead_state
  FOR EACH ROW EXECUTE FUNCTION public.bump_drip_campaign_lead_buckets();

-- ---------------------------------------------------------------------
-- One-time backfill so existing campaigns reflect their real numbers.
-- Idempotent: re-running is safe.
-- ---------------------------------------------------------------------
UPDATE public.drip_campaigns d
SET
  emails_sent       = COALESCE(t.sent, 0),
  emails_opened     = COALESCE(t.opened, 0),
  emails_clicked    = COALESCE(t.clicked, 0),
  emails_replied    = COALESCE(t.replied, 0),
  emails_bounced    = COALESCE(t.bounced, 0),
  sms_sent          = COALESCE(t.sms_sent, 0),
  sms_replied       = COALESCE(t.sms_replied, 0),
  voicemails_dropped= COALESCE(t.vm_sent, 0),
  calls_made        = COALESCE(t.call_sent, 0)
FROM (
  SELECT
    drip_campaign_id,
    count(*) FILTER (WHERE channel='email' AND event_type='sent')::int     AS sent,
    count(*) FILTER (WHERE channel='email' AND event_type='opened')::int   AS opened,
    count(*) FILTER (WHERE channel='email' AND event_type='clicked')::int  AS clicked,
    count(*) FILTER (WHERE channel='email' AND event_type='replied')::int  AS replied,
    count(*) FILTER (WHERE channel='email' AND event_type='bounced')::int  AS bounced,
    count(*) FILTER (WHERE channel='sms'   AND event_type='sent')::int     AS sms_sent,
    count(*) FILTER (WHERE channel='sms'   AND event_type='replied')::int  AS sms_replied,
    count(*) FILTER (WHERE channel='voicemail' AND event_type='sent')::int AS vm_sent,
    count(*) FILTER (WHERE channel='call'  AND event_type='sent')::int     AS call_sent
  FROM public.drip_touches
  WHERE drip_campaign_id IS NOT NULL
  GROUP BY drip_campaign_id
) t
WHERE d.id = t.drip_campaign_id;

SELECT public.recompute_drip_campaign_lead_buckets(id) FROM public.drip_campaigns;
