-- 076: competitor_gated_posts. One row per roster post the gate judge has read.
-- Populated by goal-runs/lead-magnet-analytics-2026-09-16-out/judge/judge-run.mjs, which reads
-- the rubric from content_prompts slug 'lm-gate-judge' (scope system) at run time and calls
-- claude-sonnet-5 through the Railway proxy. Membership is decided by the judge reading the post,
-- never by a keyword list. Idempotent on post_ref: a post is judged once.
create table if not exists public.competitor_gated_posts (
  post_ref text primary key,
  client_id text not null,
  is_gated boolean not null,
  cta_kind text,
  gate_keyword text,
  offer text,
  confidence numeric,
  why text,
  judged_at timestamptz not null default now(),
  model text not null,
  rubric_version int not null default 1
);

alter table public.competitor_gated_posts enable row level security;
revoke all on public.competitor_gated_posts from anon, public;
grant select on public.competitor_gated_posts to authenticated, service_role;
grant insert, update on public.competitor_gated_posts to service_role;

-- Read paths: operator_gated_posts filters gated rows per lane and orders by engagement.
create index if not exists competitor_gated_posts_lane_gated_idx
  on public.competitor_gated_posts (client_id, is_gated);
