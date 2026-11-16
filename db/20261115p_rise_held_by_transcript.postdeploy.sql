-- Post-deploy checks for 20261115p on LIVE. Read-only: run after the migration and the first
-- `select public.rise_booking_held_apply();`. Every row should show ok = true.
-- Expected at deploy time (dry run p_now 2026-11-15 21:30 UTC): ~147 RISE rows judged; Aug-Nov held 40, no-show 4.
-- Since 20261116b, ARCH rows carry held_* stamps too (arch_booking_held_apply): the RISE checks are scoped to
-- client_id = 'risedtc' and the shared stamping check allows both tenants. ARCH checks: 20261116b_*.postdeploy.sql.
select 'columns present' as check_name, count(*) = 5 as ok, count(*)::text as detail
  from pg_attribute where attrelid = 'public.booking_attributions'::regclass and attname like 'held%' and not attisdropped
union all
select 'no tenant other than RISE/ARCH stamped', count(*) = 0, count(*)::text
  from public.booking_attributions where client_id not in ('risedtc','arch') and (held_basis is not null or held_checked_at is not null)
union all
select 'no future RISE row stamped', count(*) = 0, count(*)::text
  from public.booking_attributions where client_id = 'risedtc' and held_basis is not null and meeting_start >= now() - interval '3 hours'
union all
select 'RISE no-show only on Mattan''s page', count(*) = 0, count(*)::text
  from public.booking_attributions where client_id = 'risedtc' and held_by_transcript is false and (slug like 'mattan5%') is not true
union all
select 'every past RISE row judged', count(*) = 0, count(*)::text
  from public.booking_attributions where client_id = 'risedtc' and meeting_start < now() - interval '3 hours' and held_basis is null
union all
select 'RISE held rows point at a fathom-risedtc recording', count(*) = 0, count(*)::text
  from public.booking_attributions b left join public.transcripts t on t.id = b.held_transcript_id
 where b.client_id = 'risedtc' and b.held_by_transcript and (t.id is null or t.source <> 'fathom-risedtc')
union all
select 'stamps match a fresh compute', count(*) = 0, count(*)::text
  from public.rise_booking_held_compute() c join public.booking_attributions b using (meeting_id)
 where (b.held_by_transcript, b.held_transcript_id, b.held_basis, b.held_call_start)
       is distinct from (c.held_by_transcript, c.held_transcript_id, c.held_basis, c.held_call_start)
union all
select 'anon/authenticated cannot execute', not bool_or(has_function_privilege(r, p.oid, 'EXECUTE')), string_agg(distinct r, ',')
  from pg_proc p cross join unnest(array['anon','authenticated']) r
 where p.proname in ('rise_booking_held_apply','rise_booking_held_compute','_rise_held_norm')
union all
select 'anon cannot read the table', not has_table_privilege('anon', 'public.booking_attributions', 'SELECT'), ''
union all
select 'cron job registered', count(*) = 1, max(schedule)
  from cron.job where jobname = 'rise-booking-held-daily'
union all
select 'basis counts (info)', true, (select string_agg(coalesce(held_basis, 'unjudged') || '=' || n, ', ' order by n desc)
  from (select held_basis, count(*) n from public.booking_attributions where client_id = 'risedtc' group by 1) z);
-- After the first 17:30 / 23:30 UTC runs:
--   select status, return_message, start_time, end_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'rise-booking-held-daily') order by start_time desc limit 4;
