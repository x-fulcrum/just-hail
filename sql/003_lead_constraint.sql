-- Fix: the partial unique index on leads(source, external_key) can't be used
-- as an ON CONFLICT target. Convert to a proper unique constraint.
-- NULLs in PostgreSQL are treated as distinct in UNIQUE constraints by default,
-- so multiple leads with same source but NULL external_key are still allowed.
--
-- Apply: Supabase → SQL Editor → paste → Run.

drop index if exists public.leads_source_external_key_idx;

alter table public.leads
  drop constraint if exists leads_source_external_key_key;

alter table public.leads
  add constraint leads_source_external_key_key unique (source, external_key);
