-- A historical insert-loop left phantom duplicate sends in outreach_messages:
-- the same message to the same prospect, identical text, stamped at the exact
-- same millisecond (e.g. 587 copies of one DM to Brian Gerstner). They are not
-- real separate sends, so both views collapse them via distinct on
-- (prospect_id, message_text, sent_at) before counting. Two genuinely distinct
-- sends never share all three, so this never under-counts real activity.

create or replace view inbox_sends_v with (security_invoker = on) as
with dedup as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id,
    m.message_type,
    coalesce(m.channel, 'linkedin') as channel,
    m.sent_at, m.send_blocked_at, m.send_blocked_reason
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound'
    and m.message_type in ('connection_note', 'dm', 'inmail', 'email')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select client_id, message_type, channel,
  count(*) filter (where sent_at is not null) as sent_total,
  count(*) filter (where sent_at >= now() - interval '24 hours') as sent_24h,
  count(*) filter (where sent_at >= now() - interval '7 days') as sent_7d,
  count(*) filter (where sent_at >= now() - interval '30 days') as sent_30d,
  count(*) filter (where send_blocked_at is not null and send_blocked_reason <> 'discarded_in_inbox') as blocked,
  max(sent_at) as last_sent
from dedup
group by 1, 2, 3;

create or replace view inbox_sends_daily_v with (security_invoker = on) as
with dedup as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id,
    m.message_type, m.sent_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound'
    and m.sent_at >= now() - interval '90 days'
    and m.message_type in ('connection_note', 'dm', 'inmail', 'email')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select client_id, message_type,
  to_char(date_trunc('day', sent_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
  count(*) as sent
from dedup
group by 1, 2, 3;
