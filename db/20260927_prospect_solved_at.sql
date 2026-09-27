-- 2026-09-27 (Ivan: "sometimes I don't want to answer... just say Mark as solved").
-- A thread whose last message is theirs counts as a reply owed. solved_at records Ivan's
-- ruling that it needs no answer; the inbox treats the thread as settled while solved_at is
-- newer than their last message, so a NEW inbound brings it back by itself. Additive and
-- nullable: no reader of outreach_prospects changes, no view changes.
alter table public.outreach_prospects add column if not exists solved_at timestamptz;
comment on column public.outreach_prospects.solved_at is 'Set by the inbox "Mark as solved": Ivan ruled the thread needs no answer. Superseded by any newer inbound.';
