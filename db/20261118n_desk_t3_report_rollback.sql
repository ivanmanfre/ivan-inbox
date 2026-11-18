-- Rollback for 20261118n_desk_t3_report.sql (new function, nothing else reads it).
drop function if exists public.desk_t3_report(uuid, text, text, text, text, text);
