-- Rollback for 20261117r_cp17_calendar_panel.sql: removes the read function only.
begin;
drop function if exists public.cp17_calendar_panel_ivan();
commit;
