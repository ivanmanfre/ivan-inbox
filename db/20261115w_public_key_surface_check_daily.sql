-- 20261115w_public_key_surface_check_daily: the catalog check of 20261115s as a function, plus a daily job that
-- writes one row to silent_failures when any check is off its expected value. The Loop Liveness Watchdog (n8n
-- 90QRPEaXxcMmkJYK, daily 08:00 UTC) already flags any silent_failures row of the last 24 hours, so a drift shows up
-- there the same morning. The job runs at 07:30 UTC.
--
-- public_key_surface_check()        read-only, 5 rows, every row must have ok = true. The query is the one from
--                                   20261115s; only the lists and the expected values moved (below).
-- public_key_surface_check_alert()  runs it; when a row is off, inserts one silent_failures row
--                                   (source 'public-key-surface-check', detail = which checks, expected and actual
--                                   counts, the object names). Returns the number of checks that are off, -1 when the
--                                   check itself could not run (that also writes a row).
--
-- Expected after 20261115t (Listener tables closed), 20261115u and v (shared_page_edits behind two functions):
--   92 owner-rights functions the public key may call (the 90 of 20261115s + shared_page_edits_load, _save),
--   0 views where anon holds any privilege,
--   0 tables with row level security off where anon holds any privilege,
--   2 row policies that let anon through with no condition (pageviews insert, recording_comments insert),
--   0 anon privileges on the 5 tables closed today (the 4 Listener tables + shared_page_edits).
-- When something is made public on purpose: CREATE OR REPLACE public_key_surface_check() with the new list in the
-- same PR. Manual run: db/20261115s_public_key_surface_check.sql (now a call of this function).
-- The functions are invoker-rights and closed to anon and authenticated; search_path stays public so the function
-- signatures read as in the list (regprocedure prints the schema when it is not on the path).
-- Rollback: 20261115w_public_key_surface_check_daily_rollback.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.public_key_surface_check()
RETURNS TABLE (check_name text, expected integer, actual integer, ok boolean, not_expected text, missing text)
LANGUAGE sql STABLE SET search_path = public, pg_catalog
AS $fn$
WITH allowed_fn(sig) AS (
  SELECT unnest(ARRAY[
    'board_activity(text,text,text,timestamp with time zone,uuid)',
    'board_comment_add(text,text,text,text,text)', 'board_comment_add_v2(text,text,text,text,text,text[])',
    'board_comment_resolve(text,text,boolean,text)', 'board_comments_list(text,text,text)',
    'board_comments_list_v2(text,text,text)', 'board_photo_added(text,text,text,text,text)',
    'board_photo_operation(text,text,text,text,uuid,text,text,text)', 'board_slot_notes(text,jsonb,text,text)',
    'board_team_add(text,text,text,text)', 'board_team_add_v2(text,text,text,text,text,text)',
    'board_team_list(text,text,text)', 'board_team_remove(text,text,text,text)',
    'board_team_set_role(text,text,text,text,text)', 'board_track(text,jsonb,text,text)',
    'cb35_plugin_finish(text,bigint,text,integer)', 'cb35_plugin_freeze_v1(text,uuid)',
    'cb35_plugin_import_v1(text,jsonb)', 'cb35_plugin_read(text,text,integer,jsonb)',
    'cb35_plugin_snapshot_v1(text,text,integer)', 'cb35_plugin_usage(text,text,text,boolean,text,integer)',
    'cb35_plugin_watermark_v1(text,uuid,bigint,timestamp with time zone)',
    'client_board_action(text,text,text,text,jsonb)', 'client_board_action_v2(text,text,text,text,jsonb)',
    'client_board_archive_draft(text,text,uuid,boolean)',
    'client_board_archive_draft_v2(text,text,uuid,boolean)', 'client_board_audience(text,text)',
    'client_board_audience_decide(text,text,text,text,text)',
    'client_board_audience_decide_v2(text,text,text,text,text)', 'client_board_audience_v2(text,text)',
    'client_board_draft_history(text,text,text)', 'client_board_draft_history_v2(text,text,text)',
    'client_board_edit_draft(text,text,uuid,text)', 'client_board_edit_draft_v2(text,text,uuid,text,text)',
    'client_board_edit_lm_promo(text,text,text,text,jsonb)',
    'client_board_edit_lm_promo_v2(text,text,text,text,jsonb)', 'client_board_edit_title(text,text,uuid,text)',
    'client_board_edit_title_v2(text,text,uuid,text)', 'client_board_funnel_signals(text,text)',
    'client_board_funnel_signals_v2(text,text)', 'client_board_hide_draft(text,text,uuid)',
    'client_board_hide_draft_v2(text,text,uuid)', 'client_board_outreach_log(text,text)',
    'client_board_outreach_log_v2(text,text)', 'client_board_outreach_status(text,text)',
    'client_board_outreach_status_v2(text,text)', 'client_board_outreach_usage(text,text)',
    'client_board_outreach_usage_v2(text,text)', 'client_board_post_people(text,text)',
    'client_board_post_people_v2(text,text)', 'client_board_post_viewers(text,text)',
    'client_board_post_viewers_v2(text,text)', 'client_board_public_brand(text)',
    'client_board_replacement_pool(text,text)', 'client_board_replacement_pool_v2(text,text)',
    'client_board_reply_source(text,text,uuid)', 'client_board_reply_source_v2(text,text,uuid)',
    'client_board_reply_sources(text,text,integer)', 'client_board_reply_sources_v2(text,text,integer)',
    'client_board_report(text,text)', 'client_board_report_v2(text,text)', 'client_board_schedule(text,text)',
    'client_board_schedule_v2(text,text)', 'client_board_set_media(text,text,uuid,text)',
    'client_board_set_media_v2(text,text,uuid,text)',
    'client_board_set_schedule(text,text,uuid,timestamp with time zone)',
    'client_board_set_schedule_v2(text,text,uuid,timestamp with time zone)',
    'client_board_slot_state(text,text)', 'client_board_slot_state_v2(text,text)',
    'client_plan_review_load(text)', 'client_plan_review_save(text,integer,jsonb,text)',
    'dtc_comparison_visible(text,uuid)', 'get_board_team(text,text)', 'get_client_board(text,text)',
    'get_client_board_by_session(text,text)', 'invite_board_member(text,text,text)',
    'ios_drip_page(text,text)', 'ios_drip_track(text,text,text,smallint,text,text,text,text,text)',
    'log_outreach_click(text,text,text,text)', 'outlier_gold_label_save(text,text,text,text,text,text)',
    'outlier_gold_progress(text)', 'outside_health(text)', 'peer_scan_track(text,text,jsonb,jsonb)',
    'public_engine_metrics()', 'recent_own_posts(integer)', 'recording_is_public(uuid)',
    'recording_view_by_token(text)', 'redeem_board_login(text,text,text)', 'rise_scan_link_list(text)',
    'rise_scan_link_submit(text,text)', 'shared_page_edits_load(text)',
    'shared_page_edits_save(text,text,text)'
  ]::text[])
), allowed_pol(sig) AS (
  -- table.policy|command|roles|USING|WITH CHECK
  SELECT unnest(ARRAY[
    'pageviews.pageviews_anon_insert|a|anon,authenticated||true',
    'recording_comments.anon_insert_comments|a|anon||true'
  ]::text[])
), allowed_col(sig) AS (
  -- table.column:privilege
  SELECT unnest(ARRAY[]::text[])
), fn AS (
  SELECT p.oid::regprocedure::text AS sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')
), rel AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity,
         (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
          OR has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')) AS anon_any
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
), vw AS (
  SELECT relname FROM rel WHERE relkind IN ('v', 'm') AND anon_any
), norls AS (
  SELECT relname FROM rel WHERE relkind IN ('r', 'p') AND NOT relrowsecurity AND anon_any
), pol_raw AS (
  SELECT c.relname, p.polname, p.polcmd::text AS cmd,
         (SELECT string_agg(coalesce(r.rolname, 'PUBLIC'), ',' ORDER BY coalesce(r.rolname, 'PUBLIC'))
            FROM unnest(p.polroles) u(o) LEFT JOIN pg_roles r ON r.oid = u.o) AS roles,
         pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS w
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND p.polpermissive
    -- the policy reaches anon when it names PUBLIC, anon, or any role anon is a member of (inherited)
    AND EXISTS (SELECT 1 FROM unnest(p.polroles) u(o) WHERE u.o = 0 OR pg_has_role('anon', u.o, 'USAGE'))
), pol AS (
  -- no condition for at least one command: rows it can read, change or remove (USING true), or rows it can add or
  -- write back (WITH CHECK true; an UPDATE or ALL policy with no WITH CHECK uses its USING)
  SELECT relname || '.' || polname || '|' || cmd || '|' || roles || '|' || coalesce(q, '') || '|' || coalesce(w, '') AS sig
  FROM pol_raw
  WHERE (cmd IN ('r', 'd', 'w', '*') AND q = 'true')
     OR (cmd = 'a' AND w = 'true')
     OR (cmd IN ('w', '*') AND coalesce(w, q) = 'true')
), lcol AS (
  SELECT c.relname || '.' || a.attname || ':' || pr.p AS sig
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) pr(p)
  WHERE n.nspname = 'public' AND c.relname IN ('transcripts', 'audience_audits', 'calendar_events', 'sales_scripts', 'shared_page_edits')
    AND has_column_privilege('anon', c.oid, a.attnum, pr.p)
  UNION ALL
  SELECT c.relname || '.(whole table):' || pr.p
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('DELETE'), ('TRUNCATE'), ('TRIGGER'), ('MAINTAIN')) pr(p)
  WHERE n.nspname = 'public' AND c.relname IN ('transcripts', 'audience_audits', 'calendar_events', 'sales_scripts', 'shared_page_edits')
    AND has_table_privilege('anon', c.oid, pr.p)
)
SELECT 'owner-rights functions the public key may call' AS check_name, 92 AS expected, (SELECT count(*) FROM fn)::int AS actual,
       NOT EXISTS (SELECT 1 FROM fn WHERE sig NOT IN (SELECT sig FROM allowed_fn))
         AND NOT EXISTS (SELECT 1 FROM allowed_fn WHERE sig NOT IN (SELECT sig FROM fn)) AS ok,
       (SELECT coalesce(string_agg(sig, ', ' ORDER BY sig), '') FROM fn WHERE sig NOT IN (SELECT sig FROM allowed_fn)) AS not_expected,
       (SELECT coalesce(string_agg(sig, ', ' ORDER BY sig), '') FROM allowed_fn WHERE sig NOT IN (SELECT sig FROM fn)) AS missing
