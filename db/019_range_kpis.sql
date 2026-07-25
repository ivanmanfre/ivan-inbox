-- 019: Parameterized range KPIs for the custom date selector.
-- Returns per-client Sent / Accepted / Convos / Calls for an explicit
-- [p_from, p_to] date range (inclusive). NO warm-era cutoff here on purpose:
-- when the operator picks dates, the picked dates ARE the scope.
-- Semantics match inbox_accept_v2 / inbox_outcomes_v:
--   sent      = deduped connection notes sent in range
--   accepted  = of those range-sent notes, connected on/after the send
--   convos    = prospects whose FIRST inbound reply (optouts excluded) is in range
--   calls     = call_booked_at in range

create or replace function inbox_range_kpis(p_from date, p_to date)
returns table (client_id text, sent bigint, accepted bigint, convos bigint, calls bigint)
language sql
stable
security invoker
as $$
  with bounds as (
    select p_from::timestamptz as t0, (p_to + 1)::timestamptz as t1
  ),
  sends as (
    select distinct on (m.prospect_id, m.message_text, m.sent_at)
      coalesce(c.client_id, 'ivan') as client_id, m.sent_at, p.connected_at
    from outreach_messages m
    join outreach_prospects p on p.id = m.prospect_id
    join outreach_campaigns c on c.id = p.campaign_id
    cross join bounds b
    where m.direction = 'outbound' and m.message_type = 'connection_note'
      and m.sent_at >= b.t0 and m.sent_at < b.t1
    order by m.prospect_id, m.message_text, m.sent_at, m.id
  ),
  acc as (
    select client_id,
      count(*) as sent,
      count(*) filter (where connected_at is not null and connected_at >= sent_at) as accepted
    from sends group by 1
  ),
  first_replies as (
    select coalesce(c.client_id, 'ivan') as client_id, m.prospect_id,
      min(coalesce(m.sent_at, m.created_at)) as first_reply_at
    from outreach_messages m
    join outreach_prospects p on p.id = m.prospect_id
    join outreach_campaigns c on c.id = p.campaign_id
    where m.direction = 'inbound' and coalesce(p.blacklisted, false) = false
    group by 1, 2
  ),
  cv as (
    select fr.client_id, count(*) as convos
    from first_replies fr cross join bounds b
    where fr.first_reply_at >= b.t0 and fr.first_reply_at < b.t1
    group by 1
  ),
  ca as (
    select coalesce(c.client_id, 'ivan') as client_id, count(*) as calls
    from outreach_prospects p
    join outreach_campaigns c on c.id = p.campaign_id
    cross join bounds b
    where p.call_booked_at >= b.t0 and p.call_booked_at < b.t1
    group by 1
  )
  select
    coalesce(acc.client_id, cv.client_id, ca.client_id) as client_id,
    coalesce(acc.sent, 0), coalesce(acc.accepted, 0),
    coalesce(cv.convos, 0), coalesce(ca.calls, 0)
  from acc
  full join cv using (client_id)
  full join ca using (client_id);
$$;

grant execute on function inbox_range_kpis(date, date) to anon, authenticated;
