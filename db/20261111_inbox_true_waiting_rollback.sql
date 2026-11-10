-- Rollback for 20261111_inbox_true_waiting.sql. Nothing depends on the function except the Stalled Conversation Bump
-- digest block once it is patched to call it: restore the previous workflow version first (see APPLY), then run this.
drop function if exists public.inbox_true_waiting(text);
