-- AFTER ACTIVATION, in this order:
--   1. run, and confirm both statements COMMITTED:
--      update integration_config set value='false' where key='swishdm_nurture_armed';
--      update nurture_emails e set is_active=false from nurture_sequences n where n.id=e.sequence_id and n.slug='swishdm_ai_search_report';
--   2. note the time T right after that commit;
--   3. with the guards still installed, wait until EVERY Nurture Sender (n8n 2Vt9Ahcn5GrXh9H1) execution
--      that started at or before T has finished (it runs every 15 min; check its executions list);
--   4. only then run this file (it cancels anything pending and drops the guards).
-- Rollback for 20261105_swishdm_report_nurture.sql.
-- Fast off switch without rollback: update integration_config set value='false' where key='swishdm_nurture_armed';
-- and cancel anything queued:
--   update nurture_queue q set status='cancelled', error_message='swishdm nurture rolled back'
--     from nurture_subscribers s join nurture_sequences n on n.id=s.sequence_id
--    where q.subscriber_id=s.id and n.slug='swishdm_ai_search_report' and q.status='pending';
-- Run 20261105_swishdm_report_nurture_sol_r1_rollback.sql first.
begin;
update nurture_queue q set status = 'cancelled', error_message = 'swishdm nurture rolled back'
  from nurture_subscribers s join nurture_sequences n on n.id = s.sequence_id
 where q.subscriber_id = s.id and n.slug = 'swishdm_ai_search_report' and q.status = 'pending';
drop trigger if exists swishdm_report_nurture_on_status on public.swishdm_lm_requests;
drop function if exists public.swishdm_report_nurture_on_status();
drop function if exists public.swishdm_report_nurture_stop(uuid, text);
drop function if exists public.swishdm_report_nurture_cancel(uuid, text);
drop function if exists public.swishdm_report_nurture_enroll(public.swishdm_lm_requests);
drop function if exists public.swishdm_nurture_armed();
drop function if exists public.swishdm_nurture_seq_id();
-- Sequence rows stay only if someone was ever enrolled (queue/subscriber history); otherwise remove them.
delete from nurture_emails e using nurture_sequences n
 where e.sequence_id = n.id and n.slug = 'swishdm_ai_search_report'
   and not exists (select 1 from nurture_subscribers s where s.sequence_id = n.id);
delete from nurture_sequences n where n.slug = 'swishdm_ai_search_report'
   and not exists (select 1 from nurture_subscribers s where s.sequence_id = n.id);
alter table public.swishdm_lm_requests
  drop constraint if exists swishdm_lm_requests_report_url_check,
  drop constraint if exists swishdm_lm_requests_report_top_gap_check,
  drop constraint if exists swishdm_lm_requests_nurture_state_check,
  drop column if exists nurture_subscriber_id,
  drop column if exists nurture_state,
  drop column if exists report_sent_at,
  drop column if exists report_top_gap,
  drop column if exists report_url;
delete from integration_config where key = 'swishdm_nurture_armed';
commit;
