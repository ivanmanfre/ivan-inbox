-- 214 · Per-campaign performance for the Lanes home (rebuild, blueprint v3).
-- One row per non-archived campaign: invitations and messages in the last 7
-- days, people who replied (and how many positively), calls booked in 30 days,
-- the 72-hour accept rate over invitations old enough to judge, and the last
-- send. Read-only and additive; nothing else reads it.
--
-- "Messages" = every outbound after the invitation (DM, InMail, email, hand
-- replies), deduplicated on (person, text, time) like inbox_campaign_sends_v.
-- "Replied" = distinct people with an inbound row in the window, vendor
-- pitches excluded (same set as the blueprint's "70 replied this week").
-- Ran 0.9 s against live on 2026-09-26.
create or replace view inbox_campaign_perf_v with (security_invoker = on) as
with msg as (
  select distinct on (m.prospect_id, m.direction, m.message_text, coalesce(m.sent_at, m.created_at))
    p.campaign_id, m.prospect_id, m.direction, m.message_type, m.reply_intent,
    coalesce(m.sent_at, m.created_at) as at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  where coalesce(m.sent_at, m.created_at) >= now() - interval '7 days'
    and ((m.direction = 'outbound' and m.sent_at is not null) or m.direction = 'inbound')
    and coalesce(p.skip_reason, '') <> 'inbound_vendor_pitch'
  order by m.prospect_id, m.direction, m.message_text, coalesce(m.sent_at, m.created_at), m.id
),
m7 as (
  select campaign_id,
    count(*) filter (where direction = 'outbound' and message_type <> 'connection_note') as dms_7d,
    count(distinct prospect_id) filter (where direction = 'inbound') as replied_7d,
    count(distinct prospect_id) filter (where direction = 'inbound'
      and reply_intent in ('positive','soft_yes','info_ask','booking')) as positive_7d,
    max(at) filter (where direction = 'outbound') as last_send
  from msg group by campaign_id
),
p7 as (
  select campaign_id,
    count(*) filter (where connection_sent_at >= now() - interval '7 days') as invites_7d,
    count(*) filter (where connection_sent_at >= now() - interval '7 days'
      and connection_sent_at <= now() - interval '72 hours') as accept_judged,
    count(*) filter (where connection_sent_at >= now() - interval '7 days'
      and connection_sent_at <= now() - interval '72 hours'
      and connected_at is not null and connected_at <= connection_sent_at + interval '72 hours') as accept_72h,
    count(*) filter (where call_booked_at >= now() - interval '30 days') as calls_30d,
    count(*) filter (where call_booked_at >= now() - interval '7 days') as calls_7d,
    max(connection_sent_at) as last_invite
  from outreach_prospects
  where connection_sent_at >= now() - interval '7 days' or call_booked_at >= now() - interval '30 days'
  group by campaign_id
)
select c.id as campaign_id, c.name as campaign_name,
  coalesce(c.client_id, 'ivan') as client_id,
  c.is_active,
  coalesce(p7.invites_7d, 0) as invites_7d,
  coalesce(m7.dms_7d, 0) as dms_7d,
  coalesce(m7.replied_7d, 0) as replied_7d,
  coalesce(m7.positive_7d, 0) as positive_7d,
  coalesce(p7.calls_30d, 0) as calls_30d,
  coalesce(p7.accept_judged, 0) as accept_judged,
  coalesce(p7.accept_72h, 0) as accept_72h,
  greatest(m7.last_send, p7.last_invite) as last_send,
  coalesce(p7.calls_7d, 0) as calls_7d
from outreach_campaigns c
left join m7 on m7.campaign_id = c.id
left join p7 on p7.campaign_id = c.id
where not coalesce(c.archived, false);

grant select on inbox_campaign_perf_v to authenticated;
