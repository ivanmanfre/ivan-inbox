-- 029: inbox_replacement_v — is the pipeline REFILLING, or just draining slowly?
--
-- Why this exists (2026-08-06). The Overview's three tiles are all STOCK measures:
-- accept rate, governor usage, and Runway (= sendable / daily send rate). None of them
-- can see FLOW, so a pool that is shrinking every single day still prints a positive
-- runway right up until it hits zero. Measured over 2026-07-25..08-06, Ivan's lane was
-- below 1.0x replacement on 6 of 13 days while Runway never once read "0" until the day
-- the pool actually emptied. Runway tells you how long the tank lasts; this tells you
-- whether the tap is on.
--
-- REPLACEMENT RATE = qualified rows IN per day / invites OUT per day.
--   > 1.0  pool growing
--   = 1.0  break-even
--   < 1.0  draining — runway is a countdown, and the tile above is lying to you by omission
--
-- INFLOW definition. A row "arrives" the moment it crosses its own lane's ICP floor, which
-- is `scored_at` (set by the scorer / rescore job), NOT `created_at`. Using created_at would
-- credit the day a row was harvested rather than the day it became usable, and scoring lags
-- harvesting by hours to days — on 2026-08-06 that gap was 53 rows harvested vs 32 scored.
--
-- FLOOR mirrors the connect picker in 5ZXtArhobWrDDpfJ (node `Query + Build Notes`) exactly:
--   · ivan  cold lane  -> icp_score >= 7   (pool `cold`)
--   · ivan  all others -> icp_score >= 6   (pool `engage`, floor dropped 7->6 on 2026-08-05
--                                           because the cold rubric ranks real founders low)
-- ⚠ NON-IVAN SEATS ARE APPROXIMATE AND SAY SO. Rise arms on the seatless gate
-- (enrichment_data.gold_icp_v2_seatless, bar 50) and has NO icp_score gate at all, and there
-- is no timestamp for "rise_note_final became non-null". So for other seats inflow counts
-- rows that got scored AND now carry a composed note. That conflates "when scored" with
-- "when armed". Treat Rise's number as directional; Ivan's is exact.
--
-- OUTFLOW reuses the same de-duplicated connection_note source as inbox_pipeline_v.sent so
-- the two views can never disagree about how many invites went out.
--
-- lane_of() is NOT redefined here — 013_lane_harvest.sql owns it. Re-running this file is safe.

create or replace view inbox_replacement_v with (security_invoker = on) as
with inflow as (
  select coalesce(c.client_id,'ivan') as client_id,
         lane_of(c.name)              as lane,
         pr.scored_at::date           as day,
         count(*)                     as qualified_in
  from outreach_prospects pr
  join outreach_campaigns c on c.id = pr.campaign_id
  where pr.scored_at is not null
    and pr.scored_at >= now() - interval '30 days'
    and coalesce(pr.blacklisted,false) = false
    and case when coalesce(c.client_id,'ivan') = 'ivan'
      then pr.icp_score >= (case when lane_of(c.name) = 'cold' then 7 else 6 end)
      else pr.enrichment_data->>'rise_note_final' is not null
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

-- Verification (expected shape, run after applying):
--   select client_id, sum(qualified_in) in_7d, sum(sent_out) out_7d,
--          round(sum(qualified_in)::numeric / nullif(sum(sent_out),0), 2) as replacement
--   from inbox_replacement_v where day >= current_date - 6 group by 1 order by 1;
-- On 2026-08-06 Ivan measured: in_7d 116, out_7d 106, replacement 1.09x.
