-- 018: Warm-era cutoff for the volume/campaign views (Ivan scope only).
--
-- Follow-up to 017: the accept view got the era cutoff but the Volume tiles
-- (inbox_sends_v.sent_total → "900 connections") and the Campaigns block still
-- counted Ivan's pre-warm-era history. Same rule as 017: Ivan counts only
-- sends since 2026-07-11, Rise keeps full history.
--
-- These three views are consumed ONLY by this dashboard (created in db/003 and
-- db/010), so they are replaced in place. Base definitions copied from the LIVE
-- pg_get_viewdef on 2026-07-25, cutoff added in each dedup CTE.

create or replace view inbox_sends_v with (security_invoker = on) as
with dedup as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id,
    m.message_type,
    coalesce(m.channel, 'linkedin') as channel,
    m.sent_at,
    m.send_blocked_at,
    m.send_blocked_reason
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound'
    and m.message_type = any (array['connection_note','dm','inmail','email'])
    -- warm-era cutoff (matches 017)
    and not (coalesce(c.client_id, 'ivan') = 'ivan' and m.sent_at < '2026-07-11')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select client_id, message_type, channel,
  count(*) filter (where sent_at is not null)                                   as sent_total,
  count(*) filter (where sent_at >= now() - interval '24 hours')                as sent_24h,
  count(*) filter (where sent_at >= now() - interval '7 days')                  as sent_7d,
  count(*) filter (where sent_at >= now() - interval '30 days')                 as sent_30d,
  count(*) filter (where send_blocked_at is not null
                   and send_blocked_reason <> 'discarded_in_inbox')             as blocked,
  max(sent_at) as last_sent
from dedup
group by client_id, message_type, channel;

create or replace view inbox_sends_daily_v with (security_invoker = on) as
with dedup as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id,
    m.message_type,
    m.sent_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound'
    and m.sent_at >= now() - interval '90 days'
    and m.message_type = any (array['connection_note','dm','inmail','email'])
    -- warm-era cutoff (matches 017)
    and not (coalesce(c.client_id, 'ivan') = 'ivan' and m.sent_at < '2026-07-11')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select client_id, message_type,
  to_char(date_trunc('day', sent_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
  count(*) as sent
from dedup
group by 1, 2, 3;

create or replace view inbox_campaign_sends_v with (security_invoker = on) as
with dedup as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    p.campaign_id, m.sent_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns cc on cc.id = p.campaign_id
  where m.direction = 'outbound' and m.sent_at is not null
    and m.message_type = any (array['connection_note','dm','inmail','email'])
    -- warm-era cutoff (matches 017)
    and not (coalesce(cc.client_id, 'ivan') = 'ivan' and m.sent_at < '2026-07-11')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select c.id as campaign_id, c.name as campaign_name,
  coalesce(c.client_id, 'ivan') as client_id,
  c.is_active,
  count(d.sent_at) as sent_total,
  count(d.sent_at) filter (where d.sent_at >= now() - interval '7 days')  as sent_7d,
  count(d.sent_at) filter (where d.sent_at >= now() - interval '30 days') as sent_30d,
  max(d.sent_at) as last_sent
from outreach_campaigns c
left join dedup d on d.campaign_id = c.id
group by c.id, c.name, c.client_id, c.is_active;
