-- Rollback of db/280 content autopilot. Removes the Sunday job, the functions, the view and the tables (runs + log + config +
-- must-carry replay verdicts). It never touches carousel_drafts: anything the autopilot scheduled in LIVE mode stays scheduled
-- (find it first: select * from public.content_autopilot_outcomes_v;). Feed rows it posted stay in inbox_notifications
-- (dedupe_key like 'autopilot:%').
-- Softer stop without removing anything: update public.content_autopilot_config set mode = 'off', updated_at = now();
BEGIN;
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'content-autopilot-sunday';
DROP VIEW IF EXISTS public.content_autopilot_outcomes_v;
DROP FUNCTION IF EXISTS public.content_autopilot_sunday(timestamptz);
DROP FUNCTION IF EXISTS public.content_autopilot_run(text, date, timestamptz, boolean, text);
DROP FUNCTION IF EXISTS public.content_autopilot_schedule_ivan(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.content_autopilot_candidates(text, date, timestamptz);
DROP TABLE IF EXISTS public.content_autopilot_log;
DROP TABLE IF EXISTS public.content_autopilot_runs;
DROP TABLE IF EXISTS public.cb_must_carry_replay;
DROP TABLE IF EXISTS public.content_autopilot_config;
COMMIT;
