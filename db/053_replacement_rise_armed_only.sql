-- 053 (2026-09-07): RISE inflow on the Refill tile counted every scored row that carried a
-- rise_note_final. The engine writes that note on EVERY staged row, holds included (ballot_hold,
-- F&B vertical_gate, substance floor), so "qualified in" read 72 on 09-05 against 26 rows that
-- actually reached a sendable state. Ivan: "refill looks buggy" / ballot_hold IS NOT POOL.
-- RISE inflow now = rows whose name_gate is or WAS armed (auto_armed / armed_by_ivan; the 09-07
-- terminal-hold pass keeps the prior status under name_gate.prior), or that were sent under the
-- pre-08-10 hand-arm path (stage moved without a stamp). ivan / arch branches unchanged.
-- Same columns as 047 -> create or replace, nothing downstream to migrate.
create or replace view inbox_replacement_v with (security_invoker = on) as
with inflow as (
  select coalesce(c.client_id,'ivan') as client_id,
         lane_of(c.name)              as lane,
         case when coalesce(c.client_id,'ivan') = 'arch'
              then (pr.enrichment_data->>'promoted_at')::timestamptz::date
              else pr.scored_at::date end as day,
         count(*)                     as qualified_in
  from outreach_prospects pr
  join outreach_campaigns c on c.id = pr.campaign_id
  where coalesce(pr.blacklisted,false) = false
    and case when coalesce(c.client_id,'ivan') = 'ivan'
      then pr.scored_at is not null
           and pr.scored_at >= now() - interval '30 days'
           and pr.icp_score >= (case when lane_of(c.name) = 'cold' then 7 else 6 end)
      when coalesce(c.client_id,'ivan') = 'arch'
      then pr.enrichment_data->>'promoted_at' is not null
           and (pr.enrichment_data->>'promoted_at')::timestamptz >= now() - interval '30 days'
           and pr.skip_state is null
           and pr.enrichment_data->>'lane' is not null
      else pr.scored_at is not null
           and pr.scored_at >= now() - interval '30 days'
           and pr.enrichment_data->>'rise_note_final' is not null
           and ( coalesce(pr.enrichment_data->'name_gate'->>'status','') in ('auto_armed','armed_by_ivan')
              or coalesce(pr.enrichment_data->'name_gate'->'prior'->>'status','') in ('auto_armed','armed_by_ivan')
              or pr.stage in ('connection_sent','connected','dm_sent','replied') )
    end
  group by 1,2,3
),
outflow as (
  select coalesce(c.client_id,'ivan') as client_id,
         lane_of(c.name)              as lane,
         s.sent_at::date              as day,
         count(*)                     as sent_out
  from (
    select distinct on (m.prospect_id, m.message_text, m.sent_at)
      m.prospect_id, m.sent_at
    from outreach_messages m
    where m.direction='outbound' and m.message_type='connection_note'
      and m.sent_at is not null and m.sent_at >= now() - interval '30 days'
    order by m.prospect_id, m.message_text, m.sent_at, m.id
  ) s
  join outreach_prospects pr on pr.id = s.prospect_id
  join outreach_campaigns c on c.id = pr.campaign_id
  group by 1,2,3
)
select coalesce(i.client_id, o.client_id) as client_id,
       coalesce(i.lane,      o.lane)      as lane,
       coalesce(i.day,       o.day)       as day,
       coalesce(i.qualified_in, 0)        as qualified_in,
       coalesce(o.sent_out,     0)        as sent_out
from inflow i full outer join outflow o
  on i.client_id = o.client_id and i.lane = o.lane and i.day = o.day;
