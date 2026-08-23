-- 040: the INBOUND lanes — an audit trail for the two automations that decide,
-- without a human, whether an inbound stranger ever reaches the inbox at all.
--
-- WHY THIS EXISTS (Ivan, 2026-08-23: "it's kinda isolated, hidden campaigns that I don't
-- have any visibility of, and I will probably forget about them when I'm onboarding a new
-- client"). Two automations silently drop people:
--
--   1. `Outreach - Inbound Request Lane` (n8n HyHoWWTBBVyhB4My) reads received LinkedIn
--      invitations on each seat, judges them against `inbound-request-judge-<seat>`, accepts
--      the passes and leaves the fails PENDING forever. Its verdicts were already durable
--      (a `stage='skipped'` prospect row carrying judge_reason + judge_score) and simply
--      had no surface. Nothing new is written for this lane.
--
--   2. The inbound triage inside `Outreach - RISE Reply Detector` (n8n lZYWenpJ4agO8it4)
--      classifies every chat on the client's seat that does NOT map to a known prospect,
--      and registers ONLY the buyers. Vendor and personal verdicts were dropped with no
--      record anywhere except a self-pruning `integration_config` blob — so the question
--      "is this filtering out DMs that matter" could not be answered from the data.
--      🔴 That blob also cannot be read by the app: `integration_config` holds live API
--      keys (apollo, brightdata, hubspot), so it must never be exposed to a browser role.
--      Hence a real table, scoped per client, with no secrets in it.
--
-- The two lanes render side by side under Lanes → Inbound, one row per client, with the
-- same sparkline + live/slowing/stale vocabulary the outbound lanes already use.

-- ---------------------------------------------------------------------------
-- 1. the cold-DM filter's verdicts
-- ---------------------------------------------------------------------------
create table if not exists public.inbound_triage_log (
  id uuid primary key default gen_random_uuid(),
  -- tenancy is the CLIENT, never the seat: a seat can be reassigned, and every
  -- other surface in this app scopes by client_id (see MEMORY: tenancy = campaign.client_id).
  client_id text not null,
  seat text,
  chat_id text not null,
  -- The message the verdict was passed ON. The workflow re-judges whenever a chat's newest
  -- inbound message id changes, so this is what makes a row an event rather than a state.
  unipile_message_id text not null,
  decided_at timestamptz not null default now(),
  who text,
  verdict text not null check (verdict in ('buyer', 'vendor', 'personal')),
  -- One line from the classifier naming what decided it. Null for rows written before
  -- the 2026-08-23 retune, which ran at max_tokens 5 and could not return a reason.
  reason text,
  message_text text,
  -- Set when the drop was overridden by hand and the person was admitted after all.
  -- Null on every automatic verdict, including the buyers the lane registered itself.
  surfaced_prospect_id uuid references public.outreach_prospects (id) on delete set null,
  surfaced_at timestamptz,
  created_at timestamptz not null default now()
);

-- Re-running the detector on an unchanged chat must be a no-op, not a second row. The
-- writer posts with Prefer: resolution=ignore-duplicates against this constraint.
create unique index if not exists inbound_triage_log_event_uidx
  on public.inbound_triage_log (chat_id, unipile_message_id);

create index if not exists inbound_triage_log_client_time_idx
  on public.inbound_triage_log (client_id, decided_at desc);

alter table public.inbound_triage_log enable row level security;

drop policy if exists "authenticated all inbound_triage_log" on public.inbound_triage_log;
create policy "authenticated all inbound_triage_log" on public.inbound_triage_log
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2. the lane cards
-- ---------------------------------------------------------------------------
-- `passed` = reached a human. `dropped` = the automation ended it.
--
-- ⚠ The two lanes are deliberately disjoint so nobody is counted twice. `requests` is
-- scoped to trigger_type='inbound_request' (written only by the invitation lane); the
-- buyers the DM triage registers land in the SAME campaign but carry a null trigger_type
-- and a notes prefix of 'inbound_triage:', and they are counted by `filtered` instead.
create or replace view public.inbox_inbound_v with (security_invoker = on) as
with ev as (
  select
    coalesce(c.client_id, 'ivan')                as client_id,
    'requests'::text                             as lane,
    -- 🔴 created_at, NEVER last_engaged_at. The lane PATCHes last_engaged_at on every
    -- suppressed candidate it re-sees (the "signal refresh" step, which matches
    -- stage='skipped' rows), so a judgement from three weeks ago would re-date itself to
    -- today on every poll and the timeline would read as one continuous burst. The row is
    -- inserted once, at judge time, with on_conflict=ignore-duplicates.
    p.created_at                                 as at,
    (p.stage is distinct from 'skipped')         as passed
  from public.outreach_prospects p
  left join public.outreach_campaigns c on c.id = p.campaign_id
  where p.trigger_type = 'inbound_request'
    and p.created_at is not null
  union all
  select
    t.client_id,
    'filtered'::text,
    t.decided_at,
    (t.verdict = 'buyer' or t.surfaced_prospect_id is not null)
  from public.inbound_triage_log t
)
select client_id, lane,
  count(*)                                                        as total,
  count(*) filter (where at >= now() - interval '24 hours')       as d24,
  count(*) filter (where at >= now() - interval '7 days')         as d7,
  count(*) filter (where at >= now() - interval '30 days')        as d30,
  count(*) filter (where passed)                                  as passed,
  count(*) filter (where not passed)                              as dropped,
  max(at)                                                         as last_at
from ev
group by client_id, lane;

create or replace view public.inbox_inbound_daily_v with (security_invoker = on) as
with ev as (
  select coalesce(c.client_id, 'ivan') as client_id, 'requests'::text as lane, p.created_at as at
  from public.outreach_prospects p
  left join public.outreach_campaigns c on c.id = p.campaign_id
  where p.trigger_type = 'inbound_request'
    and p.created_at >= now() - interval '90 days'
  union all
  select t.client_id, 'filtered'::text, t.decided_at
  from public.inbound_triage_log t
  where t.decided_at >= now() - interval '90 days'
)
select client_id, lane,
  to_char(date_trunc('day', at at time zone 'UTC'), 'YYYY-MM-DD') as day,
  count(*) as n
from ev
group by 1, 2, 3;

-- ---------------------------------------------------------------------------
-- 3. the drill-in
-- ---------------------------------------------------------------------------
-- One row per decision, both lanes, in one shape so the detail list is a single query.
-- `detail` is whatever the operator needs to overrule the machine: for an invitation that
-- is the role and company the judge actually read, for a filtered DM it is the message.
create or replace view public.inbox_inbound_decisions_v with (security_invoker = on) as
select
  p.id                                                             as id,
  coalesce(c.client_id, 'ivan')                                    as client_id,
  'requests'::text                                                 as lane,
  p.created_at                                                     as decided_at,
  p.name                                                           as who,
  case when p.stage is distinct from 'skipped' then 'passed' else 'dropped' end as outcome,
  nullif(p.enrichment_data #>> '{judge_reason}', '')               as reason,
  nullif(concat_ws(' · ',
    nullif(p.enrichment_data #>> '{profile,position}', ''),
    nullif(p.enrichment_data #>> '{profile,company}', ''),
    nullif(p.headline, '')), '')                                   as detail,
  nullif(p.enrichment_data #>> '{invitation_text}', '')            as quote,
  (p.enrichment_data #>> '{judge_score}')::numeric                 as score,
  p.linkedin_url                                                   as link,
  (p.enrichment_data #>> '{enriched}') = 'false'                   as judged_blind,
  false                                                            as surfaced
from public.outreach_prospects p
left join public.outreach_campaigns c on c.id = p.campaign_id
where p.trigger_type = 'inbound_request'
  and p.created_at is not null
union all
select
  t.id,
  t.client_id,
  'filtered'::text,
  t.decided_at,
  coalesce(t.who, 'Unknown'),
  case when t.verdict = 'buyer' or t.surfaced_prospect_id is not null then 'passed' else 'dropped' end,
  t.reason,
  upper(t.verdict),
  t.message_text,
  null::numeric,
  null::text,
  false,
  t.surfaced_prospect_id is not null
from public.inbound_triage_log t;
