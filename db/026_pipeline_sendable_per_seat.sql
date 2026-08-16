-- 026: inbox_pipeline_v.sendable — make it mean "rows THIS SEAT'S connect picker
-- could pick right now". Found 2026-08-03 after the Overview showed Rise at
-- "Runway 0d / 13 sendable" while the RISE Engine Watchdog (dDC3pXSS8jAPUHod)
-- read 44 armed leads on the same pool and stayed silent.
--
-- Root cause: 006 used ONE predicate for both tenants — `icp_score >= 7`. That
-- mirrors Ivan's picker but NOT Mattan's. In `Outreach - Connection Request
-- Sender` (5ZXtArhobWrDDpfJ, node `Query + Build Notes`):
--   · Ivan branch  (line ~329/348): stage=enriched, blacklisted=false,
--     country not null, scorer_version in 7..N, preferred_channel null|linkedin,
--     cold pool adds icp_score>=7 AND liveness_checked_at not null.
--   · Rise branch  (line ~129): stage in (identified,enriched), blacklisted=false,
--     country not null, connection_sent_at null, last_dm_sent_at null,
--     preferred_channel null|linkedin, cold adds rise_note_final not null AND
--     liveness_checked_at not null; engager/orbit add rise_note_final not null.
--     NO icp_score gate anywhere on the Rise path — Rise arms on the seatless
--     score (enrichment_data.gold_icp_v2_seatless, 0..78, bar 50), a different
--     scale entirely. Gating the KPI on icp_score>=7 threw away 32 of 45 armed
--     Rise leads and printed a 0-day runway on a lane with ~8 days of buffer.
--
-- Two falsehoods fixed, in both directions:
--   Rise cold  13 -> 45   (icp_score gate removed; rise_note_final required)
--   Ivan cold  66 -> 16   (42 rows are preferred_channel='inmail' — they belong
--                          to the open-profile sender, not the connect lane —
--                          and 45 carry no liveness stamp, which the cold pool
--                          has required since 2026-08-02)
--
-- SCOPE NOTE: sendable is CONNECT-scoped, matching sent_7d/sent_30d in this same
-- view (they count message_type='connection_note'). Rows routed to InMail/email
-- are live supply for those senders and are deliberately not counted here.
--
-- lane_of() is NOT redefined — 013_lane_harvest.sql owns it. Only the view text
-- changes; re-running this file is safe and idempotent.

create or replace view inbox_pipeline_v with (security_invoker = on) as
with cand as (  -- one row per prospect on a live campaign, with its seat + lane
  select coalesce(c.client_id,'ivan') as client_id,
         lane_of(c.name)              as lane,
         pr.stage, pr.icp_score, pr.country, pr.preferred_channel,
         pr.connection_sent_at, pr.last_dm_sent_at, pr.liveness_checked_at,
         pr.enrichment_data, coalesce(pr.blacklisted,false) as blacklisted
  from outreach_prospects pr
  join outreach_campaigns c on c.id = pr.campaign_id
  where c.is_active = true
),
runway as (  -- sendable = what the seat's own picker would accept today
  select client_id, lane, count(*) as sendable
  from cand
  where blacklisted = false
    and country is not null
    and (preferred_channel is null or preferred_channel = 'linkedin')
    and connection_sent_at is null
    and last_dm_sent_at is null
    -- per-name hold: the Rise picker skips these outright (0 volume by design)
    and coalesce(enrichment_data->'name_gate'->>'status','') <> 'blocked_until_mattan_ok'
    and case when client_id = 'ivan'
      -- Ivan: enriched only, ICP floor, cold additionally needs a liveness stamp
      then stage = 'enriched'
           and icp_score >= 7
           and (lane <> 'cold' or liveness_checked_at is not null)
      -- Rise/other seats: armed by the seatless gate, so the tell is a composed
      -- note (rise_note_final). Ballot-held rows never carry one.
      else stage in ('enriched','identified')
           and enrichment_data->>'rise_note_final' is not null
           and (lane <> 'cold' or liveness_checked_at is not null)
    end
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
