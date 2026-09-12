-- db/065 — the bot's push mute: one boolean on the bot thread row.
-- Goal run inbox-agent-drawer-2026-09-12, seat A. NEW COLUMN ONLY, on top of
-- db/060. Touches no existing row shape, no existing policy body, no
-- publication.
--
-- What: `inbox_threads.bot_push_muted` (default false) + the column grant that
-- makes it the FOURTH narrow browser write; `inbox_threads_v` re-created with
-- the db/060 select list and the new column appended at the END.
--
-- Why: from this run a bot turn whose answer carries an ACTIONABLE pill (kind
-- open, task or reply) writes one `inbox_notifications` row in family `bot` and
-- pushes Ivan's phone once (decision D4/D5). A push that cannot be turned off
-- from the surface it rings for is a push he learns to ignore, so the drawer
-- needs a one-tap mute. It is a column and not `integration_config` because
-- only the service role may write that table, and not localStorage because the
-- guardrail for this run names exactly one new key and the drawer already
-- spent it (decision D6).
--
-- The policy `inbox_threads_owner_seen` (db/060) already covers UPDATE on the
-- caller's own thread rows (`using`/`with check` = `user_id = auth.uid()`), so
-- no policy is created or altered here: the column grant is the whole of the
-- new write surface, exactly as `bot_seen_at` was.
--
-- Apply via the Management API (same idiom as db/049, db/060: the User-Agent
-- header is required or Cloudflare answers 403). Never re-paste db/049 or
-- db/060. New view columns go at the END.

-- ---------------------------------------------------------------------------
-- inbox_threads: bot_push_muted
-- ---------------------------------------------------------------------------
alter table public.inbox_threads add column if not exists bot_push_muted boolean not null default false;

-- ---------------------------------------------------------------------------
-- the browser's fourth narrow write: bot_push_muted on its own thread only.
-- ---------------------------------------------------------------------------
grant update (bot_push_muted) on public.inbox_threads to authenticated;

-- ---------------------------------------------------------------------------
-- view: the db/060 select list, bot_push_muted appended at the end.
-- ---------------------------------------------------------------------------
create or replace view public.inbox_threads_v
  with (security_invoker = on) as
  select t.id, t.user_id, t.title, t.session_id, t.session_started_at, t.session_reset_count,
         t.grounded_summary_date, t.grounding, t.model, t.last_turn_at, t.archived_at,
         t.created_at, t.updated_at,
         (select count(*) from public.inbox_turns u where u.thread_id = t.id) as turn_count,
         (select u.status from public.inbox_turns u where u.thread_id = t.id order by u.created_at desc limit 1) as last_status,
         t.kind, t.bot_seen_at, t.bot_push_muted
  from public.inbox_threads t;

grant select on public.inbox_threads_v to authenticated;
