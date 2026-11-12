-- Rollback of 20261112c_content_result_alerts.sql: the cron job first (so no run starts mid-rollback), then the
-- functions, then the tables. Notifications already written to inbox_notifications (families content_result and
-- prospect_engaged) stay as history. The kill switch row (integration_config content_result_alerts), if one was
-- added by hand, is left alone.
select cron.unschedule('content-result-alerts') where exists (select 1 from cron.job where jobname = 'content-result-alerts');

drop function if exists public.content_result_alerts_run(timestamptz);
drop function if exists public.content_alert_post(jsonb);
drop function if exists public.prospect_engaged_url(uuid, boolean, text);
drop function if exists public.prospect_engaged_payload(uuid, text, text, text, text, numeric, text, text, uuid, boolean, text);
drop function if exists public.content_result_payload(text, int, numeric, int, text, timestamptz, text, text);
drop function if exists public.prospect_engaged_candidates(timestamptz, timestamptz);
drop function if exists public.prospect_engaged_block(uuid, text, text, timestamptz);
drop function if exists public.prospect_engaged_ivan_prospects(uuid, text, text);
drop function if exists public.prospect_engaged_closed(uuid, timestamptz);
drop function if exists public.content_result_candidates(timestamptz);
drop function if exists public.content_alert_posts();
drop function if exists public.content_alert_figure(bigint);
drop function if exists public.content_alert_name(text);
drop function if exists public.content_alert_first_line(text);
drop function if exists public.content_alert_cut(text, int);
drop function if exists public.content_alert_off();
drop table if exists public.content_alert_state;
drop table if exists public.prospect_engaged_alerts;
drop table if exists public.content_result_alerts;