UNION ALL
SELECT 'views where anon holds any privilege', 0, (SELECT count(*) FROM vw)::int, NOT EXISTS (SELECT 1 FROM vw),
       (SELECT coalesce(string_agg(relname, ', ' ORDER BY relname), '') FROM vw), ''
UNION ALL
SELECT 'tables with row level security off where anon holds any privilege', 0, (SELECT count(*) FROM norls)::int, NOT EXISTS (SELECT 1 FROM norls),
       (SELECT coalesce(string_agg(relname, ', ' ORDER BY relname), '') FROM norls), ''
UNION ALL
SELECT 'row policies that let anon through with no condition', 2, (SELECT count(*) FROM pol)::int,
       NOT EXISTS (SELECT 1 FROM pol WHERE sig NOT IN (SELECT sig FROM allowed_pol))
         AND NOT EXISTS (SELECT 1 FROM allowed_pol WHERE sig NOT IN (SELECT sig FROM pol)),
       (SELECT coalesce(string_agg(sig, ', ' ORDER BY sig), '') FROM pol WHERE sig NOT IN (SELECT sig FROM allowed_pol)),
       (SELECT coalesce(string_agg(sig, ', ' ORDER BY sig), '') FROM allowed_pol WHERE sig NOT IN (SELECT sig FROM pol))
