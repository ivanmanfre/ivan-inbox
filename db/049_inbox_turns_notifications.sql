-- db/049 — persisted Claude turns + one notification feed for the inbox PWA.
-- Goal run inbox-brain-app-2026-09-04. NEW OBJECTS ONLY: three tables, three
-- views, RLS, grants. Touches no existing table, view, policy or publication.
--
-- Apply via the Management API (POST /v1/projects/<ref>/database/query with a
-- User-Agent header; Cloudflare 403s code 1010 without one). Never re-paste
-- older migrations.
--
-- Read model for the browser = the *_v views (security_invoker = on, the
-- inbox_sends_v idiom) so RLS on the base table is what decides visibility.
-- Write model for the browser = three narrow paths only:
--   inbox_turns.status -> 'aborted' on the user's own turn
--   inbox_notifications.read_at / dismissed_at
-- Everything else is written by edge functions with the service role.

-- ---------------------------------------------------------------------------
-- threads: one CLI session per thread. session_id is minted by the broker at
-- thread creation so the FIRST turn can already run `--session-id <id>` and
-- every later turn `--resume <id>`.
-- ---------------------------------------------------------------------------
create table if not exists public.inbox_threads (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null,
  title                 text,                      -- first prompt, trimmed to 80 chars
  session_id            uuid not null default gen_random_uuid(),
  -- set by inbox-turn-run the first time a turn on this session finishes
  -- successfully; null = the container has never held this session, so the
  -- next turn must carry the full memory envelope again.
  session_started_at    timestamptz,
  session_reset_count   int not null default 0,
  -- the daily-summary date the session was last grounded on; the broker sends
  -- a delta when the assembler's newest date moves past it.
  grounded_summary_date date,
  grounding             jsonb,                     -- first-turn assembler manifest
  model                 text,
  last_turn_at          timestamptz,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists inbox_threads_user_recent
  on public.inbox_threads (user_id, last_turn_at desc nulls last);

-- ---------------------------------------------------------------------------
-- turns: the unit of work. A row exists from the moment the broker accepted
-- the prompt (status 'running'); the completion webhook fills the rest.
-- ---------------------------------------------------------------------------
create table if not exists public.inbox_turns (
  id              uuid primary key,                -- client-minted so the UI can render it before the broker answers
  thread_id       uuid not null references public.inbox_threads (id) on delete cascade,
  user_id         uuid not null,
  prompt          text not null,
  context         text,                            -- the attached-context prose the client sent (chips), never the transcript
  context_chars   int,                             -- what the broker added this turn (envelope or delta + append)
  model           text,                            -- requested; null = container default
  ran_on          text,                            -- what the frames said actually answered
  status          text not null default 'queued'
                  check (status in ('queued','running','done','error','aborted')),
  answer          text,
  tool_events     jsonb not null default '[]'::jsonb,   -- [{t, name, summary}]
  sources         jsonb not null default '[]'::jsonb,   -- [{kind, path, at}] memory/brain/summary hits
  grounding       jsonb,                           -- {resumed, summary_date, memory_index_at, compiled_at, blocks_shed}
  session_id      uuid,
  resumed         boolean,
  cost_usd        numeric(10,6),
  duration_ms     int,
  num_turns       int,
  usage           jsonb,
  client_gone_at  timestamptz,                     -- the broker's relay was cancelled before done
  error_code      text,
  error_detail    text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
create index if not exists inbox_turns_thread on public.inbox_turns (thread_id, created_at);
create index if not exists inbox_turns_open on public.inbox_turns (user_id, status) where status in ('queued','running');

-- ---------------------------------------------------------------------------
-- notifications: the one feed. Producers call inbox-notify; the browser reads
-- the view, and only ever writes read_at / dismissed_at.
-- ---------------------------------------------------------------------------
create table if not exists public.inbox_notifications (
  id            uuid primary key default gen_random_uuid(),
  family        text not null check (family ~ '^[a-z][a-z0-9_]{1,39}$'),
  source        text,                              -- producer id: n8n workflow id, 'inbox-turn-run', ...
  dedupe_key    text,
  severity      text not null default 'info' check (severity in ('info','attention','error')),
  title         text not null check (char_length(title) <= 200),
  body          text check (char_length(body) <= 4000),
  url           text,                              -- relative './#...' resolved against the sw scope, or https
  media         jsonb,                             -- {kind:'image'|'link'|'audio'|'pdf', url, thumb, title, ...}
  group_key     text,
  tenant        text,                              -- 'arch' | 'rise' | null (= Ivan)
  count         int not null default 1,            -- repeats folded into this row within the dedupe window
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  dismissed_at  timestamptz,
  pushed_at     timestamptz,
  push_result   jsonb                              -- {subs, results}
);
create index if not exists inbox_notifications_feed on public.inbox_notifications (created_at desc) where dismissed_at is null;
create index if not exists inbox_notifications_dedupe on public.inbox_notifications (dedupe_key, last_seen_at desc) where dedupe_key is not null;
create index if not exists inbox_notifications_group on public.inbox_notifications (group_key, created_at desc) where group_key is not null;

-- ---------------------------------------------------------------------------
-- RLS: the authed single user. Threads/turns pin user_id = auth.uid().
-- Notifications carry no user_id (one operator); they are readable by any
-- authenticated user of this project, which today is exactly one account.
-- Anon reads nothing.
-- ---------------------------------------------------------------------------
alter table public.inbox_threads       enable row level security;
alter table public.inbox_turns         enable row level security;
alter table public.inbox_notifications enable row level security;

drop policy if exists inbox_threads_owner_read on public.inbox_threads;
create policy inbox_threads_owner_read on public.inbox_threads
  for select to authenticated using (user_id = auth.uid());

drop policy if exists inbox_turns_owner_read on public.inbox_turns;
create policy inbox_turns_owner_read on public.inbox_turns
  for select to authenticated using (user_id = auth.uid());

-- The browser's only write on a turn: stop it. Column-level grant below keeps
-- it to `status`, the check keeps the new value to 'aborted'.
drop policy if exists inbox_turns_owner_abort on public.inbox_turns;
create policy inbox_turns_owner_abort on public.inbox_turns
  for update to authenticated
  using (user_id = auth.uid() and status in ('queued','running'))
  with check (user_id = auth.uid() and status = 'aborted');

drop policy if exists inbox_notifications_authed_read on public.inbox_notifications;
create policy inbox_notifications_authed_read on public.inbox_notifications
  for select to authenticated using (true);

drop policy if exists inbox_notifications_authed_mark on public.inbox_notifications;
create policy inbox_notifications_authed_mark on public.inbox_notifications
  for update to authenticated using (true) with check (true);

-- Supabase's default privileges hand anon AND authenticated the full grant list
-- on every new table in public. Taking both back first is what makes the four
-- explicit grants below the real surface: without it `authenticated` could write
-- any column of a turn it is allowed to abort.
revoke all on public.inbox_threads, public.inbox_turns, public.inbox_notifications
  from anon, authenticated;
grant select on public.inbox_threads to authenticated;
grant select on public.inbox_turns to authenticated;
grant update (status) on public.inbox_turns to authenticated;
grant select on public.inbox_notifications to authenticated;
grant update (read_at, dismissed_at) on public.inbox_notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Views: the inbox_sends_v idiom. security_invoker = on so the base-table RLS
-- decides; the view exists so the browser has a stable read shape and the
-- service-role columns (usage, push_result) can be withheld later without a
-- client change.
-- ---------------------------------------------------------------------------
create or replace view public.inbox_threads_v
  with (security_invoker = on) as
  select t.id, t.user_id, t.title, t.session_id, t.session_started_at, t.session_reset_count,
         t.grounded_summary_date, t.grounding, t.model, t.last_turn_at, t.archived_at,
         t.created_at, t.updated_at,
         (select count(*) from public.inbox_turns u where u.thread_id = t.id) as turn_count,
         (select u.status from public.inbox_turns u where u.thread_id = t.id order by u.created_at desc limit 1) as last_status
  from public.inbox_threads t;

create or replace view public.inbox_turns_v
  with (security_invoker = on) as
  select id, thread_id, user_id, prompt, context, context_chars, model, ran_on, status, answer,
         tool_events, sources, grounding, session_id, resumed, cost_usd, duration_ms, num_turns,
         client_gone_at, error_code, error_detail, created_at, started_at, finished_at
  from public.inbox_turns;

create or replace view public.inbox_notifications_v
  with (security_invoker = on) as
  select id, family, source, dedupe_key, severity, title, body, url, media, group_key, tenant,
         count, first_seen_at, last_seen_at, created_at, read_at, dismissed_at, pushed_at
  from public.inbox_notifications;

revoke all on public.inbox_threads_v, public.inbox_turns_v, public.inbox_notifications_v
  from anon, authenticated;
grant select on public.inbox_threads_v, public.inbox_turns_v, public.inbox_notifications_v to authenticated;
