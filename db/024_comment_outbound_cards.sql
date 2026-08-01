-- Outbound comment drafts as inbox cards (2026-08-01, comment-lane-revamp goal run).
-- Two lanes share one kind:
--   client_id='ivan'    context carries approve_url/skip_url (n8n Comment Approval
--                       Poster webhook links) - approve OPENS the gate URL, the five
--                       n8n gates + jitter still own the actual LinkedIn write.
--   client_id='risedtc' context has NO approve_url - approve is copy + double-stamp
--                       (weekly_report shape). There is NO poster behind this lane;
--                       Ivan hand-posts from Mattan's seat. Arming an auto-poster is
--                       a separate ballot decision, not a migration.
-- The Slack dispatcher (4B3D9O9gvAaAWBe2) filters kind=in.(escalation,update).
-- That filter must not be widened.

alter table public.ops_drafts drop constraint if exists ops_drafts_kind_check;
alter table public.ops_drafts add constraint ops_drafts_kind_check
  check (kind in ('escalation','update','newsjack','weekly_report','comment_reply','comment_outbound'));

alter table public.ops_drafts drop constraint if exists ops_drafts_slack_channel_required;
alter table public.ops_drafts add constraint ops_drafts_slack_channel_required
  check (kind in ('newsjack','weekly_report','comment_reply','comment_outbound') or slack_channel is not null);

-- One card per feed row forever: re-runs never duplicate, a discarded card never
-- resurrects. feed_id = comment_feed.id (ivan lane) / rise_comment_feed.id (risedtc).
create unique index if not exists ops_drafts_comment_outbound_feed
  on public.ops_drafts (client_id, (context->>'feed_id'))
  where kind = 'comment_outbound';
