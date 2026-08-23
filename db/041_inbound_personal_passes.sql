-- 041: only VENDOR ends a thread.
--
-- Ivan, 2026-08-23, reading the Cold-DM filter drill-in: Andrew Gordon's "Congrats on your
-- 18 year anniversary at WEBITMD!" rendered as STOPPED. "andrew one is not a cold pitch."
--
-- The n8n triage now registers a `personal` verdict on stage='inbound_personal' (a distinct
-- stage, so every reply drafter's `stage in ('replied','positive_reply')` picker excludes it
-- BY CONSTRUCTION and a congratulation can never be answered with a sales draft). These two
-- views change to match: a personal verdict reached a human, so it counts as passed.
--
-- Body identical to db/040 except the two `passed` expressions:
--   was  (t.verdict = 'buyer' or t.surfaced_prospect_id is not null)
--   now  (t.verdict <> 'vendor' or t.surfaced_prospect_id is not null)

-- 2026-08-23b (Ivan, on Andrew Gordon's work-anniversary message reading as STOPPED):
-- only VENDOR ends a thread. A personal message now registers on stage='inbound_personal'
-- and counts as having reached a human, so the lane's passed/dropped split matches what
-- the automation actually did.
create or replace view public.inbox_inbound_v with (security_invoker = on) as
with ev as (
  select coalesce(c.client_id,'ivan') as client_id, 'requests'::text as lane,
         p.created_at as at, (p.stage is distinct from 'skipped') as passed
  from public.outreach_prospects p
  left join public.outreach_campaigns c on c.id = p.campaign_id
  where p.trigger_type = 'inbound_request' and p.created_at is not null
  union all
  select t.client_id, 'filtered'::text, t.decided_at,
         (t.verdict <> 'vendor' or t.surfaced_prospect_id is not null)
  from public.inbound_triage_log t
)
select client_id, lane,
  count(*) as total,
  count(*) filter (where at >= now() - interval '24 hours') as d24,
  count(*) filter (where at >= now() - interval '7 days')   as d7,
  count(*) filter (where at >= now() - interval '30 days')  as d30,
  count(*) filter (where passed)     as passed,
  count(*) filter (where not passed) as dropped,
  max(at) as last_at
from ev group by client_id, lane;

create or replace view public.inbox_inbound_decisions_v with (security_invoker = on) as
select p.id, coalesce(c.client_id,'ivan') as client_id, 'requests'::text as lane,
  p.created_at as decided_at, p.name as who,
  case when p.stage is distinct from 'skipped' then 'passed' else 'dropped' end as outcome,
  nullif(p.enrichment_data #>> '{judge_reason}','') as reason,
  nullif(concat_ws(' · ',
    nullif(p.enrichment_data #>> '{profile,position}',''),
    nullif(p.enrichment_data #>> '{profile,company}',''),
    nullif(p.headline,'')),'') as detail,
  nullif(p.enrichment_data #>> '{invitation_text}','') as quote,
  (p.enrichment_data #>> '{judge_score}')::numeric as score,
  p.linkedin_url as link,
  (p.enrichment_data #>> '{enriched}') = 'false' as judged_blind,
  false as surfaced
from public.outreach_prospects p
left join public.outreach_campaigns c on c.id = p.campaign_id
where p.trigger_type = 'inbound_request' and p.created_at is not null
union all
select t.id, t.client_id, 'filtered'::text, t.decided_at, coalesce(t.who,'Unknown'),
  case when t.verdict <> 'vendor' or t.surfaced_prospect_id is not null then 'passed' else 'dropped' end,
  t.reason, upper(t.verdict), t.message_text, null::numeric, null::text, false,
  t.surfaced_prospect_id is not null
from public.inbound_triage_log t;
