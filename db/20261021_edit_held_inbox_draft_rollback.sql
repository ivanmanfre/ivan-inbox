-- Rollback for 20261021_edit_held_inbox_draft.sql: the function is new, so rollback removes it.
-- No existing function was replaced (send_rejected_inbox_draft, schedule_inbox_dm untouched).
DROP FUNCTION IF EXISTS public.edit_held_inbox_draft(uuid, text, text, text, timestamp with time zone, timestamp with time zone, jsonb);
