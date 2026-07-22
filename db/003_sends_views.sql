create or replace view inbox_sends_v with (security_invoker = on) as
select
  coalesce(c.client_id, 'ivan') as client_id,
  m.message_type,
  coalesce(m.channel, 'linkedin') as channel,
  count(*) filter (where m.sent_at is not null) as sent_total,
  count(*) filter (where m.sent_at >= now() - interval '24 hours') as sent_24h,
  count(*) filter (where m.sent_at >= now() - interval '7 days') as sent_7d,
  count(*) filter (where m.sent_at >= now() - interval '30 days') as sent_30d,
  count(*) filter (where m.send_blocked_at is not null and m.send_blocked_reason <> 'discarded_in_inbox') as blocked,
  max(m.sent_at) as last_sent
from outreach_messages m
join outreach_prospects p on p.id = m.prospect_id
join outreach_campaigns c on c.id = p.campaign_id
where m.direction = 'outbound'
  and m.message_type in ('connection_note', 'dm', 'inmail', 'email')
group by 1, 2, 3;

create or replace view inbox_sends_daily_v with (security_invoker = on) as
select
  coalesce(c.client_id, 'ivan') as client_id,
  m.message_type,
  to_char(date_trunc('day', m.sent_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
  count(*) as sent
from outreach_messages m
join outreach_prospects p on p.id = m.prospect_id
join outreach_campaigns c on c.id = p.campaign_id
where m.direction = 'outbound'
  and m.sent_at >= now() - interval '14 days'
  and m.message_type in ('connection_note', 'dm', 'inmail', 'email')
group by 1, 2, 3;
