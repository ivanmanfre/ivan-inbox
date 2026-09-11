-- db/060 — the bot thread: threads carry a kind, turns carry an origin.
-- Goal run claude-bot-thread-2026-09-11, wave W1. NEW OBJECTS/COLUMNS ONLY,
-- on top of db/049. Touches no existing row shape, no existing policy body,
-- no publication.
--
-- What: `inbox_threads.kind` ('ask'|'bot') + `bot_seen_at`; `inbox_turns.origin`
-- ('operator'|'bot'); one partial unique index so a user has at most one bot
-- thread; the two views re-created with the new columns appended at the end;
-- a grant + policy for the third narrow browser write (bot_seen_at, after turn
-- abort and notification read/dismiss); two integration_config flags the tick
-- reads; the standing bot prompt in content_prompts.
--
-- Why: the tick (W2) needs a place to park "the one bot thread" per user and a
-- way to tell a bot-authored turn from an operator turn so inbox-turn-run (W1)
-- can skip the push and fold the rows it read.
--
-- Apply via the Management API (goal-runs/claude-bot-thread-2026-09-11-out/tools/q.sh),
-- same idiom as db/049: User-Agent header required or Cloudflare 403s.
-- Never re-paste db/049. New view columns go at the END.

-- ---------------------------------------------------------------------------
-- inbox_threads: kind + bot_seen_at
-- ---------------------------------------------------------------------------
alter table public.inbox_threads add column if not exists kind text not null default 'ask';
alter table public.inbox_threads drop constraint if exists inbox_threads_kind_check;
alter table public.inbox_threads add constraint inbox_threads_kind_check check (kind in ('ask','bot'));

alter table public.inbox_threads add column if not exists bot_seen_at timestamptz;

-- One bot thread per user. The tick creates it on first run; this is what
-- keeps a race from minting two.
create unique index if not exists inbox_threads_one_bot_per_user
  on public.inbox_threads (user_id) where kind = 'bot';

-- ---------------------------------------------------------------------------
-- inbox_turns: origin
-- ---------------------------------------------------------------------------
alter table public.inbox_turns add column if not exists origin text not null default 'operator';
alter table public.inbox_turns drop constraint if exists inbox_turns_origin_check;
alter table public.inbox_turns add constraint inbox_turns_origin_check check (origin in ('operator','bot'));

-- ---------------------------------------------------------------------------
-- the browser's third narrow write: bot_seen_at on its own thread only.
-- ---------------------------------------------------------------------------
grant update (bot_seen_at) on public.inbox_threads to authenticated;

drop policy if exists inbox_threads_owner_seen on public.inbox_threads;
create policy inbox_threads_owner_seen on public.inbox_threads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- views: same select list as db/049, new columns appended at the end.
-- ---------------------------------------------------------------------------
create or replace view public.inbox_threads_v
  with (security_invoker = on) as
  select t.id, t.user_id, t.title, t.session_id, t.session_started_at, t.session_reset_count,
         t.grounded_summary_date, t.grounding, t.model, t.last_turn_at, t.archived_at,
         t.created_at, t.updated_at,
         (select count(*) from public.inbox_turns u where u.thread_id = t.id) as turn_count,
         (select u.status from public.inbox_turns u where u.thread_id = t.id order by u.created_at desc limit 1) as last_status,
         t.kind, t.bot_seen_at
  from public.inbox_threads t;

create or replace view public.inbox_turns_v
  with (security_invoker = on) as
  select id, thread_id, user_id, prompt, context, context_chars, model, ran_on, status, answer,
         tool_events, sources, grounding, session_id, resumed, cost_usd, duration_ms, num_turns,
         client_gone_at, error_code, error_detail, created_at, started_at, finished_at,
         origin
  from public.inbox_turns;

grant select on public.inbox_threads_v, public.inbox_turns_v to authenticated;

-- ---------------------------------------------------------------------------
-- flags the tick reads. Born disabled; W4 flips bot_tick_enabled after the
-- message-quality and no-write gates are green.
-- ---------------------------------------------------------------------------
insert into integration_config (key, value, is_secret) values
  ('bot_tick_enabled', 'false', false),
  ('bot_daily_turn_cap', '24', false)
on conflict (key) do nothing;
