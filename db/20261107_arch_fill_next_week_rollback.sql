-- Rollback for db/20261107_arch_fill_next_week.sql. Drops the new functions only; rows written by a fill stay
-- (they are ordinary approve/undo_approve rows and dates; use arch_fill_undo before rolling back if needed).
drop trigger if exists arch_fill_body_changed on public.carousel_drafts;
drop function if exists public.tg_arch_fill_body_changed();
drop function if exists public.arch_fill_undo(text, uuid);
drop function if exists public.arch_fill_commit(text, uuid, jsonb);
drop function if exists public.arch_fill_read(text);
drop function if exists public.arch_fill_check(uuid);
drop function if exists public.arch_fill_week(timestamptz);
drop trigger if exists arch_approval_order on public.client_board_actions;
drop function if exists public.tg_arch_approval_order();
drop function if exists public.arch_fill_slot_hm();
drop function if exists public.arch_rework_overlap(text, text);
drop function if exists public.arch_rework_tokens(text);
