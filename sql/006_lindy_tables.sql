-- =====================================================================
-- Just Hail — Phase 1 Lindy.ai integration tables
-- =====================================================================
-- Adds the four tables that back the 8-agent Lindy system:
--
--   call_logs           — every inbound + outbound voice call (Lindy or
--                         human transferred). One row per call leg.
--   sms_messages        — every SMS in/out. Threads grouped by phone +
--                         lead_id. Free-form direction marker.
--   lindy_jobs          — dispatch audit log: every webhook we POST to
--                         Lindy and the corresponding callback we got.
--   enrichment_results  — jh-enricher output, one row per lead/run.
--
-- Apply: Supabase → SQL Editor → paste → Run.
-- Idempotent (safe to re-run).
-- =====================================================================

-- ---------------------------------------------------------------------
-- call_logs — voice call records (inbound receptionist + outbound caller)
-- ---------------------------------------------------------------------
-- Source values:
--   'lindy_inbound'       — jh-receptionist answered an incoming call
--   'lindy_outbound'      — jh-outbound-caller dialed a lead
--   'lindy_voicemail'     — jh-voicemail-dropper left a VM
--   'lindy_recap'         — jh-recap-caller called Charlie
--   'human_transfer'      — receptionist transferred to (512) 221-3013
-- ---------------------------------------------------------------------
create table if not exists public.call_logs (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),

  source            text         not null,
  -- lindy_inbound | lindy_outbound | lindy_voicemail | lindy_recap | human_transfer

  agent_name        text,
  -- jh-receptionist | jh-outbound-caller | jh-voicemail-dropper | jh-recap-caller

  lead_id           bigint references public.leads(id) on delete set null,
  campaign_id       bigint references public.campaigns(id) on delete set null,

  -- twilio identifiers
  twilio_call_sid   text,
  from_number       text,
  to_number         text,
  duration_seconds  int,

  -- timing
  started_at        timestamptz,
  ended_at          timestamptz,

  -- outcome (free-form, depends on agent)
  -- inbound:    answered_qualified, answered_cold, voicemail, transferred, missed
  -- outbound:   answered_hot, answered_warm, answered_cold, answered_optout,
  --             voicemail_left, no_answer, bad_number, deferred_quiet_hours
  -- voicemail:  delivered, failed, opt_out_blocked, quiet_hours
  -- recap:      delivered, no_answer
  outcome           text,

  hot_lead_flag     boolean      not null default false,
  opt_out_flag      boolean      not null default false,
  booked_inspection boolean      not null default false,
  booked_slot_at    timestamptz,

  summary           text,
  transcript        jsonb,
  -- [{ "role": "lindy"|"caller"|"system", "text": "...", "ts": "..." }, ...]

  recording_url     text,
  raw_payload       jsonb        not null default '{}'::jsonb
);

create index if not exists call_logs_created_at_idx  on public.call_logs (created_at desc);
create index if not exists call_logs_lead_id_idx     on public.call_logs (lead_id);
create index if not exists call_logs_campaign_idx    on public.call_logs (campaign_id);
create index if not exists call_logs_source_idx      on public.call_logs (source);
create index if not exists call_logs_outcome_idx     on public.call_logs (outcome);
create index if not exists call_logs_hot_lead_idx    on public.call_logs (hot_lead_flag) where hot_lead_flag = true;
create index if not exists call_logs_twilio_sid_idx  on public.call_logs (twilio_call_sid);

-- ---------------------------------------------------------------------
-- sms_messages — every inbound + outbound SMS, threaded by lead/phone
-- ---------------------------------------------------------------------
-- The same Twilio number is used for everyone, so threads are grouped
-- by counterparty phone (`peer_number`). lead_id is set when we resolve
-- which lead the peer belongs to (might be NULL on cold inbound until
-- the SMS handler matches).
-- ---------------------------------------------------------------------
create table if not exists public.sms_messages (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),

  direction         text         not null,
  -- inbound | outbound

  source            text         not null default 'lindy',
  -- lindy | manual_admin | system

  agent_name        text,
  -- jh-sms-handler | jh-storm-broadcaster | NULL when manual_admin

  lead_id           bigint references public.leads(id) on delete set null,
  campaign_id       bigint references public.campaigns(id) on delete set null,
  draft_id          bigint references public.lead_outreach_drafts(id) on delete set null,

  peer_number       text         not null,   -- the lead's phone
  our_number        text,                    -- which Twilio number we used (future multi-line)

  body              text         not null,

  -- twilio identifiers + status
  twilio_message_sid  text,
  status              text,
  -- queued | sent | delivered | failed | undelivered | received

  classification     text,
  -- HOT | WARM | QUESTION | AUTO_REPLY | OPT_OUT | WRONG_PERSON
  -- (set by jh-reply-classifier on inbound replies)

  hot_lead_flag      boolean     not null default false,
  opt_out_flag       boolean     not null default false,

  raw_payload        jsonb       not null default '{}'::jsonb
);

