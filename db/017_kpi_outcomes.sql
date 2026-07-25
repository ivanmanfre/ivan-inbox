-- 017: Warm-era KPI scope + outcome tracking (conversations, booked calls).
--
-- Ivan ruling 2026-07-25: the Ivan scope should only count outreach since the
-- warm-lane era started (~2026-07-11) — older campaigns pollute the totals.
-- Rise keeps its full history (its lanes are all recent anyway).
--
-- TRACK_SINCE is intentionally inlined in the two views below (one constant,
-- two uses). To move the era boundary, edit both dates and re-apply this file.
--
-- inbox_accept_v2 is a NEW view: the live inbox_accept_v is left untouched in
-- case anything else reads it (memory: db/005 drifted from repo, never re-paste).
-- Base definition copied from the LIVE pg_get_viewdef on 2026-07-25, then the
-- era cutoff added in the sends CTE.

alter table outreach_prospects
  add column if not exists call_booked_at timestamptz;

comment on column outreach_prospects.call_booked_at is
  'When a sales call was booked with this prospect. Stamped manually (operator) — no automated source yet.';

create or replace view inbox_accept_v2 with (security_invoker = on) as
with sends as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id, m.sent_at, p.connected_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound' and m.message_type = 'connection_note'
    and m.sent_at is not null
    -- warm-era cutoff: Ivan scope only counts the current approach
    and not (coalesce(c.client_id, 'ivan') = 'ivan' and m.sent_at < '2026-07-11')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
), flagged as (
  select client_id, sent_at,
    (connected_at is not null and connected_at >= sent_at) as accepted
  from sends
)
select
  client_id,
  count(*) filter (where sent_at >= now() - interval '7 days')                 as sent_7d,
  count(*) filter (where sent_at >= now() - interval '7 days' and accepted)    as accepted_7d,
  count(*) filter (where sent_at >= now() - interval '30 days')                as sent_30d,
  count(*) filter (where sent_at >= now() - interval '30 days' and accepted)   as accepted_30d,
  count(*)                                                                     as sent_total,
  count(*) filter (where accepted)                                             as accepted_total,
  round(100.0 * count(*) filter (where sent_at >= now() - interval '7 days' and accepted)
        / nullif(count(*) filter (where sent_at >= now() - interval '7 days'), 0), 1)  as rate_7d,
  round(100.0 * count(*) filter (where sent_at >= now() - interval '30 days' and accepted)
        / nullif(count(*) filter (where sent_at >= now() - interval '30 days'), 0), 1) as rate_30d
from flagged
group by client_id;

grant select on inbox_accept_v2 to anon, authenticated;

-- Conversations = prospects with >=1 inbound reply, excluding blacklisted
-- (blacklist carries optouts/negatives). Sentiment is NOT classified here —
-- the UI labels this honestly as "replied, not opted out". Calls = manual
-- call_booked_at stamps.
create or replace view inbox_outcomes_v with (security_invoker = on) as
with convos as (
  select coalesce(c.client_id, 'ivan') as client_id,
         m.prospect_id,
         min(coalesce(m.sent_at, m.created_at)) as first_reply_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'inbound'
    and coalesce(p.blacklisted, false) = false
  group by 1, 2
), convos_era as (
  select * from convos
  -- warm-era cutoff: Ivan scope only counts the current approach
  where not (client_id = 'ivan' and first_reply_at < '2026-07-11')
), calls as (
  select coalesce(c.client_id, 'ivan') as client_id, p.call_booked_at
  from outreach_prospects p
  join outreach_campaigns c on c.id = p.campaign_id
  where p.call_booked_at is not null
)
select
  coalesce(cv.client_id, ca.client_id) as client_id,
  coalesce(cv.convos_7d, 0)    as convos_7d,
  coalesce(cv.convos_30d, 0)   as convos_30d,
  coalesce(cv.convos_total, 0) as convos_total,
  coalesce(ca.calls_7d, 0)     as calls_7d,
  coalesce(ca.calls_30d, 0)    as calls_30d,
  coalesce(ca.calls_total, 0)  as calls_total
from (
  select client_id,
    count(*) filter (where first_reply_at >= now() - interval '7 days')  as convos_7d,
    count(*) filter (where first_reply_at >= now() - interval '30 days') as convos_30d,
    count(*) as convos_total
  from convos_era group by client_id
) cv
full join (
  select client_id,
    count(*) filter (where call_booked_at >= now() - interval '7 days')  as calls_7d,
    count(*) filter (where call_booked_at >= now() - interval '30 days') as calls_30d,
    count(*) as calls_total
  from calls group by client_id
) ca using (client_id);

grant select on inbox_outcomes_v to anon, authenticated;
