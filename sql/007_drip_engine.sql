-- =====================================================================
-- Just Hail — Phase 2: Drip orchestrator + verification cache + audit
-- =====================================================================
-- This is the heart of Hailey's outbound system.
--
-- DRIP MODEL
-- ─────────────────────────────────────────────────────────────────────
-- A "sequence" is a TEMPLATE — a reusable ordered list of touchpoints
-- (cold email day 0, follow-up email day 2, SMS day 4, voicemail day 7,
-- final email day 10). Steps are stored as a single JSONB array on the
-- sequence row so editing the template is one update.
--
-- A "drip_campaign" is an INSTANCE of a sequence applied to a lead set
-- (typically all leads from one polygon-source campaign). Multiple drip
-- campaigns can run on the same sequence template, and one polygon
-- campaign can have multiple drip campaigns over time.
--
-- "drip_lead_state" tracks each lead's position. Cron processor scans
-- this table every 5 min for due actions.
--
-- "drip_touches" is the full audit log of every send, opened, clicked,
-- replied, bounced, opted-out — joined to a lead and a step.
--
-- VERIFICATION CACHE
-- ─────────────────────────────────────────────────────────────────────
-- Bouncer email verifications and Twilio Lookup phone validations are
-- expensive. We cache results for 60 days (email) and 30 days (phone)
-- so we don't re-pay for the same lookup. DNC checks have their own
-- 7-day TTL because federal DNC list updates daily and the safety
-- margin matters more than the cost.
--
-- API HEALTH
-- ─────────────────────────────────────────────────────────────────────
-- Each integration's last successful ping + latency lands here so the
-- admin's API Health strip can render it live without round-tripping
-- to every external service on each page load.
--
-- CONSENT LOG
-- ─────────────────────────────────────────────────────────────────────
-- TCPA defense-in-depth. Every SMS opt-in (form submission with
-- smsConsent=true) and every opt-out (STOP/UNSUB/etc.) lands here as
-- an immutable audit entry with timestamp + source + verbatim text of
-- the consent disclosure that was shown.
-- =====================================================================

-- ---------------------------------------------------------------------
-- drip_sequences — reusable touch templates
-- ---------------------------------------------------------------------
create table if not exists public.drip_sequences (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),

  name              text         not null,
  description       text,
  is_default        boolean      not null default false,    -- the Defcon-1 template
  is_archived       boolean      not null default false,

  -- The full step list as ordered JSON. Each step is:
  --   {
  --     "step_number":   1,
  --     "delay_hours":   0,                       // hours after previous step (or after enrollment for step 1)
  --     "channel":       "email"|"sms"|"voicemail"|"call",
  --     "template_key":  "defcon_step1",          // references templated content (held outside DB for editability)
  --     "subject":       "Saw your block took hail Friday",   // email only
  --     "body":          "<the full body>",       // can use {{first_name}} {{street}} {{city}}
  --     "smartlead_seq": null,                    // optional: pre-built Smartlead sequence ID
  --     "conditions":    { "min_engagement_score": 0 },       // optional gating
  --     "branches":      [                         // optional: jump to different step on event
  --       { "on_event": "email_clicked", "jump_to_step": 99 }
  --     ],
  --     "skip_if": ["opted_out", "bounced_hard", "do_not_contact"]
  --   }
  steps             jsonb        not null,

  -- Total length in days (computed at write time for fast queries)
  total_days        int,

  -- Sender pool — which mailboxes/Twilio numbers to draw from
  -- {
  --   "email_mailboxes": ["smartlead_default"|specific mailbox IDs],
  --   "sms_from":        "+18449360116",
  --   "voice_from":      "+17372411656"
  -- }
  sender_pool       jsonb        not null default '{}'::jsonb,

  metadata          jsonb        not null default '{}'::jsonb
);

create index if not exists drip_sequences_default_idx on public.drip_sequences (is_default) where is_default = true;
create index if not exists drip_sequences_archived_idx on public.drip_sequences (is_archived);

