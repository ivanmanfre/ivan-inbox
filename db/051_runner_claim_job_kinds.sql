-- db/051 — runner_claim_job becomes kind-aware. Goal run
-- claude-runner-cloud-mirror-2026-09-06, phase 2/5 review fix 1.
--
-- Why: db/050's runner_claim_job(p_host text) claims the oldest queued row of ANY
-- kind, and the executor checks the kind only after the fact and hands a
-- wrong-kind row back. With one goal already running and a second goal at the head
-- of the queue, that second goal is claimed and released every 15 s forever, every
-- prompt behind it starves, and each release rewrites `status` — which the
-- runner_jobs_touch trigger and the realtime publication replay to the phone as a
-- Running -> Waiting flicker. The caps refused work; they never scheduled it.
--
-- Fix: the caller passes the kinds it currently has a free slot for, and the claim
-- filters on them inside the same `for update skip locked` select. A kind with no
-- free slot is simply not looked at, so the head of the queue can no longer block
-- the kinds behind it.
--
-- Apply via the Management API (POST /v1/projects/<ref>/database/query with a
-- User-Agent header; Cloudflare 403s code 1010 without one). Never re-paste
-- older migrations.
--
-- Signature change, so DROP then CREATE: a `create or replace` cannot add a
-- parameter, and leaving the 1-arg version callable would leave the starvation
-- path reachable by an older executor build.

drop function if exists public.runner_claim_job(text);

create function public.runner_claim_job(p_host text, p_kinds text[])
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
        and c.kind = any(p_kinds)
      order by c.created_at
      limit 1
      for update skip locked
   )
  returning j.*;
$claim$;

revoke all on function public.runner_claim_job(text, text[]) from public, anon, authenticated;
grant execute on function public.runner_claim_job(text, text[]) to service_role;
