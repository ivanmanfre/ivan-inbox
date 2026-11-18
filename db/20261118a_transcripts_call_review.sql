-- After-call review for Ivan's own sales calls (2026-11-18).
-- Written by the Mac job ~/.claude-resident/call-review (service role), read by the Sales call card.
-- Shape (v1): { v, reviewed_at, model, script_version, call_kind, call_kind_reason,
--   items[{id,label,status,quote}], missed_follow_ups[{buyer_quote,what_ivan_did,better_question}],
--   next_step{booked,when,everyone_who_decides,quote,note}, next_call[], talk{ivan_pct,longest_run_words,longest_run_at_pct},
--   unverified_dropped }  or  { v, status: 'skipped'|'failed', reason }.
-- Additive and nullable; rollback: db/20261118a_transcripts_call_review_rollback.sql
alter table public.transcripts add column if not exists call_review jsonb;
comment on column public.transcripts.call_review is 'After-call review against the active discovery script (Mac job call-review). Null = not reviewed yet.';
