-- db/050 — runner_jobs: the queue between the inbox Ask pane and the Claude
-- runner service on Railway. Goal run claude-runner-cloud-mirror-2026-09-06,
-- phase 3. NEW OBJECTS ONLY: one table, two indexes, one trigger + its
-- function, RLS, grants, one publication membership, one RPC. Touches no
-- existing table, view, policy or function.
--
-- Apply via the Management API (POST /v1/projects/<ref>/database/query with a
-- User-Agent header; Cloudflare 403s code 1010 without one). Never re-paste
-- older migrations.
--
-- The shape mirrors db/049's inbox_turns deliberately, because the two rows
-- mean the same thing at two time scales: a turn is a minute of Claude inside
-- the container, a job is an hour of Claude on the runner with the Mac shut.
--
-- Read model for the browser  = select on the user's own rows (realtime rides
--                               the same policy).
-- Write model for the browser = ONE narrow path: status -> 'cancelled' on a job
--                               of the user's own that has not finished. Every
--                               other write is the dispatch edge function or
--                               the executor, both service role.

-- ---------------------------------------------------------------------------
-- the queue
-- ---------------------------------------------------------------------------
create table if not exists public.runner_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  -- 'prompt' = the composer's text, run as one `claude -p`.
  -- 'goal'   = a GOAL-*.md / MISSION.md spec the runner found on disk; `input`
  --            is the spec PATH and `cwd` the folder that holds its goal-runs/.
  kind          text not null check (kind in ('prompt','goal')),
  input         text not null,
  cwd           text,
  model         text,
  status        text not null default 'queued'
                check (status in ('queued','running','done','error','cancelled')),
  -- The stream-json tail the executor appends every 10 s, capped at 200 KB in
  -- the row; the whole thing lives at /data/jobs/<id>.log on the runner.
  log           text,
  report_path   text,
  cost_usd      numeric(10,6),
  ran_on        text,                      -- what the frames said actually answered
  claimed_by    text,                      -- the host that claimed it ('runner')
  error_detail  text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The executor's poll: the only rows it ever scans are the open ones.
create index if not exists runner_jobs_open
  on public.runner_jobs (status, created_at) where status in ('queued','running');
-- The pane's read: the last 20 jobs of this user, newest first.
create index if not exists runner_jobs_user_recent
  on public.runner_jobs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at, so a log append is visible as motion even when no other column
-- changed. The trigger function is named after the table rather than a generic
-- set_updated_at(): this project has no shared one, and inventing a global name
-- here would collide with the next migration that wants its own.
-- ---------------------------------------------------------------------------
create or replace function public.runner_jobs_touch() returns trigger
language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists runner_jobs_touch on public.runner_jobs;
create trigger runner_jobs_touch
  before update on public.runner_jobs
  for each row execute function public.runner_jobs_touch();

-- ---------------------------------------------------------------------------
-- RLS: the same two policies inbox_turns carries, with 'cancelled' where that
-- table says 'aborted'. There is deliberately NO insert policy: a browser that
-- could insert a job could run arbitrary Claude on a box holding every
-- client's credentials. Insert is the dispatch function's, with the service
-- key, after it has verified the bearer and the single-operator allowlist.
-- ---------------------------------------------------------------------------
alter table public.runner_jobs enable row level security;

drop policy if exists runner_jobs_owner_read on public.runner_jobs;
create policy runner_jobs_owner_read on public.runner_jobs
  for select to authenticated using (user_id = auth.uid());

drop policy if exists runner_jobs_owner_cancel on public.runner_jobs;
create policy runner_jobs_owner_cancel on public.runner_jobs
  for update to authenticated
  using (user_id = auth.uid() and status in ('queued','running'))
  with check (user_id = auth.uid() and status = 'cancelled');

-- Supabase's default privileges hand anon AND authenticated the full grant list
-- on every new table in public, so the policy above would otherwise sit behind
-- a grant that lets `authenticated` rewrite `input` or `cwd` on a job it is
-- merely allowed to cancel. Take both back first; the column-level update grant
-- is what makes the policy the real surface.
revoke all on public.runner_jobs from anon, authenticated;
grant select on public.runner_jobs to authenticated;
grant update (status) on public.runner_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime. Guarded so a re-run of this file is a no-op instead of
-- "relation is already member of publication".
-- ---------------------------------------------------------------------------
do $pub$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'runner_jobs'
  ) then
    execute 'alter publication supabase_realtime add table public.runner_jobs';
  end if;
end;
$pub$;

-- ---------------------------------------------------------------------------
-- runner_claim_job — the executor's atomic claim.
--
-- PostgREST cannot put a LIMIT on an UPDATE, so a `PATCH ?status=eq.queued
-- &limit=1` is not a thing: the honest options were a Postgres advisory lock or
-- this. `for update skip locked` on the inner select is what makes two runner
-- processes (or a runner and a retry of itself) claim two different jobs
-- instead of the same one twice.
--
-- SECURITY DEFINER because the executor holds the service key and nothing else
-- may call it: the revokes below are the point of the function, not paperwork.
-- ---------------------------------------------------------------------------
create or replace function public.runner_claim_job(p_host text)
returns setof public.runner_jobs
language sql
security definer
set search_path = public
as $claim$
  update public.runner_jobs j
     set status     = 'running',
         claimed_by = p_host,
         started_at = now()
   where j.id = (
     select c.id
       from public.runner_jobs c
      where c.status = 'queued'
      order by c.created_at
      limit 1
      for update skip locked
   )
  returning j.*;
$claim$;

revoke all on function public.runner_claim_job(text) from public, anon, authenticated;
grant execute on function public.runner_claim_job(text) to service_role;
