-- =====================================================================
-- Just Hail — Command Center base schema
-- Phase 1: storm events + webhook delivery log + enriched leads
-- =====================================================================
-- To apply: open Supabase dashboard → SQL Editor → paste → Run
-- Idempotent: safe to re-run if you add tables or columns later.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- storm_events — every IHM webhook that lands on /api/ihm-webhook
-- ---------------------------------------------------------------------
-- Captures monitoring_alert, marker_status_changed, and hail_alert
-- payloads. Flat columns for the fields we'll query/filter on; the
-- full payload is preserved in `raw` for anything else.
-- ---------------------------------------------------------------------
create table if not exists public.storm_events (
  id                bigint generated always as identity primary key,
  received_at       timestamptz  not null default now(),
  event_type        text         not null,            -- monitoring_alert | marker_status_changed | hail_alert
  ihm_webhook_type  text,                             -- the AgentWebhookType key (from /AgentApi/WebhookTypes)
  alert_category    text,                             -- HAIL_DETECTED, HAIL_SPOTTED, etc. (hail_alert only)

  -- common address fields (when present on payload)
  recon_marker_id   bigint,
  customer_name     text,
  customer_phone    text,
  customer_mobile   text,
  customer_email    text,
  street            text,
  city              text,
  state             text,
  zip               text,
  lat               numeric(10,7),
  lng               numeric(10,7),

  -- monitoring_alert specifics
  swath_size_in     numeric(4,2),
  level_detected    int,
  file_date         timestamptz,
  detected_at       timestamptz,

  -- marker_status_changed specifics
  marker_status     text,
  status_source     text,         -- 'SAT' (web) | 'APP' (mobile)
  status_change_at  timestamptz,

  -- cross-system link (IHM AddMarker external_key = SalesRabbit lead ID)
  external_key      text,

  raw               jsonb        not null
);

create index if not exists storm_events_received_at_idx on public.storm_events (received_at desc);
create index if not exists storm_events_event_type_idx  on public.storm_events (event_type);
create index if not exists storm_events_zip_idx         on public.storm_events (zip);
create index if not exists storm_events_external_key_idx on public.storm_events (external_key);

-- ---------------------------------------------------------------------
-- webhook_deliveries — raw delivery log for debugging / signature audit
-- ---------------------------------------------------------------------
-- Every inbound hit on /api/ihm-webhook writes one row here BEFORE we
-- try to verify / parse it. If signature verification fails, we keep
-- the row but set signature_valid = false. This is our paper trail.
-- ---------------------------------------------------------------------
create table if not exists public.webhook_deliveries (
  id                bigint generated always as identity primary key,
  received_at       timestamptz  not null default now(),
  source            text         not null,            -- 'ihm' | future: 'ghl', 'salesrabbit'
  signature_header  text,
  signature_valid   boolean,
  http_method       text,
  path              text,
  headers           jsonb,
  body              text,                             -- raw body as received (for forensic HMAC recomputation)
  parsed            jsonb,                            -- parsed JSON if successful
  storm_event_id    bigint references public.storm_events(id) on delete set null,
  notes             text
);

create index if not exists webhook_deliveries_received_at_idx on public.webhook_deliveries (received_at desc);
create index if not exists webhook_deliveries_source_idx on public.webhook_deliveries (source);
create index if not exists webhook_deliveries_signature_valid_idx on public.webhook_deliveries (signature_valid);

-- ---------------------------------------------------------------------
-- leads — enriched prospects (future Phase 2+)
-- ---------------------------------------------------------------------
-- Populated by:
--   (a) BatchData polygon-search + skip-trace (cold prospects)
--   (b) Charlie's IHM pins (warm — Workflow A)
--   (c) SalesRabbit sign-ups (hot — Workflow C)
-- external_key ties back to SalesRabbit / IHM for idempotent upserts.
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),

  source            text         not null,            -- 'batchdata' | 'ihm_pin' | 'salesrabbit' | 'website_form'
  external_key      text,                             -- source-system ID (unique per source)
  source_system_id  text,                             -- redundant human-friendly id

  -- identity
  first_name        text,
  last_name         text,
  email             text,
  phone             text,
  mobile            text,

  -- address
  street            text,
  city              text,
  state             text,
  zip               text,
  lat               numeric(10,7),
  lng               numeric(10,7),

  -- property signals (BatchData)
  estimated_home_value  int,
  year_built            int,
  bedroom_count         int,
  bathroom_count        numeric(3,1),
  square_feet           int,
  vehicle_estimate      jsonb,                        -- placeholder for future vehicle lookup

  -- campaign / qualification state
  status            text         not null default 'new',  -- new | contacted | engaged | qualified | booked | signed | closed_lost | do_not_contact
  opted_out         boolean      not null default false,
  last_touched_at   timestamptz,
  last_channel      text,

  -- ties
  ihm_marker_id     bigint,
  salesrabbit_id    text,
  ghl_contact_id    text,

  metadata          jsonb        not null default '{}'::jsonb
);

create unique index if not exists leads_source_external_key_idx on public.leads (source, external_key) where external_key is not null;
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_zip_idx on public.leads (zip);
create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
-- All tables RLS-enabled with NO policies → client-side anon key cannot
-- read/write. Server-side service_role key bypasses RLS. Our API routes
-- use service_role; admin.html calls our APIs, never hits Supabase
-- directly. If you later want direct client access, add policies.
-- ---------------------------------------------------------------------
alter table public.storm_events        enable row level security;
alter table public.webhook_deliveries  enable row level security;
alter table public.leads               enable row level security;
