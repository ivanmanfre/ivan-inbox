-- Rollback for db/20261126b_inbox_report_opens.sql: the function is new, so dropping it restores the old state.
drop function if exists public.inbox_report_opens();
