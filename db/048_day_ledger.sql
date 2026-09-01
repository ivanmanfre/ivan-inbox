-- 048: inbox_day_ledger_v — one row per seat per UTC day, last 14 days.
--
-- Ivan 2026-09-01: "the campaigns, the daily sends are missing". The Overview had
-- 7d/30d totals and a 14-bar sparkline with no numbers on it; the day-by-day
-- figures he reads first were nowhere. This is that table.
--
-- Two numbers sit side by side on purpose:
--   invites   = connection notes that actually left the seat (outreach_messages)
--   cap_used  = the seat's enforcement counter (linkedin_daily_actions), which
--               linkedin_check_and_increment spends BEFORE the provider call.
-- When cap_used runs ahead of invites, slots were spent on refused sends. Found
-- 2026-09-01 on the ARCH seat: 08-27..08-30 burned the full cap and sent nothing.
-- The UI prints the gap as "burned"; a lane can read green on volume and still
-- be losing a third of its day to 422s.
--
-- accepted = of THAT day's invites, how many have been accepted by now (cohort
-- basis, same as inbox_accept_v: connected_at >= sent_at). Recent days read low
-- and only rise — the Funnel already carries that caveat.
--
-- Seats are keyed by client_id in linkedin_daily_actions ('ivan' / 'risedtc' /
-- 'arch'); campaign-less DMs coalesce to 'ivan' exactly as inbox_sends_daily_v does.
create or replace view inbox_day_ledger_v with (security_invoker = on) as
with sends as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id,'ivan') as client_id, m.message_type, m.sent_at, p.connected_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  left join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound'
    and m.sent_at >= (current_date - 13)::timestamptz
    and m.message_type in ('connection_note','dm','inmail')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
),
agg as (
  select client_id, (sent_at at time zone 'UTC')::date as day,
    count(*) filter (where message_type = 'connection_note') as invites,
    count(*) filter (where message_type = 'connection_note'
                       and connected_at is not null and connected_at >= sent_at) as accepted,
    count(*) filter (where message_type = 'dm') as dms,
    count(*) filter (where message_type = 'inmail') as inmails
  from sends group by 1, 2
),
cap as (
  select seat as client_id, date as day, count as cap_used, daily_limit as cap_limit
  from linkedin_daily_actions
  where action_type = 'connection_request'
    and date >= current_date - 13
    and seat in ('ivan','risedtc','arch')
)
select coalesce(a.client_id, cap.client_id)          as client_id,
       to_char(coalesce(a.day, cap.day), 'YYYY-MM-DD') as day,
       coalesce(a.invites, 0)                         as invites,
       coalesce(a.accepted, 0)                        as accepted,
       coalesce(a.dms, 0)                             as dms,
       coalesce(a.inmails, 0)                         as inmails,
       cap.cap_used,
       cap.cap_limit
from agg a
full outer join cap on cap.client_id = a.client_id and cap.day = a.day;

grant select on inbox_day_ledger_v to anon, authenticated;

-- Verification:
--   select * from inbox_day_ledger_v where client_id='arch' order by day desc;
--   -> 09-01 invites 25 · cap_used 35 (10 burned) at authoring time
