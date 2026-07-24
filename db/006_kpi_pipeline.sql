-- Per client x lane: sendable ICP runway + recent sourcing mix.
-- Lane derives from CAMPAIGN NAME (outreach_prospects has no source column).
-- Client = coalesce(outreach_campaigns.client_id,'ivan'). Score = icp_score.
create or replace function lane_of(camp_name text) returns text
language sql immutable as $$
  select case
    when camp_name ilike '%engager%' or camp_name ilike '%engagement harvest%'
      or camp_name ilike '%anchor%' or camp_name ilike '%profile view%'   then 'engager'
    when camp_name ilike '%warm%' or camp_name ilike '%orbit%'
      or camp_name ilike '%network activation%'                           then 'warm'
    else 'cold'  -- explicit %cold% + bare vertical/industry campaigns
  end
$$;

create or replace view inbox_pipeline_v with (security_invoker = on) as
with runway as (  -- sendable = scored ICP, pre-contact, live campaign, not blacklisted
  select coalesce(c.client_id,'ivan') as client_id, lane_of(c.name) as lane,
         count(*) as sendable
  from outreach_prospects pr
  join outreach_campaigns c on c.id = pr.campaign_id
  where pr.icp_score >= 7
    and pr.stage in ('enriched','identified','review')
    and coalesce(pr.blacklisted,false) = false
    and c.is_active = true
  group by 1,2
),
sent as (  -- sourcing mix: connections actually sent, by the prospect's lane
  select coalesce(c.client_id,'ivan') as client_id, lane_of(c.name) as lane,
         count(*) filter (where s.sent_at >= now() - interval '7 days')  as sent_7d,
         count(*) filter (where s.sent_at >= now() - interval '30 days') as sent_30d
  from (
    select distinct on (m.prospect_id, m.message_text, m.sent_at)
      m.prospect_id, m.sent_at
    from outreach_messages m
    where m.direction='outbound' and m.message_type='connection_note' and m.sent_at is not null
    order by m.prospect_id, m.message_text, m.sent_at, m.id
  ) s
  join outreach_prospects pr on pr.id = s.prospect_id
  join outreach_campaigns c on c.id = pr.campaign_id
  group by 1,2
)
select coalesce(runway.client_id, sent.client_id) as client_id,
       coalesce(runway.lane, sent.lane)           as lane,
       coalesce(runway.sendable, 0)               as sendable,
       coalesce(sent.sent_7d, 0)                  as sent_7d,
       coalesce(sent.sent_30d, 0)                 as sent_30d
from runway full outer join sent
  on runway.client_id = sent.client_id and runway.lane = sent.lane;