create index if not exists sms_messages_created_at_idx on public.sms_messages (created_at desc);
create index if not exists sms_messages_lead_id_idx    on public.sms_messages (lead_id);
create index if not exists sms_messages_peer_idx       on public.sms_messages (peer_number);
create index if not exists sms_messages_direction_idx  on public.sms_messages (direction);
create index if not exists sms_messages_classification_idx on public.sms_messages (classification);
create index if not exists sms_messages_hot_idx        on public.sms_messages (hot_lead_flag) where hot_lead_flag = true;
create index if not exists sms_messages_twilio_sid_idx on public.sms_messages (twilio_message_sid);

-- ---------------------------------------------------------------------
-- lindy_jobs — every dispatch we POST to a Lindy agent webhook
-- ---------------------------------------------------------------------
-- Audit log of EVERY outbound call we make to Lindy. Lets us:
--   - Replay if a callback was lost
--   - Diagnose why an agent didn't fire
--   - Track which agent handled which lead, when, with what context
-- A row goes from status='queued' → 'dispatched' (when we successfully
-- HTTP POST to Lindy) → 'callback_received' (when Lindy POSTs back) or
-- 'failed' / 'timed_out'.
-- ---------------------------------------------------------------------
create table if not exists public.lindy_jobs (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),

  -- which Lindy agent we dispatched to
  agent_name        text         not null,
  -- jh-outbound-caller | jh-voicemail-dropper | jh-reply-classifier
  -- jh-enricher | jh-storm-broadcaster | jh-recap-caller

  -- what triggered this dispatch
  triggered_by      text         not null default 'admin_ui',
  -- admin_ui | strategist | cron | webhook | api

  triggered_by_user text,        -- email of the person if admin_ui

  -- subject of the job
  lead_id           bigint references public.leads(id) on delete set null,
  campaign_id       bigint references public.campaigns(id) on delete set null,
  storm_event_id    bigint references public.storm_events(id) on delete set null,

  -- what we sent
  request_url       text         not null,
  request_payload   jsonb        not null,

  -- lifecycle
  status            text         not null default 'queued',
  -- queued | dispatched | callback_received | failed | timed_out

  dispatched_at     timestamptz,
  http_status       int,
  http_response     text,                            -- body of Lindy's response to our POST

  callback_received_at  timestamptz,
  callback_payload      jsonb,                       -- what Lindy POSTs back

  error_message     text,

  -- for child-job tracing (storm-broadcaster fans out to N caller jobs)
  parent_job_id     bigint references public.lindy_jobs(id) on delete set null,

  metadata          jsonb        not null default '{}'::jsonb
);

create index if not exists lindy_jobs_created_at_idx on public.lindy_jobs (created_at desc);
create index if not exists lindy_jobs_agent_idx      on public.lindy_jobs (agent_name);
create index if not exists lindy_jobs_lead_id_idx    on public.lindy_jobs (lead_id);
create index if not exists lindy_jobs_campaign_idx   on public.lindy_jobs (campaign_id);
create index if not exists lindy_jobs_status_idx     on public.lindy_jobs (status);
create index if not exists lindy_jobs_parent_idx     on public.lindy_jobs (parent_job_id);

drop trigger if exists lindy_jobs_touch_updated_at on public.lindy_jobs;
create trigger lindy_jobs_touch_updated_at
  before update on public.lindy_jobs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- enrichment_results — output from jh-enricher, one row per lead/run
-- ---------------------------------------------------------------------
create table if not exists public.enrichment_results (
  id                bigint generated always as identity primary key,
  created_at        timestamptz  not null default now(),

  lead_id           bigint not null references public.leads(id) on delete cascade,
  lindy_job_id      bigint references public.lindy_jobs(id) on delete set null,

  -- public-records property data
  appraisal_owner       text,
  appraisal_value       int,
  appraisal_year_built  int,
  appraisal_square_feet int,
  appraisal_raw         jsonb,

  -- social / news signals (arrays from the agent)
  social_signals    jsonb,
  -- [{ platform, url, snippet, posted_at }, ...]

  news_signals      jsonb,
  -- [{ url, headline, date }, ...]

  -- HOA association (helpful for cluster outreach)
  hoa_name          text,

  -- one-paragraph summary the agent generated for Charlie
  enrichment_summary  text,

  raw_payload       jsonb        not null default '{}'::jsonb
);

create index if not exists enrichment_lead_idx     on public.enrichment_results (lead_id);
create index if not exists enrichment_created_idx  on public.enrichment_results (created_at desc);
create index if not exists enrichment_hoa_idx      on public.enrichment_results (hoa_name);

-- ---------------------------------------------------------------------
-- RLS — service_role only, same pattern as other tables
-- ---------------------------------------------------------------------
alter table public.call_logs           enable row level security;
alter table public.sms_messages        enable row level security;
alter table public.lindy_jobs          enable row level security;
alter table public.enrichment_results  enable row level security;
