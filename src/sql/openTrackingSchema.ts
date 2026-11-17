import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

// Stand-in for the live tables the open-tracking migrations touch (shapes read from the live
// information_schema on 2026-11-17). net.http_post records every call so a ring is counted, never assumed.
export const BASE = `
set timezone = 'UTC';
create role anon; create role authenticated; create role service_role;
create schema auth; create schema net; create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create table cron.job_run_details (runid bigserial primary key, jobid bigint, status text, return_message text,
  start_time timestamptz, end_time timestamptz);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (n, s, c)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
-- like pg_cron: unscheduling a job that does not exist is an error (round 5: the old 304 rollback failed on it live)
create function cron.unschedule(n text) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobname = n;
  if not found then raise exception 'could not find valid entry for job ''%''', n; end if;
  return true;
end $$;
create table net.calls (id bigserial primary key, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language plpgsql as $$
declare v bigint;
begin
  if current_setting('test.net_breaks', true) = '1' then raise exception 'pg_net is down'; end if;
  insert into net.calls(url, body, headers) values (url, body, headers) returning id into v;
  return v;
end $$;
create table public.integration_config (key text primary key, value text not null, updated_at timestamptz default now(), is_secret boolean not null default false);
insert into public.integration_config(key, value) values ('inbox_notify_url', 'https://example.test/inbox-notify'), ('inbox_push_secret', 's');
create table public.outreach_campaigns (id uuid primary key, client_id text, name text);
create table public.outreach_prospects (id uuid primary key, campaign_id uuid, name text, headline text, company text,
  title text, country text, icp_score int, stage text default 'dm_sent', linkedin_url text, linkedin_profile_id text,
  dm_count int default 1, blacklisted boolean default false, call_booked_at timestamptz, enrichment_data jsonb default '{}');
create table public.outreach_messages (id bigserial primary key, prospect_id uuid, direction text, channel text,
  message_type text default 'dm', sent_at timestamptz, created_at timestamptz default now(), ai_model text,
  message_text text default '', is_reaction boolean default false, unipile_message_id text, draft_evidence jsonb);
create table public.scan_opens (id bigserial primary key, company_slug text not null, opened_at timestamptz not null default now(),
  is_owner boolean not null default false, device_type text, referrer_host text, ip_hash text, user_agent text);
create table public.page_opens (id bigserial primary key, created_at timestamptz not null default now(), page text not null,
  visitor_id text, country_code text, country text, city text, org text, user_agent text, referrer text,
  is_external boolean not null default false, alerted boolean not null default false);
alter table public.scan_opens enable row level security;
alter table public.page_opens enable row level security;
`

export const MIGRATIONS = [
  'db/303_open_class.sql',
  'db/304_open_finalize_backfill.sql',
  'db/305_open_readers.sql',
  'db/306_open_evidence_cutover.sql',
  'db/307_scan_page_events.sql',
  'db/308_scan_reopen_ring.sql',
  'db/309_open_daily_check.sql',
]

// Round 5: 304 no longer carries a backfill block (the backfill is open_backfill_step, run by the release checklist),
// so every migration loads whole.
export function migration(path: string): string {
  return readFileSync(path, 'utf8')
}

export async function openDb(upTo: number, extra = ''): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(BASE + extra)
  for (const p of MIGRATIONS.slice(0, upTo)) await db.exec(migration(p))
  return db
}