drop trigger if exists drip_sequences_touch_updated_at on public.drip_sequences;
create trigger drip_sequences_touch_updated_at
  before update on public.drip_sequences
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- drip_campaigns — running INSTANCES of a sequence on a lead set
-- ---------------------------------------------------------------------
create table if not exists public.drip_campaigns (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),

  name              text         not null,                  -- "Round Rock Apr-26 Defcon-1"
  sequence_id       bigint       not null references public.drip_sequences(id) on delete restrict,
  source_campaign_id bigint      references public.campaigns(id) on delete set null,  -- the polygon source
  storm_event_id    bigint       references public.storm_events(id) on delete set null,

  status            text         not null default 'draft',
  -- draft | enrolling | active | paused | completed | aborted

  -- Lifecycle timestamps
  enrollment_started_at timestamptz,
  launched_at           timestamptz,
  paused_at             timestamptz,
  completed_at          timestamptz,

  -- Counters (denormalized for fast UI; cron updates them)
  total_leads          int       not null default 0,
  active_leads         int       not null default 0,
  completed_leads      int       not null default 0,
  opted_out_leads      int       not null default 0,
  bounced_leads        int       not null default 0,
  hot_leads            int       not null default 0,        -- replied / engaged

  -- Reach metrics (denormalized counts of drip_touches)
  emails_sent          int       not null default 0,
  emails_opened        int       not null default 0,
  emails_clicked       int       not null default 0,
  emails_replied       int       not null default 0,
  emails_bounced       int       not null default 0,
  sms_sent             int       not null default 0,
  sms_delivered        int       not null default 0,
  sms_replied          int       not null default 0,
  voicemails_dropped   int       not null default 0,
  calls_made           int       not null default 0,

  -- Configurable: caps to prevent runaway sends
  max_daily_dispatches int       not null default 500,

  -- Triggered_by + audit
  triggered_by      text         not null default 'admin_ui',  -- admin_ui | hailey | api | cron
  triggered_by_user text,

  metadata          jsonb        not null default '{}'::jsonb
);

create index if not exists drip_campaigns_status_idx on public.drip_campaigns (status);
create index if not exists drip_campaigns_source_idx on public.drip_campaigns (source_campaign_id);
create index if not exists drip_campaigns_created_idx on public.drip_campaigns (created_at desc);

drop trigger if exists drip_campaigns_touch_updated_at on public.drip_campaigns;
create trigger drip_campaigns_touch_updated_at
  before update on public.drip_campaigns
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- drip_lead_state — per-lead position in a drip campaign
-- ---------------------------------------------------------------------
create table if not exists public.drip_lead_state (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),

  drip_campaign_id  bigint not null references public.drip_campaigns(id) on delete cascade,
  lead_id           bigint not null references public.leads(id) on delete cascade,

  current_step      int          not null default 0,        -- 0 = enrolled but no step run yet
  next_step         int          not null default 1,        -- the step to run NEXT
  scheduled_at      timestamptz,                            -- when next_step should fire (NULL = not scheduled)

  status            text         not null default 'active',
  -- active | paused | completed | opted_out | bounced_out | failed

  enrolled_at       timestamptz  not null default now(),
  last_action_at    timestamptz,
  completed_at      timestamptz,
  opted_out_at      timestamptz,

  -- Engagement signals (denormalized for fast cohort queries)
  total_emails_opened   int      not null default 0,
  total_emails_clicked  int      not null default 0,
  total_replies         int      not null default 0,
  engagement_score      int      not null default 0,        -- 0-100, derived from above
  hot_lead              boolean  not null default false,

  -- Failure tracking
  last_failure          text,                                -- error message if status='failed'
  failure_count         int      not null default 0,

  metadata          jsonb        not null default '{}'::jsonb
);

create unique index if not exists drip_lead_state_unique_idx
  on public.drip_lead_state (drip_campaign_id, lead_id);
create index if not exists drip_lead_state_due_idx
  on public.drip_lead_state (scheduled_at)
  where status = 'active' and scheduled_at is not null;
create index if not exists drip_lead_state_status_idx on public.drip_lead_state (status);
create index if not exists drip_lead_state_hot_idx on public.drip_lead_state (hot_lead) where hot_lead = true;
create index if not exists drip_lead_state_lead_idx on public.drip_lead_state (lead_id);