UNION ALL
SELECT 'anon privileges on the 5 closed tables (column and table level)', 0, (SELECT count(*) FROM lcol)::int,
       NOT EXISTS (SELECT 1 FROM lcol WHERE sig NOT IN (SELECT sig FROM allowed_col))
         AND NOT EXISTS (SELECT 1 FROM allowed_col WHERE sig NOT IN (SELECT sig FROM lcol)),
       (SELECT coalesce(string_agg(sig, ', ' ORDER BY sig), '') FROM lcol WHERE sig NOT IN (SELECT sig FROM allowed_col)),
       (SELECT coalesce(string_agg(sig, ', ' ORDER BY sig), '') FROM allowed_col WHERE sig NOT IN (SELECT sig FROM lcol))
$fn$;

CREATE FUNCTION public.public_key_surface_check_alert()
RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_catalog
AS $fn$
DECLARE
  n integer;
  bad jsonb;
BEGIN
  BEGIN
    SELECT count(*)::int,
           jsonb_agg(jsonb_build_object('check', c.check_name, 'expected', c.expected, 'actual', c.actual,
                                        'not_expected', left(c.not_expected, 2000), 'missing', left(c.missing, 2000))
                     ORDER BY c.check_name)
      INTO n, bad
      FROM public.public_key_surface_check() c
     WHERE c.ok IS NOT TRUE;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.silent_failures (source, detail)
    VALUES ('public-key-surface-check',
            jsonb_build_object('message', 'the public-key surface check could not run', 'error', left(SQLERRM, 500)));
    RETURN -1;
  END;
  IF n > 0 THEN
    INSERT INTO public.silent_failures (source, detail)
    VALUES ('public-key-surface-check',
            jsonb_build_object(
              'message', format('%s of 5 public-key surface checks off the expected value: %s', n,
                                (SELECT string_agg(format('%s (expected %s, actual %s)', e->>'check', e->>'expected', e->>'actual'), '; ')
                                   FROM jsonb_array_elements(bad) e)),
              'failed', bad,
              'what_to_do', 'not_expected = there but not on the list, missing = on the list but gone. Close the object to anon, or add it to the list in public_key_surface_check() if it is public on purpose.'));
  END IF;
  RETURN n;
END
$fn$;

REVOKE ALL ON FUNCTION public.public_key_surface_check() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_key_surface_check_alert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_key_surface_check() TO service_role;
GRANT EXECUTE ON FUNCTION public.public_key_surface_check_alert() TO service_role;

SELECT cron.schedule('public-key-surface-check', '30 7 * * *', $cron$select public.public_key_surface_check_alert()$cron$);

COMMIT;
