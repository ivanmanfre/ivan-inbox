-- 20261115s_public_key_surface_check: read-only catalog check of what the public (anon) key can reach in schema
-- public. It changes nothing. Every row must come back with ok = true; a false row names the objects to look at
-- (not_expected = there but not on the list, missing = on the list but gone).
--
-- Why it exists: the default privileges for postgres in public still grant every new table, view, sequence and
-- function to anon and authenticated, and every new function to PUBLIC. They are left as they are on purpose: 43 of
-- the 89 functions that were public on purpose (client boards, scan links) and 207 of the 550 functions the signed-in
-- apps call reach their role only through that default, and migrations in personal-site and ivan-inbox keep creating
-- functions that way, so changing the default would silently break the next client-board function. The cost of
-- keeping it: a DROP + CREATE of a function or view, or a new one, comes back open to the public key unless the
-- migration ends with its own REVOKE. This check catches that.
--
-- Run it: after every migration that creates, drops or re-creates a function, view or table in public, or changes a
-- policy or a grant (paste the result into the PR). It should also run once a day as a pg_cron job on the watchdog
-- path (the lane_stall_watchdog pattern), one row with ok = false being the alert. That daily job is not wired yet:
-- until it is, this is a manual check.
--
-- Expected on 2026-11-15, after 20261115a-r:
--   90 owner-rights functions the public key may call (the 89 kept on purpose + recording_is_public), by signature,
--   0 views or materialized views where anon holds any privilege, table-wide or on a column,
--   0 tables with row level security off where anon holds any privilege, table-wide or on a column,
--   9 row policies that let anon through with no condition for at least one command, on 7 tables (4 read by Ivan
--     Listener, 3 written by public pages), compared by name, command, roles and expressions,
--   on the 4 Listener tables: anon holds SELECT on 24 named columns and nothing else.
-- All privilege tests are effective ones (has_*_privilege), so a grant through PUBLIC or an inherited role counts.
-- When something is made public on purpose, add it to the list below in the same PR.
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
    'rise_scan_link_submit(text,text)'
  ]::text[])
), allowed_pol(sig) AS (
  -- table.policy|command|roles|USING|WITH CHECK
  SELECT unnest(ARRAY[
    'audience_audits.anon_select|r|anon|true|', 'calendar_events.anon_select_calendar_events|r|anon|true|',
    'pageviews.pageviews_anon_insert|a|anon,authenticated||true',
    'recording_comments.anon_insert_comments|a|anon||true', 'sales_scripts.anon_read_scripts|r|anon|true|',
    'shared_page_edits.anon_read|r|anon|true|', 'shared_page_edits.anon_update|w|anon|true|true',
    'shared_page_edits.anon_write|a|anon||true', 'transcripts.anon_select|r|anon|true|'
  ]::text[])
), allowed_col(sig) AS (
  -- table.column:privilege
  SELECT unnest(ARRAY[
    'audience_audits.audited_at:SELECT', 'audience_audits.onepager_url:SELECT',
    'audience_audits.prospect_name:SELECT', 'calendar_events.attendees:SELECT',
    'calendar_events.end_time:SELECT', 'calendar_events.id:SELECT', 'calendar_events.is_all_day:SELECT',
    'calendar_events.meeting_type:SELECT', 'calendar_events.meeting_url:SELECT',
    'calendar_events.platform:SELECT', 'calendar_events.start_time:SELECT', 'calendar_events.title:SELECT',
    'sales_scripts.id:SELECT', 'sales_scripts.is_active:SELECT', 'sales_scripts.meeting_type:SELECT',
    'sales_scripts.name:SELECT', 'sales_scripts.phases:SELECT', 'sales_scripts.version:SELECT',
    'transcripts.date:SELECT', 'transcripts.duration_minutes:SELECT', 'transcripts.id:SELECT',
    'transcripts.meeting_type:SELECT', 'transcripts.participants:SELECT', 'transcripts.title:SELECT'
  ]::text[])
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
    AND (p.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'anon')] OR p.polroles @> ARRAY[0::oid])
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
  WHERE n.nspname = 'public' AND c.relname IN ('transcripts', 'audience_audits', 'calendar_events', 'sales_scripts')
    AND has_column_privilege('anon', c.oid, a.attnum, pr.p)
  UNION ALL
  SELECT c.relname || '.(whole table):' || pr.p
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('DELETE'), ('TRUNCATE'), ('TRIGGER'), ('MAINTAIN')) pr(p)
  WHERE n.nspname = 'public' AND c.relname IN ('transcripts', 'audience_audits', 'calendar_events', 'sales_scripts')
    AND has_table_privilege('anon', c.oid, pr.p)
)
SELECT 'owner-rights functions the public key may call' AS check_name, 90 AS expected, (SELECT count(*) FROM fn)::int AS actual,
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
SELECT 'row policies that let anon through with no condition', 9, (SELECT count(*) FROM pol)::int,
       NOT EXISTS (SELECT 1 FROM pol WHERE sig NOT IN (SELECT sig FROM allowed_pol))
         AND NOT EXISTS (SELECT 1 FROM allowed_pol WHERE sig NOT IN (SELECT sig FROM pol)),
       (SELECT coalesce(string_agg(sig, ', ' ORDER BY sig), '') FROM pol WHERE sig NOT IN (SELECT sig FROM allowed_pol)),
       (SELECT coalesce(string_agg(sig, ', ' ORDER BY sig), '') FROM allowed_pol WHERE sig NOT IN (SELECT sig FROM pol))
UNION ALL
SELECT 'anon privileges on the 4 Listener tables (column and table level)', 24, (SELECT count(*) FROM lcol)::int,
       NOT EXISTS (SELECT 1 FROM lcol WHERE sig NOT IN (SELECT sig FROM allowed_col))
         AND NOT EXISTS (SELECT 1 FROM allowed_col WHERE sig NOT IN (SELECT sig FROM lcol)),
       (SELECT coalesce(string_agg(sig, ', ' ORDER BY sig), '') FROM lcol WHERE sig NOT IN (SELECT sig FROM allowed_col)),
       (SELECT coalesce(string_agg(sig, ', ' ORDER BY sig), '') FROM allowed_col WHERE sig NOT IN (SELECT sig FROM lcol));