drop trigger if exists drip_lead_state_touch_updated_at on public.drip_lead_state;
create trigger drip_lead_state_touch_updated_at
  before update on public.drip_lead_state
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- drip_touches — every actual send + every engagement event
-- ---------------------------------------------------------------------
-- One row per: send-attempt, delivery, open, click, reply, bounce, opt-out.
-- For sends, status starts at 'queued' and moves through 'sent' →
-- 'delivered' → 'opened'/'clicked'/'replied'. For events from webhooks,
-- a NEW row is inserted (so we have full timeline).
-- ---------------------------------------------------------------------
create table if not exists public.drip_touches (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),

  drip_campaign_id  bigint not null references public.drip_campaigns(id) on delete cascade,
  lead_id           bigint not null references public.leads(id) on delete cascade,
  drip_lead_state_id bigint references public.drip_lead_state(id) on delete cascade,

  step_number       int,                                    -- which step in the sequence
  channel           text         not null,
  -- email | sms | voicemail | call

  event_type        text         not null,
  -- send_attempt | sent | delivered | failed | bounced |
  -- opened | clicked | replied | opt_out | undeliverable

  -- Content actually sent (for audit + debugging)
  subject           text,                                   -- email only
  body              text,
  recipient         text         not null,                  -- the email or phone we sent to
  sender            text,                                   -- the from email or phone we used

  -- Provider integration
  provider          text,                                   -- smartlead | twilio | resend
  provider_message_id text,                                 -- their ID for this message
  provider_response jsonb,                                  -- raw response (for debugging)

  -- For events: link back to the original send if known
  parent_touch_id   bigint references public.drip_touches(id) on delete set null,

  -- Engagement-event metadata
  link_clicked      text,                                   -- URL if event_type='clicked'
  reply_body        text,                                   -- if event_type='replied'

  -- Failure detail
  error_message     text,
  retry_count       int          not null default 0,

  metadata          jsonb        not null default '{}'::jsonb
);

create index if not exists drip_touches_campaign_idx on public.drip_touches (drip_campaign_id, created_at desc);
create index if not exists drip_touches_lead_idx on public.drip_touches (lead_id, created_at desc);
create index if not exists drip_touches_state_idx on public.drip_touches (drip_lead_state_id, created_at desc);
create index if not exists drip_touches_event_type_idx on public.drip_touches (event_type);
create index if not exists drip_touches_provider_msgid_idx on public.drip_touches (provider, provider_message_id);
create index if not exists drip_touches_channel_event_idx on public.drip_touches (channel, event_type);

-- ---------------------------------------------------------------------
-- verification_cache — Bouncer email + Twilio Lookup phone results
-- ---------------------------------------------------------------------
-- One row per (kind, normalized_value). TTL enforced at read time:
-- callers check `expires_at > now()` before trusting the cached row.
-- ---------------------------------------------------------------------
create table if not exists public.verification_cache (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),

  kind              text         not null,                  -- email | phone | dnc
  normalized_value  text         not null,                  -- lowercase email or E.164 phone
  expires_at        timestamptz  not null,

  -- Result, normalized across providers
  is_valid          boolean,                                 -- broad: usable for outbound?
  status            text,                                    -- deliverable | risky | undeliverable | mobile | landline | voip | dnc_clear | dnc_blocked
  score             int,                                     -- provider-specific 0-100 quality
  toxicity          int,                                     -- Bouncer toxicity 0-5 (email only)
  line_type         text,                                    -- mobile | landline | voip | nonFixedVoip (phone only)
  carrier           text,
  fraud_score       int,                                     -- IPQS-style 0-100 (when available)

  -- DNC specifics
  dnc_federal       boolean,
  dnc_state         boolean,
  dnc_state_name    text,                                    -- e.g. 'TX'
  dnc_litigator     boolean,
  dnc_dma_tps       boolean,

  provider          text         not null,                   -- bouncer | twilio_lookup | realphonevalidation
  raw_response      jsonb        not null
);

create unique index if not exists verification_cache_unique_idx
  on public.verification_cache (kind, normalized_value);
create index if not exists verification_cache_expires_idx
  on public.verification_cache (expires_at);

