-- 20261116d: Ivan's idea list stops growing without end.
--
-- Found 11-16: Ivan's Content > Ideas showed 224. operator_ranked_ideas lists every lm_idea_candidates row in
-- status 'reviewing' with no age limit (client_ideas for RISE/ARCH already use a 30-day window in the same
-- function). 50-90 ideas a week come in, about 5 a week become posts, so ~30 a week piled up.
-- Ivan said the count "looks too much". 57 were archived by hand on 11-16 (reason
-- stale_30d_outside_source_20261116...); this keeps it that way daily.
--
-- Rule: archive a reviewing idea when ALL hold:
--   - it comes from an outside source: x_viral, x_search, competitor, youtube_watch, claude_sessions,
--     kyle_call, reddit_se (explicit list; Ivan's own sources manual / ivan_call / calls are never touched,
--     nor any source not on the list)
--   - older than 30 days (coalesce(ingested_at, created_at))
--   - archived_reason is null (a row that carries an earlier reason is left alone, so restore is exact)
--   - not waiting on Ivan's data (needs_ivan_data)
--   - not referenced by any content_plan_slots row (any status)
--   - not referenced by any editorial_source_curation row for ivan, in ANY source-id form (the bridge uses
--     'candidate-summary:lm_idea_candidates:<uuid>' and baseline ids; a uuid is unique, so containment matches all)
-- Concurrency: takes the planner's own transaction lock (content-plan:ivan) and SHARE locks on
-- content_plan_slots and editorial_source_curation before the UPDATE, so a plan or pin committed at the same
-- moment is either visible to the check or waits until the archive commits. The planner functions take the
-- advisory lock first, so they serialize with this. A transaction that writes one of those tables BEFORE taking
-- the advisory lock could deadlock with it; PostgreSQL then aborts one of the two. lock_timeout (10 s) applies to
-- each lock wait. Any failure leaves nothing half-done and the next day's run retries.
-- Nothing is deleted. archived_reason records the rule and how to restore.
-- The Idea Supply Watchdog counts only ideas from the last 3 days, so this never triggers a top-up.
--
-- Readers (who-reads 11-16): the new function has 0 readers. lm_idea_candidates has 662 hits; the only
-- effect for them is that old outside ideas leave the 'reviewing' set, the same thing the Friday Digest's
-- "Archive Rest" already does.
--
-- Sol r1 (11-16) fixes: curation id forms, planner/curation locking, archived_reason null-only, stronger tests.
--
-- Rollback: 20261116d_ideas_stale_outside_daily_archive_rollback.sql

begin;

do $guard$
begin
  if exists (select 1 from cron.job where jobname = 'ideas-stale-outside-archive' and username = 'postgres') then
    raise exception 'cron job ideas-stale-outside-archive already exists: refused';
  end if;
end $guard$;

create function public.lm_ideas_archive_stale_outside()
 returns jsonb
 language plpgsql
 set search_path to 'public'
 set lock_timeout to '10s'
as $function$
declare res jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('content-plan:ivan', 0));
  lock table public.content_plan_slots in share mode;
  lock table public.editorial_source_curation in share mode;

  with a as (
    update public.lm_idea_candidates l
       set status = 'archived',
           archived_reason = 'stale_30d_outside_source_daily (was reviewing; restore: status=reviewing, archived_reason=null)'
     where l.status = 'reviewing'
       and l.content_type is distinct from 'lead_magnet'
       and l.archived_reason is null
       and l.source in ('x_viral','x_search','competitor','youtube_watch','claude_sessions','kyle_call','reddit_se')
       and coalesce(l.ingested_at, l.created_at) < now() - interval '30 days'
       and not coalesce(l.needs_ivan_data, false)
       and not exists (select 1 from public.content_plan_slots p where p.idea_ref = l.id::text)
       and not exists (select 1 from public.editorial_source_curation c
                        where c.client_id = 'ivan' and position(l.id::text in c.source_id) > 0)
    returning l.source
  )
  select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) into res
    from (select source, count(*) n from a group by source) x;
  return res;
end $function$;
revoke all on function public.lm_ideas_archive_stale_outside() from public, anon, authenticated, service_role;

select cron.schedule('ideas-stale-outside-archive', '20 4 * * *', 'select public.lm_ideas_archive_stale_outside()');

commit;
