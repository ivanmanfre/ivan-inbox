-- AFTER ACTIVATION, in this order:
--   1. run, and confirm both statements COMMITTED:
--      update integration_config set value='false' where key='swishdm_nurture_armed';
--      update nurture_emails e set is_active=false from nurture_sequences n where n.id=e.sequence_id and n.slug='swishdm_ai_search_report';
--   2. note the time T right after that commit;
--   3. with the guards still installed, wait until EVERY Nurture Sender (n8n 2Vt9Ahcn5GrXh9H1) execution
--      that started at or before T has finished (it runs every 15 min; check its executions list);
--   4. only then run this file (it cancels anything pending and drops the guards).
-- Undo the Sol r1 layer only. Then re-apply 20261105_swishdm_report_nurture.sql (idempotent) to get the base hook back.
-- Full removal: run this, then 20261105_swishdm_report_nurture_rollback.sql.
begin;
drop trigger if exists swishdm_nurture_on_email_off on public.nurture_emails;
drop trigger if exists swishdm_nurture_on_disarm on public.integration_config;
drop trigger if exists swishdm_nurture_queue_guard on public.nurture_queue;
drop trigger if exists swishdm_report_nurture_after_status on public.swishdm_lm_requests;
drop function if exists public.swishdm_nurture_on_email_off();
drop function if exists public.swishdm_nurture_on_disarm();
drop function if exists public.swishdm_nurture_cancel_pending(uuid, text);
drop function if exists public.swishdm_nurture_queue_guard();
drop function if exists public.swishdm_report_nurture_after_status();
commit;
