-- db/276 rollback: remove the brain stage heartbeat and re-add the 9 one-time cron jobs exactly as they
-- were live on 2026-10-15 (cron.job: database postgres, username postgres, active true). Re-adding gives
-- them new jobids; each had already run once on its scheduled date (last runs 2026-09-24 .. 2026-10-09).
SELECT cron.unschedule('brain-stage-heartbeat') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'brain-stage-heartbeat');
DROP FUNCTION IF EXISTS public.brain_stage_heartbeat(timestamptz, boolean);
DROP FUNCTION IF EXISTS public.brain_stage_artifact(text, timestamptz, timestamptz);
DROP TABLE IF EXISTS public.brain_stage_heartbeat_log;
DROP TABLE IF EXISTS public.brain_stage_heartbeat_stages;
-- Optional: feed rows the heartbeat wrote (dedupe_key brain-heartbeat:<stage>:<week>).
-- DELETE FROM public.inbox_notifications WHERE source = 'brain-heartbeat';

-- original jobid 89
SELECT cron.schedule('cb15_outlier_recompute_first', '52 19 24 9 *', $$select public.outlier_recompute_all('cron-20260924-verify')$$);
-- original jobid 90
SELECT cron.schedule('cb15_outlier_recompute_a3', '14 20 24 9 *', $$select public.outlier_recompute_all('cron-20260924-a3')$$);
-- original jobid 91
SELECT cron.schedule('cb16_recipe_refit_p0', '10 22 24 9 *', $$select public.outlier_refit_recipes('cron-20260924-cb16p0')$$);
-- original jobid 92
SELECT cron.schedule('cb16_arch_recompute_c4', '25 22 24 9 *', $$select public.outlier_recompute_v3('arch', 'cron-20260924-cb16c4')$$);
-- original jobid 94
SELECT cron.schedule('cb16_recipe_live_check_d14', '0 1 9 10 *', $$select public.outlier_recipe_live_check('cron-d14', '2026-09-25T00:59:17.552582+00:00'::timestamptz)$$);
-- original jobid 207
SELECT cron.schedule('cb38-freeze-1200', '0 12 5 10 *', $$select public.cb38_monday_snapshot('freeze_1200')$$);
-- original jobid 208
SELECT cron.schedule('cb38-freeze-1900', '0 19 5 10 *', $$select public.cb38_monday_snapshot('freeze_1900')$$);
-- original jobid 209
SELECT cron.schedule('cb38-monday-result', '30 23 5 10 *', $$select public.cb38_monday_snapshot('monday_result')$$);
-- original jobid 210
SELECT cron.schedule('cb38-monday-result-tue', '0 8 6 10 *', $$select public.cb38_monday_snapshot('monday_result')$$);
