-- =====================================================================
-- Migration 009 — pg_cron + pg_net redundant cron triggers
-- =====================================================================
-- Vercel cron is configured (vercel.json crons[]) and registered
-- (project crons API confirms enabledAt + schedule), but Charlie observed
-- 96-minute gaps in api_health updates indicating Vercel's scheduler
-- wasn't reliably firing. This adds a Postgres-side scheduler that
-- POSTs to the same Vercel cron endpoints, providing a redundant
-- trigger that's visible in our own DB.
--
-- Auth uses LINDY_CALLBACK_SECRET (the existing admin-cron secret),
-- stored in app_secrets so pg_cron jobs can read it without env access.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------
-- app_secrets — server-side key/value store readable only by service_role
-- (RLS enabled with no policies = locked down to service_role inserts/reads)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- fire_vercel_cron — used by pg_cron jobs to ping our cron endpoints
-- with the bearer secret. pg_net.http_get returns immediately and
-- doesn't block the scheduler.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fire_vercel_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_secret text;
  v_origin text;
  v_request_id bigint;
BEGIN
  SELECT value INTO v_secret FROM public.app_secrets WHERE key = 'cron_bearer_secret';
  SELECT value INTO v_origin FROM public.app_secrets WHERE key = 'site_origin';

  IF v_secret IS NULL OR v_origin IS NULL THEN
    RAISE WARNING 'fire_vercel_cron: missing secret or origin in app_secrets';
    RETURN -1;
  END IF;

  SELECT net.http_get(
    url     := v_origin || p_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'User-Agent',    'pg_cron-backup/1.0'
    )
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

-- ---------------------------------------------------------------------
-- Schedule the jobs. Mirrors vercel.json crons exactly.
-- ---------------------------------------------------------------------
-- Drip-tick every 5 minutes
SELECT cron.schedule(
  'jh-drip-tick',
  '*/5 * * * *',
  $$ SELECT public.fire_vercel_cron('/api/cron/drip-tick'); $$
);

-- API health every 2 minutes
SELECT cron.schedule(
  'jh-api-health',
  '*/2 * * * *',
  $$ SELECT public.fire_vercel_cron('/api/cron/api-health'); $$
);

-- =====================================================================
-- One-time seed step (NOT in this file — populate app_secrets manually
-- via Supabase SQL editor or service-role client):
--
--   INSERT INTO public.app_secrets (key, value) VALUES
--     ('cron_bearer_secret', '<LINDY_CALLBACK_SECRET from Vercel env>'),
--     ('site_origin',        'https://www.justhail.net')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
--
-- =====================================================================
