-- =====================================================================
-- Just Hail — Phase 2: storm campaigns
-- =====================================================================
-- Adds campaigns (a unit of coordinated outreach) and links leads to
-- them. A campaign is born from a storm signal + geographic target.
-- =====================================================================
-- Apply: Supabase → SQL Editor → paste → Run (idempotent)
-- =====================================================================

-- ---------------------------------------------------------------------
-- campaigns — a storm-targeted outreach batch
-- ---------------------------------------------------------------------
create table if not exists public.campaigns (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),

  name              text         not null,
  status            text         not null default 'draft',
  -- draft | enriching | ready | outreach_queued | outreach_in_progress | done | canceled

  -- how we targeted
  target_type       text         not null,
  -- zip | polygon | radius | address_list

  target_input      jsonb        not null,
  -- zip:          { "zip": "78641" }
  -- polygon:      { "polygon": [[lat,lng], ...] }  (GeoJSON-style, lng-lat OR lat-lng; we canonicalize server-side)
  -- radius:       { "lat": 30.5788, "lng": -97.8531, "radius_miles": 5 }
  -- address_list: { "addresses": [...] }

  -- optional link back to storm event that spawned this
  storm_event_id    bigint references public.storm_events(id) on delete set null,

  -- BatchData enrichment stats
  enrichment_started_at   timestamptz,
  enrichment_finished_at  timestamptz,
  property_hits           int,
  contact_hits            int,
  estimated_cost_usd      numeric(8,2),

  metadata          jsonb        not null default '{}'::jsonb
);

create index if not exists campaigns_status_idx on public.campaigns (status);
create index if not exists campaigns_created_at_idx on public.campaigns (created_at desc);

-- Auto-update updated_at
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end
$$ language plpgsql;

drop trigger if exists campaigns_touch_updated_at on public.campaigns;
create trigger campaigns_touch_updated_at
  before update on public.campaigns
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- leads ← campaign_id (already existed without this)
-- ---------------------------------------------------------------------
-- Add campaign_id to leads so we can query leads by campaign cheaply.
-- ---------------------------------------------------------------------
alter table public.leads add column if not exists campaign_id bigint references public.campaigns(id) on delete set null;
create index if not exists leads_campaign_id_idx on public.leads (campaign_id);

-- ---------------------------------------------------------------------
-- lead_outreach_drafts — Claude-generated personalized copy per channel
-- ---------------------------------------------------------------------
-- For Phase 2b / Phase 3. Pre-scaffolded.
-- ---------------------------------------------------------------------
create table if not exists public.lead_outreach_drafts (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),

  lead_id           bigint not null references public.leads(id) on delete cascade,
  campaign_id       bigint references public.campaigns(id) on delete set null,
  channel           text  not null,   -- sms | email | rvm | voice
  subject           text,             -- email only
  body              text  not null,
  model             text,             -- claude-opus-4-7 etc.
  approved          boolean not null default false,
  sent_at           timestamptz,
  sent_status       text,             -- queued | delivered | failed
  sent_provider_id  text              -- Twilio SID, SendGrid message-id, GHL id, etc.
);

create index if not exists drafts_lead_idx on public.lead_outreach_drafts (lead_id);
create index if not exists drafts_campaign_idx on public.lead_outreach_drafts (campaign_id);
create index if not exists drafts_approved_idx on public.lead_outreach_drafts (approved);

-- RLS
alter table public.campaigns              enable row level security;
alter table public.lead_outreach_drafts   enable row level security;
