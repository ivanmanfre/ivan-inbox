-- 022: RISE comment reply cards in the Ops lane (2026-07-30)
--
-- A fifth kind joins escalation/update/newsjack/weekly_report: `comment_reply`.
-- Someone commented on the client's own LinkedIn post; rise-comment-intel
-- classified it and this card puts it in front of Ivan.
--
-- Like weekly_report, NOTHING dispatches these. The comment system is read-only
-- against LinkedIn by design: the card hands over the reply text, a human posts
-- it. The Slack dispatcher (4B3D9O9gvAaAWBe2) is filtered to escalation/update,
-- so it can never pick these up. That filter must not be widened.
--
-- Column reuse on this kind:
--   body                -> the reply to post (empty on an escalate card, where
--                          the point is that Mattan answers in his own words)
--   context             -> {comment_id, post_url, author_name, author_headline,
--                           comment_text, category, action, posted_at}
--   approved_at         -> Ivan took the reply
--   sent_at             -> stamped at the same moment: he IS the sender, and a
--                          null here would strand the card in "Working" forever
--   send_blocked_reason -> operator discard only

alter table ops_drafts drop constraint if exists ops_drafts_kind_check;
alter table ops_drafts add constraint ops_drafts_kind_check
  check (kind in ('escalation', 'update', 'newsjack', 'weekly_report', 'comment_reply'));

-- newsjack, weekly_report and comment_reply have no Slack destination.
alter table ops_drafts drop constraint if exists ops_drafts_slack_channel_required;
alter table ops_drafts add constraint ops_drafts_slack_channel_required
  check (kind in ('newsjack', 'weekly_report', 'comment_reply') or slack_channel is not null);

-- One card per comment, forever. The writer re-runs on every pull cycle and
-- must update the row it already wrote rather than stacking duplicates.
create unique index if not exists ops_drafts_comment_reply_idx
  on ops_drafts (client_id, (context ->> 'comment_id'))
  where kind = 'comment_reply';
