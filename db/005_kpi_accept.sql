-- Connection acceptance per client. Trailing style: accepts whose connected_at
-- falls in the window / connection_notes SENT in the window. Matches the number
-- outreach_sender_health reacts to. Cohort lag (a note sent yesterday hasn't had
-- time to accept) is surfaced in the UI caption, not corrected here.
-- Replace connected_at / stage predicate if Task 1 findings differ (ACCEPT_SIGNAL).
create or replace view inbox_accept_v with (security_invoker = on) as
with sends as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id, m.sent_at, p.connected_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound' and m.message_type = 'connection_note'
    and m.sent_at is not null
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select
  client_id,
  count(*) filter (where sent_at >= now() - interval '7 days')                          as sent_7d,
  count(*) filter (where connected_at >= now() - interval '7 days')                      as accepted_7d,
  count(*) filter (where sent_at >= now() - interval '30 days')                          as sent_30d,
  count(*) filter (where connected_at >= now() - interval '30 days')                     as accepted_30d,
  count(*)                                                                               as sent_total,
  count(*) filter (where connected_at is not null)                                       as accepted_total,
  round(100.0 * count(*) filter (where connected_at >= now() - interval '7 days')
        / nullif(count(*) filter (where sent_at >= now() - interval '7 days'),0), 1)     as rate_7d,
  round(100.0 * count(*) filter (where connected_at >= now() - interval '30 days')
        / nullif(count(*) filter (where sent_at >= now() - interval '30 days'),0), 1)    as rate_30d
from sends group by client_id;
