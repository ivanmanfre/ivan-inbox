-- 029: Booked-call cards in the Ops lane (2026-08-06)
--
-- A seventh kind: `booking`. Written by the RISE LinkedIn Booking watcher
-- (n8n helJXFCyt2phq5V3) the moment someone books off Mattan's --li page.
--
-- Unlike newsjack / weekly_report / the comment kinds, this one IS Slack-bound and
-- goes out through the normal dispatcher (4B3D9O9gvAaAWBe2). Ivan approves in the
-- inbox, the dispatcher posts to the Rise client channel ~2 minutes later. That is
-- the same contract escalation/update already have, which is why the dispatcher
-- filter is widened to escalation/update/booking and no further: every OTHER kind
-- in this table is deliberately Slack-less and must stay that way.
--
-- Column reuse on this kind:
--   slack_channel       -> C0BJ72F58BY (the Rise client channel; NOT NULL for this kind)
--   body                -> "New call booked from outbound with X (Co). <when>.
--                           Pre-call brief here: <url>" - editable before approve
--   context             -> {meeting_id, prospect_name, company, domain, when_iso,
--                           when_str, brief_url, scan_url, booked_note, hubspot_url,
--                           matched_prospect, stamped}
--   approved_at         -> Ivan approved; the dispatcher takes it from here
--   sent_at             -> stamped by the dispatcher ONLY, never by the app
--   send_blocked_reason -> dispatcher failure, or an operator discard

alter table public.ops_drafts drop constraint if exists ops_drafts_kind_check;
alter table public.ops_drafts add constraint ops_drafts_kind_check
  check (kind in ('escalation','update','newsjack','weekly_report',
                  'comment_reply','comment_outbound','booking'));

-- booking needs a destination; the Slack-less kinds keep their exemption.
alter table public.ops_drafts drop constraint if exists ops_drafts_slack_channel_required;
alter table public.ops_drafts add constraint ops_drafts_slack_channel_required
  check (kind in ('newsjack','weekly_report','comment_reply','comment_outbound')
         or slack_channel is not null);

-- One card per HubSpot meeting forever. The watcher re-reads a 15-minute window and
-- a cursor rewind replays it, so without this a single booking could stack cards -
-- or worse, resurrect one Ivan already discarded.
create unique index if not exists ops_drafts_booking_meeting_idx
  on public.ops_drafts (client_id, (context->>'meeting_id'))
  where kind = 'booking';
