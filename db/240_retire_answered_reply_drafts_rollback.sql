drop trigger if exists retire_answered_reply_drafts_ins on public.outreach_messages;
drop trigger if exists retire_answered_reply_drafts_upd on public.outreach_messages;
drop function if exists public.retire_answered_reply_drafts();
-- Bring back what it retired:
-- update public.outreach_messages set send_blocked_reason = null, send_blocked_at = null, discard_mode = null
--  where discard_mode = 'answered_by_send' and sent_at is null and approved_at is null;