drop trigger if exists verification_cache_touch_updated_at on public.verification_cache;
create trigger verification_cache_touch_updated_at
  before update on public.verification_cache
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- api_health — last successful ping + latency per integration
-- ---------------------------------------------------------------------
create table if not exists public.api_health (
  id                bigint generated always as identity primary key,
  service           text         not null,                  -- smartlead | twilio | resend | bouncer | posthog | ...
  checked_at        timestamptz  not null default now(),
  ok                boolean      not null,
  status_code       int,
  latency_ms        int,
  error_message     text,
  consecutive_fails int          not null default 0,
  notes             text
);

create unique index if not exists api_health_service_unique_idx on public.api_health (service);
create index if not exists api_health_checked_at_idx on public.api_health (checked_at desc);
create index if not exists api_health_ok_idx on public.api_health (ok);

-- ---------------------------------------------------------------------
-- consent_log — TCPA defense-in-depth audit trail
-- ---------------------------------------------------------------------
create table if not exists public.consent_log (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),

  lead_id           bigint references public.leads(id) on delete set null,
  channel           text         not null,                  -- sms | email | call | all
  action            text         not null,
  -- opt_in | opt_out | reaffirm | revoke

  -- Source of the consent action
  source            text         not null,
  -- web_form | sms_reply | manual_admin | imported | api

  -- Verbatim disclosure text shown at opt-in (or the opt-out keyword received)
  disclosure_text   text,
  consent_version   text,                                   -- version string (e.g. "2026-04-26")

  -- Forensic identifiers
  ip_address        inet,
  user_agent        text,
  source_url        text,                                   -- URL where the form was submitted
  reference_number  text,                                   -- form's JH-XXXXXX ref

  -- For SMS opt-out: the verbatim message that triggered it
  trigger_message   text,
  trigger_message_sid text,                                 -- Twilio MessageSID

  raw_payload       jsonb        not null default '{}'::jsonb
);

create index if not exists consent_log_lead_idx on public.consent_log (lead_id);
create index if not exists consent_log_channel_action_idx on public.consent_log (channel, action);
create index if not exists consent_log_created_idx on public.consent_log (created_at desc);

-- ---------------------------------------------------------------------
-- documents — parsed estimates / files Hailey ingested
-- ---------------------------------------------------------------------
-- Drag-drop in chat → Claude vision parses → file lands in Drive →
-- structured data lands in this table → Sheet line-items are appended.
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),

  kind              text         not null,                  -- insurance_estimate | invoice | photo | other
  source            text         not null default 'admin_chat',  -- admin_chat | email | api

  -- Ties
  lead_id           bigint references public.leads(id) on delete set null,
  drip_campaign_id  bigint references public.drip_campaigns(id) on delete set null,

  -- File location
  filename          text,
  mime_type         text,
  size_bytes        int,
  drive_file_id     text,                                   -- Google Drive ID
  drive_folder_id   text,
  drive_url         text,                                   -- shareable link

  -- Parsed payload from Claude vision
  parsed_data       jsonb,                                  -- structured insurance estimate fields
  parsed_text       text,                                   -- raw extracted text
  total_amount      numeric(12, 2),
  carrier_name      text,
  claim_number      text,
  vehicle_year      int,
  vehicle_make      text,
  vehicle_model     text,

  -- Sheet sync
  sheet_synced_at   timestamptz,
  sheet_row_id      text,

  -- QuickBooks (when wired)
  qb_invoice_id     text,
  qb_synced_at      timestamptz,

  metadata          jsonb        not null default '{}'::jsonb
);

create index if not exists documents_kind_idx on public.documents (kind);
create index if not exists documents_lead_idx on public.documents (lead_id);
create index if not exists documents_created_idx on public.documents (created_at desc);

-- ---------------------------------------------------------------------
-- RLS — service_role only (same pattern as other tables)
-- ---------------------------------------------------------------------
alter table public.drip_sequences      enable row level security;
alter table public.drip_campaigns      enable row level security;
alter table public.drip_lead_state     enable row level security;
alter table public.drip_touches        enable row level security;
alter table public.verification_cache  enable row level security;
alter table public.api_health          enable row level security;
alter table public.consent_log         enable row level security;
alter table public.documents           enable row level security;
