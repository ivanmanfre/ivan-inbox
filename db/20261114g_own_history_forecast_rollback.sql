-- Rollback for 20261114g_own_history_forecast.sql + _seed.sql. Drops only objects the migration created.
-- STEP 0 (before this SQL): deactivate the labeller workflow 'CB60 Own-History Forecast Labeller'
--   npx --yes n8nac@1.8.1 workflow deactivate <id>   (id in memory note content-own-history-forecast-2026-11-14)
begin;
select cron.unschedule(jobid) from cron.job where jobname = 'cb60_own_forecast_grader';
delete from public.content_prompts where slug = 'cb60-own-kind-labeller';
delete from public.inbox_notifications where source = 'cb60-own-forecast-grader';
drop view if exists public.content_forecast_compare_v;
drop function if exists public.content_own_backtest_backfill();
drop function if exists public.content_own_label_write(jsonb, text);
drop function if exists public.content_own_label_queue(integer, text);
drop function if exists public.content_own_forecast_grade(text);
drop function if exists public.content_own_forecast_record(text, text, text, timestamptz);
drop function if exists public.content_own_predict(text, text, text, timestamptz, numeric);
drop function if exists public.content_own_outcomes_refresh(timestamptz);
drop table if exists public.content_own_forecast_grades;
drop table if exists public.content_own_backtests;
drop table if exists public.content_own_forecasts;
drop table if exists public.content_own_outcomes;
drop table if exists public.content_own_labels;
commit;
