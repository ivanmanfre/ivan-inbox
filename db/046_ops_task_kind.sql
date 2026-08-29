-- 046: ops_drafts kind 'task' (2026-08-29)
--
-- The Ops board becomes Ivan's canonical personal task list. Tasks he dictates to
-- the WhatsApp assistant, and tasks a Claude session writes down for him, land here
-- as first-class cards — never in ClickUp (he does not use it; see the 2026-08-22
-- ruling in project memory).
--
-- Until now a task had to ride a borrowed kind (`manual_invite`) because `kind` is a
-- closed CHECK, and every other kind dispatches something real on approve. `task`
-- dispatches NOTHING: Done double-stamps like weekly_report/manual_invite, Remove
-- discards. Nothing is posted, emailed or sent.
--
-- 🔴 The kind is deliberately absent from the Slack dispatcher's pick list
-- (n8n 4B3D9O9gvAaAWBe2 polls kind IN (escalation, update, booking) only), so a task
-- card can never reach a Slack channel — least of all the client-facing Rise channel
-- that `update` writes to.

alter table public.ops_drafts drop constraint ops_drafts_kind_check;
alter table public.ops_drafts add constraint ops_drafts_kind_check
  check (kind = any (array[
    'escalation'::text, 'update'::text, 'newsjack'::text, 'weekly_report'::text,
    'comment_reply'::text, 'comment_outbound'::text, 'booking'::text,
    'precall_email'::text, 'manual_invite'::text, 'task'::text]));

-- A task has no Slack destination, so it joins the kinds allowed a null channel.
alter table public.ops_drafts drop constraint ops_drafts_slack_channel_required;
alter table public.ops_drafts add constraint ops_drafts_slack_channel_required
  check ((kind = any (array[
    'newsjack'::text, 'weekly_report'::text, 'comment_reply'::text,
    'comment_outbound'::text, 'precall_email'::text, 'manual_invite'::text,
    'task'::text]))
    or slack_channel is not null);
