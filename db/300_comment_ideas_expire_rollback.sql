-- Rollback db/300. Puts every expired card back first (nothing was deleted), then drops the pieces.
update public.outreach_seats set settings = jsonb_set(settings, '{owner_comment,day_cap}', '5'::jsonb)
 where seat = 'risedtc' and settings->'owner_comment'->>'day_cap' = '4';
select cron.unschedule(jobid) from cron.job where jobname = 'comment-ideas-expire';
select public.comment_ideas_expire_undo(r.run_id) from (select distinct run_id from public.comment_idea_expiry_log where undone_at is null) r;
drop function if exists public.comment_ideas_expire_undo(uuid, uuid[]);
drop function if exists public.comment_ideas_expire_stale(boolean);
drop function if exists public.comment_ideas_stale(timestamptz);
drop function if exists public.comment_idea_ts_or_null(text);
drop table if exists public.comment_idea_expiry_log;
