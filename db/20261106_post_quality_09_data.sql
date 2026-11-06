-- 20261106_post_quality_09_data.sql: one-off data steps after 20261106_post_quality_09.sql (applied 2026-11-06).
-- a) the re-run note on every live Ivan draft; b) the 11 Nov re-run of "Owning 100% of your time" (original 30 Sep,
-- 89 impressions, bar 170) back to Review with no date, its queued post cancelled. Its plan slot stays reserved for
-- it (content_plan_reconcile_ivan keeps a slot whose draft is in Review), so no other draft is swapped in.
-- c) the first dead-twin re-link.
select public.ivan_rerun_stamp(200);

update public.carousel_drafts d
   set status = 'review', scheduled_at = null,
       qa = d.qa || jsonb_build_object('line_flags', coalesce(d.qa -> 'line_flags', '{}'::jsonb)
              || jsonb_build_object('rerun', coalesce(d.qa #> '{line_flags,rerun}', '{}'::jsonb)
                   || jsonb_build_object('held_at', now(), 'held_from', d.scheduled_at, 'held_by', 'build-09 one-off 2026-11-06')))
 where d.id = '38a16005-ee11-4cae-8fdd-792ffddcc8f4' and d.status = 'scheduled' and d.published_at is null
   and (d.qa #>> '{line_flags,rerun,pass}') = 'false';

update public.scheduled_posts
   set status = 'cancelled',
       error_message = 'rerun_gate: repeats the 30 Sep post (89 impressions, bar 170). Back in Review for Ivan.'
 where id = 'c17a9f39-71ec-4d8e-9f42-c87b3e8191d2' and status = 'pending';

select public.ivan_own_post_relink(true);
