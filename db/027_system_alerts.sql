-- 027: system_alerts + zernio_token_state (2026-08-05)
--
-- WHY A NEW TABLE. n8nclaw_proactive_alerts already exists, but nothing in the
-- shipped app renders a FRESH row from it: useAgentDigest reads only the
-- `olderUnsent` count (rows older than the 14-day window) and prints it as a
-- footnote inside the collapsed Content alert strip, worded "historical, not
-- actionable here" (ContentList.tsx:566). Writing a token-expiry warning there
-- would be invisible for 14 days and then labelled history. ops_drafts is worse:
-- approving one POSTS IT TO A CLIENT SLACK CHANNEL.
--
-- system_alerts is the operator-facing lane the app was missing: infrastructure
-- facts with a deadline, rendered at the top of Today, dismissed in place,
-- nothing dispatched anywhere on approve.

create table if not exists system_alerts (
  id uuid primary key default gen_random_uuid(),
  source text not null,                       -- 'zernio_token_watch'
  -- One row per (thing, threshold). The writer inserts with
  -- Prefer: resolution=ignore-duplicates, so a daily poll that re-derives the
  -- same tier is a no-op instead of a second identical row.
  dedupe_key text not null unique,
  severity text not null default 'warn' check (severity in ('info', 'warn', 'critical')),
  title text not null,
  body text,
  -- Where the fix happens. For a dead OAuth grant that is the connect link.
  action_url text,
  action_label text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

-- The only query the app runs: open rows, newest first.
create index if not exists system_alerts_open_idx
  on system_alerts (created_at desc) where resolved_at is null;

alter table system_alerts enable row level security;

drop policy if exists "authenticated all system_alerts" on system_alerts;
create policy "authenticated all system_alerts" on system_alerts
  for all to authenticated using (true) with check (true);

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'system_alerts'
  ) then
    alter publication supabase_realtime add table system_alerts;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- zernio_token_state — the watcher's memory.
--
-- Two jobs. (1) Fire each threshold ONCE: last_tier is the smallest threshold
-- already alerted on, and a run only alerts when it can go strictly lower.
-- (2) Answer the open question from 2026-08-04 — Zernio CLAIMS it runs the
-- 60-day refresh cycle server-side and we have never watched it do so. Every
-- run records tokenExpiresAt; when it moves forward, that is the refresh
-- happening, and refresh_count is the evidence. Zero after ~46 days means the
-- claim is false and the connect link has to be re-sent by hand.

create table if not exists zernio_token_state (
  account_id text primary key,
  username text,
  profile_id text,
  platform text,
  token_expires_at timestamptz,
  -- The value on the row the first time we ever saw this account. Never updated,
  -- so "has it ever refreshed" survives any number of refreshes.
  first_seen_expires_at timestamptz,
  last_refresh_seen_at timestamptz,
  refresh_count integer not null default 0,
  -- Smallest days-remaining threshold already alerted on (15 | 10 | 5 | 3).
  -- Reset to NULL when a refresh is observed, so the next 60-day cycle re-arms.
  last_tier integer,
  -- Separate from the countdown: a revoked/expired grant is a 0-day event and
  -- must not be swallowed by "we already sent the 3-day one".
  disconnected_alerted_at timestamptz,
  last_status text,
  checked_at timestamptz
);

alter table zernio_token_state enable row level security;

drop policy if exists "authenticated all zernio_token_state" on zernio_token_state;
create policy "authenticated all zernio_token_state" on zernio_token_state
  for all to authenticated using (true) with check (true);
