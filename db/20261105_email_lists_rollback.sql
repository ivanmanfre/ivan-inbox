-- Rollback for 20261105_email_lists.sql (read-only RPC; nothing else depends on it but the Sales > Email page).
drop function if exists public.inbox_email_lists();
drop function if exists public._email_is_own(text);
