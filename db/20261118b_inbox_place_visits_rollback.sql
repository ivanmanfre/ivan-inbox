-- Rollback of 20261118b_inbox_place_visits.sql: removes the RPC and the table (its policies, index and identity
-- sequence go with it). The visit rows are lost; nothing else reads them.
begin;
drop function if exists public.inbox_log_visit(text, text, text);
drop table if exists public.inbox_place_visits;
commit;
