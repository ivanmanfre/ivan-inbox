-- db/276 (2026-10-15): Monday brain chain heartbeat + retire one-time crons written as yearly.
--
-- Problem: the weekly brain stages run on separate clocks. When one fails (Supabase 522, DB restart,
-- CB33 30-min write hold) nothing retries until next Monday and nobody is told (CB-22 dead 10-05..10-15,
-- CB35 10-05 weekly left no run). pg_cron "succeeded" on a pg_net job only means a request was queued.
--
-- Fix: brain_stage_heartbeat() runs every 30 min Mon-Wed. For each stage past its deadline (due + 2h)
-- with no artifact this week it re-runs the stage ONCE (same cron command, or the same n8n webhook),
-- and if the re-run has not landed 2h later it writes ONE feed row to inbox_notifications
-- (family system_watchdog_digest, feed-only, deduped per stage per week). No retries while the CB33
-- hold is on (uptime < 30 min); the next tick picks them up.
-- p_dry => evaluates only: no re-run, no pg_net, no ledger or inbox writes.

CREATE TABLE IF NOT EXISTS public.brain_stage_heartbeat_stages (
  stage text PRIMARY KEY,
  label text NOT NULL,
  due_offset interval NOT NULL,             -- from Monday 00:00 UTC
  grace interval NOT NULL DEFAULT interval '2 hours',
  retry_kind text NOT NULL CHECK (retry_kind IN ('sql_job','webhook','none')),
  cron_jobname text,                        -- sql_job: artifact = a succeeded run; retry = the job's own command
  webhook_url text,
  webhook_key_config text,                  -- integration_config key holding the header value
  webhook_header text,
  webhook_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifact text NOT NULL,                   -- what counts as landed (documentation)
  enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE public.brain_stage_heartbeat_stages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.brain_stage_heartbeat_log (
  week_start date NOT NULL,
  stage text NOT NULL REFERENCES public.brain_stage_heartbeat_stages(stage),
  retried_at timestamptz,
  retry_result jsonb,
  alerted_at timestamptz,
  alert_id uuid,
  PRIMARY KEY (week_start, stage)
);
ALTER TABLE public.brain_stage_heartbeat_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brain_stage_heartbeat_stages, public.brain_stage_heartbeat_log FROM anon, authenticated;

INSERT INTO public.brain_stage_heartbeat_stages
  (stage, label, due_offset, retry_kind, cron_jobname, webhook_url, webhook_key_config, webhook_header, webhook_body, artifact)
VALUES
 ('cb43_facts', 'CB43 weekly fact refresh (n8n 4pwffyWOTncHYRxI)', '09:00', 'none', NULL, NULL, NULL, NULL, '{}',
  'a cb43_fact_refresh_sources row processed since Mon 09:00, or nothing queued before Mon 09:00. No re-run: the workflow has no webhook, so a miss alerts at deadline + 2h'),
 ('cb15_outlier_recompute', 'Outlier recompute v1 (pg_cron cb15_outlier_recompute)', '11:30', 'sql_job', 'cb15_outlier_recompute', NULL, NULL, NULL, '{}',
  'a succeeded cron run since due, or a successful heartbeat re-run'),
 ('cb17_outlier_recompute_v4', 'Outlier recompute v4 (pg_cron cb17_outlier_recompute_v4)', '12:03', 'sql_job', 'cb17_outlier_recompute_v4', NULL, NULL, NULL, '{}',
  'a succeeded cron run since due, or a successful heartbeat re-run'),
 ('cb15_recipe_refit', 'Recipe refit (pg_cron cb15_recipe_refit)', '12:30', 'sql_job', 'cb15_recipe_refit', NULL, NULL, NULL, '{}',
  'a succeeded cron run since due, or a successful heartbeat re-run'),
 ('cb16_recipe_block_build', 'Recipe block build (pg_cron cb16_recipe_block_build)', '12:45', 'sql_job', 'cb16_recipe_block_build', NULL, NULL, NULL, '{}',
  'a succeeded cron run since due, or a successful heartbeat re-run'),
 ('cb33_pattern_rates', 'Pattern rates (pg_cron cb33-pattern-rates-weekly)', '12:45', 'sql_job', 'cb33-pattern-rates-weekly', NULL, NULL, NULL, '{}',
  'a succeeded cron run since due, or a successful heartbeat re-run'),
 ('cb22_promotion', 'CB-22 fit promotion (n8n LKGO4lIFNILV1e5I)', '15:10', 'webhook', NULL,
  'https://n8n.ivanmanfredi.com/webhook/cb22-outlier-promotion-ec403834de0bd3e6', NULL, NULL, '{"mode":"apply"}',
  'a cb22_runs row with mode=apply started this week'),
 ('cb35_weekly', 'CB35 weekly brain picker (n8n w7fH6SN6nAj9X6tE)', '15:40', 'webhook', NULL,
  'https://n8n.ivanmanfredi.com/webhook/cb35-content-brain-run', 'cb35_brain_run_key', 'x-brain-key', '{}',
  'a cb34_p2_members row from a cb35 weekly/manual run created this week for each of ivan, risedtc, arch (the webhook skips clients that already have 2)'),
 ('cb34_scoreboard', 'Scoreboard refresh (pg_cron cb34_scoreboard_refresh_weekly)', '19:00', 'sql_job', 'cb34_scoreboard_refresh_weekly', NULL, NULL, NULL, '{}',
  'a succeeded cron run since due, or a successful heartbeat re-run'),
 ('cb37_results', 'Results refresh (pg_cron cb37-results-weekly)', '20:15', 'sql_job', 'cb37-results-weekly', NULL, NULL, NULL, '{}',
  'a succeeded cron run since due, or a successful heartbeat re-run')
ON CONFLICT (stage) DO NOTHING;

-- Did the stage land this week? Bounded by p_now so a past week can be replayed.
CREATE OR REPLACE FUNCTION public.brain_stage_artifact(p_stage text, p_week timestamptz, p_now timestamptz)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s public.brain_stage_heartbeat_stages%ROWTYPE; due timestamptz;
BEGIN
  SELECT * INTO s FROM public.brain_stage_heartbeat_stages WHERE stage = p_stage;
  IF NOT FOUND THEN RETURN NULL; END IF;
  due := p_week + s.due_offset;
  IF s.retry_kind = 'sql_job' THEN
    RETURN EXISTS (SELECT 1 FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
                    WHERE j.jobname = s.cron_jobname AND d.status = 'succeeded'
                      AND d.start_time >= due AND d.start_time <= p_now)
        OR EXISTS (SELECT 1 FROM public.brain_stage_heartbeat_log l
                    WHERE l.stage = p_stage AND l.week_start = (p_week AT TIME ZONE 'UTC')::date
                      AND l.retried_at <= p_now AND (l.retry_result ->> 'ok')::boolean IS TRUE);
  END IF;
  CASE p_stage
    WHEN 'cb43_facts' THEN
      RETURN EXISTS (SELECT 1 FROM public.cb43_fact_refresh_sources WHERE processed_at >= due AND processed_at <= p_now)
          OR NOT EXISTS (SELECT 1 FROM public.cb43_fact_refresh_queue WHERE queued_at < due);
    WHEN 'cb22_promotion' THEN
      RETURN EXISTS (SELECT 1 FROM public.cb22_runs WHERE mode = 'apply' AND started_at >= p_week AND started_at <= p_now);
    WHEN 'cb35_weekly' THEN
      RETURN (SELECT count(DISTINCT client_id) FROM public.cb34_p2_members
               WHERE run_id ~ '^cb35-[0-9]{4}-[0-9]{2}-[0-9]{2}-(weekly|manual)-'
                 AND client_id IN ('ivan','risedtc','arch')
                 AND created_at >= p_week AND created_at <= p_now) = 3;
    ELSE RETURN NULL;
  END CASE;
END $function$;

CREATE OR REPLACE FUNCTION public.brain_stage_heartbeat(p_now timestamptz DEFAULT now(), p_dry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  wk timestamptz := date_trunc('week', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  hold boolean := now() - pg_postmaster_start_time() < interval '30 minutes';
  s public.brain_stage_heartbeat_stages%ROWTYPE; l public.brain_stage_heartbeat_log%ROWTYPE;
  due timestamptz; deadline timestamptz; landed boolean; act text; res jsonb; out jsonb := '[]'::jsonb;
  sql_retry_used boolean := false; v_cmd text; v_req bigint; v_hdr jsonb; v_st text; v_lt text;
  v_key text; v_id uuid; v_body text; has_log boolean;
BEGIN
  IF NOT p_dry THEN
    IF NOT pg_try_advisory_xact_lock(hashtextextended('brain-stage-heartbeat', 0)) THEN
      RETURN jsonb_build_object('ran', false, 'reason', 'busy'); END IF;
    IF hold THEN RETURN jsonb_build_object('ran', false, 'reason', 'cb33_health_hold', 'uptime', (now() - pg_postmaster_start_time())::text); END IF;
  END IF;

  FOR s IN SELECT * FROM public.brain_stage_heartbeat_stages WHERE enabled ORDER BY due_offset, stage LOOP
    due := wk + s.due_offset; deadline := due + s.grace; res := NULL;
    IF p_now < deadline THEN
      out := out || jsonb_build_object('stage', s.stage, 'state', 'not_due', 'deadline', deadline); CONTINUE; END IF;
    landed := public.brain_stage_artifact(s.stage, wk, p_now);
    IF landed THEN out := out || jsonb_build_object('stage', s.stage, 'state', 'ok'); CONTINUE; END IF;

    SELECT * INTO l FROM public.brain_stage_heartbeat_log WHERE week_start = (wk AT TIME ZONE 'UTC')::date AND stage = s.stage;
    has_log := FOUND;
    IF has_log AND l.alerted_at IS NOT NULL THEN
      out := out || jsonb_build_object('stage', s.stage, 'state', 'alerted', 'alerted_at', l.alerted_at); CONTINUE; END IF;

    IF s.retry_kind <> 'none' AND (NOT has_log OR l.retried_at IS NULL) THEN
      act := 'retry';
      IF s.retry_kind = 'sql_job' AND sql_retry_used THEN
        out := out || jsonb_build_object('stage', s.stage, 'state', 'missed', 'action', 'retry_next_tick'); CONTINUE; END IF;
      IF NOT p_dry THEN
        IF s.retry_kind = 'sql_job' THEN
          sql_retry_used := true;
          SELECT command INTO v_cmd FROM cron.job WHERE jobname = s.cron_jobname;
          v_st := current_setting('statement_timeout'); v_lt := current_setting('lock_timeout');
          BEGIN
            IF v_cmd IS NULL THEN RAISE EXCEPTION 'cron job % not found', s.cron_jobname; END IF;
            EXECUTE v_cmd;
            res := jsonb_build_object('ok', true, 'kind', 'sql_job', 'job', s.cron_jobname);
          EXCEPTION WHEN others THEN
            res := jsonb_build_object('ok', false, 'kind', 'sql_job', 'job', s.cron_jobname, 'error', left(SQLERRM, 300));
          END;
          PERFORM set_config('statement_timeout', v_st, false); PERFORM set_config('lock_timeout', v_lt, false);
        ELSE
          v_hdr := jsonb_build_object('Content-Type', 'application/json');
          IF s.webhook_header IS NOT NULL THEN
            v_hdr := v_hdr || jsonb_build_object(s.webhook_header,
                       (SELECT value FROM public.integration_config WHERE key = s.webhook_key_config));
          END IF;
          BEGIN
            SELECT net.http_post(url := s.webhook_url,
                                 body := s.webhook_body || jsonb_build_object('source', 'brain-heartbeat'),
                                 headers := v_hdr, timeout_milliseconds := 30000) INTO v_req;
            res := jsonb_build_object('ok', NULL, 'kind', 'webhook', 'request_id', v_req);
          EXCEPTION WHEN others THEN
            res := jsonb_build_object('ok', false, 'kind', 'webhook', 'error', left(SQLERRM, 300));
          END;
        END IF;
        INSERT INTO public.brain_stage_heartbeat_log(week_start, stage, retried_at, retry_result)
        VALUES ((wk AT TIME ZONE 'UTC')::date, s.stage, p_now, res)
        ON CONFLICT (week_start, stage) DO UPDATE SET retried_at = EXCLUDED.retried_at, retry_result = EXCLUDED.retry_result;
      END IF;
      out := out || jsonb_build_object('stage', s.stage, 'state', 'missed', 'action', act, 'due', due, 'result', res,
                                       'would_call', CASE s.retry_kind WHEN 'sql_job' THEN s.cron_jobname ELSE s.webhook_url END);
      CONTINUE;
    END IF;

    -- Retry already used (or none possible): alert once the re-run window has also passed.
    IF (s.retry_kind = 'none' AND p_now >= deadline + s.grace)
       OR (has_log AND l.retried_at IS NOT NULL AND p_now >= l.retried_at + s.grace) THEN
      v_key := 'brain-heartbeat:' || s.stage || ':' || to_char(wk AT TIME ZONE 'UTC', 'YYYY-MM-DD');
      v_body := s.label || ' was due ' || to_char(due AT TIME ZONE 'UTC', 'Dy DD Mon HH24:MI') || ' UTC and has not landed. '
        || CASE WHEN s.retry_kind = 'none' THEN 'It has no automatic re-run, so it failed for this week until someone runs it. '
                ELSE 'The automatic re-run at ' || to_char(l.retried_at AT TIME ZONE 'UTC', 'HH24:MI') || ' UTC failed to land too'
                     || CASE WHEN l.retry_result ->> 'error' IS NOT NULL THEN ' (' || (l.retry_result ->> 'error') || ')' ELSE '' END || '. ' END
        || 'Expected: ' || s.artifact || '.';
      act := 'alert';
      IF NOT p_dry THEN
        SELECT id INTO v_id FROM public.inbox_notifications WHERE dedupe_key = v_key LIMIT 1;
        IF v_id IS NULL THEN
          INSERT INTO public.inbox_notifications(family, source, dedupe_key, incident_key, severity, title, body, url, tenant, group_key, push_result)
          VALUES ('system_watchdog_digest', 'brain-heartbeat', v_key, v_key, 'error',
                  'Brain stage missed: ' || split_part(s.label, ' (', 1), v_body, './#exp/brain-b/ops', NULL, 'brain-heartbeat',
                  jsonb_build_object('skipped', 'feed_only'))
          RETURNING id INTO v_id;
        END IF;
        INSERT INTO public.brain_stage_heartbeat_log(week_start, stage, alerted_at, alert_id)
        VALUES ((wk AT TIME ZONE 'UTC')::date, s.stage, p_now, v_id)
        ON CONFLICT (week_start, stage) DO UPDATE SET alerted_at = EXCLUDED.alerted_at, alert_id = EXCLUDED.alert_id;
      END IF;
      out := out || jsonb_build_object('stage', s.stage, 'state', 'missed', 'action', act, 'alert_id', v_id, 'dedupe_key', v_key, 'body', v_body);
      CONTINUE;
    END IF;
    out := out || jsonb_build_object('stage', s.stage, 'state', 'missed', 'action', 'waiting_on_retry', 'retried_at', l.retried_at);
  END LOOP;
  RETURN jsonb_build_object('ran', true, 'dry', p_dry, 'now', p_now, 'week', wk, 'hold', hold, 'stages', out);
END $function$;

REVOKE ALL ON FUNCTION public.brain_stage_artifact(text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brain_stage_heartbeat(timestamptz, boolean) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('brain-stage-heartbeat', '*/30 * * * 1-3',
  $$set statement_timeout = '600s'; select public.brain_stage_heartbeat()$$);

-- One-time jobs written as yearly schedules (each ran exactly once, on the date in its schedule,
-- with a hard-coded run key). Originals are in 276_brain_stage_heartbeat_rollback.sql.
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN (
  'cb15_outlier_recompute_first', 'cb15_outlier_recompute_a3', 'cb16_recipe_refit_p0', 'cb16_arch_recompute_c4',
  'cb16_recipe_live_check_d14', 'cb38-freeze-1200', 'cb38-freeze-1900', 'cb38-monday-result', 'cb38-monday-result-tue');
