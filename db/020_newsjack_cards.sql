-- 020: Newsjack approval cards in the Ops lane (2026-07-27)
--
-- A third kind joins escalation/update: `newsjack`. These are NOT Slack-bound —
-- approving one fires generation and claims the next publish slot on the matching
-- engine (Ivan's own feed or the Rise client queue), pushing the incumbent post to
-- the next open slot. The Slack dispatcher (4B3D9O9gvAaAWBe2) is filtered to
-- escalation/update so it can never pick these up; the slot-claim workflow owns them.
--
-- Column reuse on this kind:
--   body                -> the editable ANGLE the generator will write from
--   context             -> {engine, idea_id, headline, source_url, expires_at, draft_id, slot...}
--   approved_at         -> Ivan tapped approve in the inbox (intent recorded)
--   sent_at             -> the slot swap actually executed
--   send_blocked_reason -> generation/QA failed, weekly cap hit, or TTL expired

alter table ops_drafts drop constraint if exists ops_drafts_kind_check;
alter table ops_drafts add constraint ops_drafts_kind_check
  check (kind in ('escalation', 'update', 'newsjack'));

-- Newsjack cards have no Slack destination; every other kind still requires one.
alter table ops_drafts alter column slack_channel drop not null;
alter table ops_drafts drop constraint if exists ops_drafts_slack_channel_required;
alter table ops_drafts add constraint ops_drafts_slack_channel_required
  check (kind = 'newsjack' or slack_channel is not null);

-- The slot-claim workflow polls on (kind, approved_at, sent_at); keep it cheap.
create index if not exists ops_drafts_newsjack_pending_idx
  on ops_drafts (kind, approved_at)
  where kind = 'newsjack' and sent_at is null and send_blocked_reason is null;

-- One queue-jump per engine per week is enforced in the workflow, not here, so the
-- cap can be reasoned about alongside the slot policy it protects.
