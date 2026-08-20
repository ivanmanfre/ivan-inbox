-- 038: ops_drafts kind 'manual_invite' (2026-08-21)
--
-- Mattan hand-sends calendar invites for bookings arranged inside engine threads
-- (Stefan/Vivi Labs 08-20). Those land in HubSpot as BIDIRECTIONAL_SYNC, which the
-- attribution tracker excludes by design, so they can never auto-attribute. The
-- tracker's new detector section flags each one as an ops card of this kind; Ivan
-- stamps booking_attributions + call_booked_at by hand and marks the card handled.
-- No dispatcher behind this kind: approve double-stamps like weekly_report.

alter table public.ops_drafts drop constraint ops_drafts_kind_check;
alter table public.ops_drafts add constraint ops_drafts_kind_check
  check (kind = any (array[
    'escalation'::text, 'update'::text, 'newsjack'::text, 'weekly_report'::text,
    'comment_reply'::text, 'comment_outbound'::text, 'booking'::text,
    'precall_email'::text, 'manual_invite'::text]));

-- manual_invite never posts to Slack, so it joins the kinds that may carry a
-- null slack_channel.
alter table public.ops_drafts drop constraint ops_drafts_slack_channel_required;
alter table public.ops_drafts add constraint ops_drafts_slack_channel_required
  check ((kind = any (array[
    'newsjack'::text, 'weekly_report'::text, 'comment_reply'::text,
    'comment_outbound'::text, 'precall_email'::text, 'manual_invite'::text]))
    or slack_channel is not null);
