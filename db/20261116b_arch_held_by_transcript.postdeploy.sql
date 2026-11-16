-- Post-deploy checks for 20261116b on LIVE. Read-only: run after the migration and the first
-- `select public.arch_booking_held_apply();`. Every row should show ok = true.
-- Expected at deploy time (rolled-back replay, p_now 2026-11-16 12:00 UTC): 36 ARCH rows judged; held 4
-- (Legends 09-23, Pixel Federation 09-28, DoktorABC 10-05, Funcell 11-10 08:00), no-show 0.
-- Note: the 20261115p postdeploy check 'no non-RISE row stamped' is superseded by 'no other tenant stamped' below.
select 'no other tenant stamped' as check_name, count(*) = 0 as ok, count(*)::text as detail
  from public.booking_attributions where client_id not in ('risedtc','arch') and (held_basis is not null or held_checked_at is not null)
union all
select 'no future ARCH row stamped', count(*) = 0, count(*)::text
  from public.booking_attributions where client_id = 'arch' and held_basis is not null and meeting_start >= now() - interval '3 hours'
union all
select 'every past ARCH row judged', count(*) = 0, count(*)::text
  from public.booking_attributions where client_id = 'arch' and meeting_start < now() - interval '3 hours' and held_basis is null
union all
select 'ARCH held rows point at a fireflies-arch recording', count(*) = 0, count(*)::text
  from public.booking_attributions b left join public.transcripts t on t.id = b.held_transcript_id
 where b.client_id = 'arch' and b.held_by_transcript and (t.id is null or t.source <> 'fireflies-arch')
union all
select 'ARCH no-show only with a booker email', count(*) = 0, count(*)::text
  from public.booking_attributions where client_id = 'arch' and held_by_transcript is false and nullif(trim(booker_email), '') is null
union all
select 'ARCH stamps match a fresh compute', count(*) = 0, count(*)::text
  from public.arch_booking_held_compute() c join public.booking_attributions b using (meeting_id)
 where (b.held_by_transcript, b.held_transcript_id, b.held_basis, b.held_call_start)
       is distinct from (c.held_by_transcript, c.held_transcript_id, c.held_basis, c.held_call_start)
union all
select 'RISE stamps still match the RISE compute', count(*) = 0, count(*)::text
  from public.rise_booking_held_compute() c join public.booking_attributions b using (meeting_id)
 where (b.held_by_transcript, b.held_transcript_id, b.held_basis, b.held_call_start)
       is distinct from (c.held_by_transcript, c.held_transcript_id, c.held_basis, c.held_call_start)
union all
select 'RISE held rows still on fathom-risedtc', count(*) = 0, count(*)::text
  from public.booking_attributions b left join public.transcripts t on t.id = b.held_transcript_id
 where b.client_id = 'risedtc' and b.held_by_transcript and (t.id is null or t.source <> 'fathom-risedtc')
union all
select 'anon/authenticated cannot execute', not bool_or(has_function_privilege(r, p.oid, 'EXECUTE')), string_agg(distinct r, ',')
  from pg_proc p cross join unnest(array['anon','authenticated']) r
 where p.proname in ('arch_booking_held_apply','arch_booking_held_compute','_arch_held_norm')
union all
select 'anon cannot read the table', not has_table_privilege('anon', 'public.booking_attributions', 'SELECT'), ''
union all
select 'ARCH cron job registered', count(*) = 1, max(schedule)
  from cron.job where jobname = 'arch-booking-held-daily'
union all
select 'RISE cron job unchanged', count(*) = 1, max(schedule)
  from cron.job where jobname = 'rise-booking-held-daily' and schedule = '30 17,23 * * *'
union all
select 'ARCH basis counts (info)', true, (select string_agg(coalesce(held_basis, 'unjudged') || '=' || n, ', ' order by n desc)
  from (select held_basis, count(*) n from public.booking_attributions where client_id = 'arch' group by 1) z);
-- After the first 08:45 / 20:45 UTC runs:
--   select status, return_message, start_time, end_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'arch-booking-held-daily') order by start_time desc limit 4;
