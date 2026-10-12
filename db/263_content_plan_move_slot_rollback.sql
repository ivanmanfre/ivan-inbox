-- Rollback for db/263: the function is new (no earlier body to restore), so rollback removes it.
-- No data is touched: slots already moved keep the week they were moved to.
drop function if exists public.content_plan_move_slot(text, uuid, date);
