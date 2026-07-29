-- 021: Client weekly report approval cards in the Ops lane (2026-07-29)
--
-- A fourth kind joins escalation/update/newsjack: `weekly_report`. Like newsjack
-- these are NOT Slack-bound, and unlike every other kind NOTHING dispatches them:
-- Ivan sends the report to the client himself. The card exists to put the week in
-- front of him, let him read the page, and hand him the message to paste.
--
-- The Slack dispatcher (4B3D9O9gvAaAWBe2) is filtered to escalation/update, so it
-- can never pick these up. That filter must not be widened.
--
-- Column reuse on this kind:
--   body                -> the message Ivan pastes to the client, editable first
--   context             -> {week, report_url, invites, accepted, replied,
--                           calls_booked, impressions, engagers, moved}
--   approved_at         -> Ivan approved and took the message
--   sent_at             -> stamped at the same moment, because he IS the sender.
--                          Any other kind waits for a dispatcher to stamp this;
--                          leaving it null here would strand the card in the
--                          "Working" group forever waiting for a writer that
--                          does not exist.
--   send_blocked_reason -> operator discard only

alter table ops_drafts drop constraint if exists ops_drafts_kind_check;
alter table ops_drafts add constraint ops_drafts_kind_check
  check (kind in ('escalation', 'update', 'newsjack', 'weekly_report'));

-- Neither newsjack nor weekly_report has a Slack destination.
alter table ops_drafts drop constraint if exists ops_drafts_slack_channel_required;
alter table ops_drafts add constraint ops_drafts_slack_channel_required
  check (kind in ('newsjack', 'weekly_report') or slack_channel is not null);

-- One card per client per week. A re-run of the Sunday build updates the row it
-- already wrote rather than stacking a second card on the same week.
create unique index if not exists ops_drafts_weekly_report_week_idx
  on ops_drafts (client_id, (context ->> 'week'))
  where kind = 'weekly_report';
