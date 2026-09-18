-- 089: client_research_runs. The launcher's run ledger.
--
-- One row per (client_id, run_id). The launcher opens it before step 1 and closes it after the
-- last step, so a run that dies mid-way leaves a row with status 'running' and a finished_at of
-- null -- which is the honest record of what happened, not a gap.
--
-- `apify_usd` defaults to 0 and is the number the no-spend gate reads. It is written by the
-- launcher from what it actually spent, never from what it was budgeted: budget lives in
-- `budget`, spend lives here, and the two are allowed to disagree.
--
-- `steps` is a jsonb object keyed by step name, each holding that step's own counts
-- (`{"seed": {"rows": 12, "inserted": 0, "skipped": 12}, ...}`). A step that was skipped says so
-- with a reason rather than being absent, so a reader can tell "did not run" from "ran and found
-- nothing".
--
-- status: 'running' | 'ok' | 'capped' | 'failed'. 'capped' is a clean stop at the per-run call
-- cap and is not an error -- the run did what it was allowed to do and said where it stopped.
--
-- Tenancy: client_id is not null and is the first half of the key, so every read is naturally
-- lane-scoped. Nothing reads this table but the launcher and the readout it produces. RLS is on
-- and there is no anon grant.

create table if not exists public.client_research_runs (
  client_id     text        not null,
  run_id        text        not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  budget        jsonb       not null default '{}'::jsonb,
  steps         jsonb       not null default '{}'::jsonb,
  apify_usd     numeric     not null default 0,
  proxy_calls   integer     not null default 0,
  status        text        not null default 'running',
  constraint client_research_runs_pkey primary key (client_id, run_id),
  constraint client_research_runs_status_chk
    check (status in ('running', 'ok', 'capped', 'failed')),
  constraint client_research_runs_apify_nonneg check (apify_usd >= 0),
  constraint client_research_runs_calls_nonneg check (proxy_calls >= 0)
);

create index if not exists client_research_runs_client_started_idx
  on public.client_research_runs (client_id, started_at desc);

alter table public.client_research_runs enable row level security;
revoke all on public.client_research_runs from anon, public;
grant select on public.client_research_runs to authenticated, service_role;
grant insert, update on public.client_research_runs to service_role;
