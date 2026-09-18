-- 087 · Came back: a prospect we already messaged who looked us up and never replied.
--
-- Ivan, 2026-09-18: "this should be judged in all clients. me, mattan, davoirin".
-- The capture already exists: `Outreach - Profile View Lane` stamps provenance='engine_touched' +
-- prospect_id on profile_view_log, and `Own Post Engager Logger` stamps post_engagers.prospect_id.
-- Every surface so far reads those rows for NEW people only (066 warm_signal_cards, 064 promotion),
-- so an existing prospect who came back was written and never shown. Measured 60d on 2026-09-18:
-- viewers reply 32.6% vs 7.1% (ivan), 38.6% vs 7.6% (risedtc), 27.3% vs 7.5% (arch).
--
--   came_back_cards()              → one row per person, all three tenants
--   came_back_dismiss(prospect_id) → hides the card until a NEWER signal lands
--
-- A card means: at least one DM or InMail went out, the person viewed the seat's profile or engaged
-- an own post AFTER that last send, no inbound since, no booking. Invite-pending rows stay out on
-- purpose: a view in the first day after an invite is the reflex of checking who invited you.
-- Nothing here sends and nothing changes a sequence. The scheduled next step still fires on its own.
--
-- SECURITY DEFINER because profile_view_log and post_engagers carry a service_role policy only.
-- Same grant shape as 081: authenticated + service_role, never anon.
-- Applied via the Supabase Management API.

create or replace function public.came_back_cards()
returns table (
  prospect_id      uuid,
  tenant           text,
  name             text,
  headline         text,
  company          text,
  title            text,
  country          text,
  icp_score        integer,
  stage            text,
  campaign         text,
  linkedin_url     text,
  dm_count         integer,
  last_out_at      timestamptz,
  last_out_model   text,
  last_out_text    text,
  last_signal_at   timestamptz,
  n_views          integer,
  n_engagements    integer,
  signals          jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with sig as (
  -- one view per person per day: the lane re-captures the same LinkedIn view on later days
  -- (Bob Generale read 8 views in 4 days on 2026-09-18 before this).
  (select distinct on (l.prospect_id, l.viewed_at::date)
         l.prospect_id, l.viewed_at as at, 'view'::text as kind, null::text as detail
  from profile_view_log l
  where l.prospect_id is not null and l.viewed_at >= now() - interval '21 days'
  order by l.prospect_id, l.viewed_at::date, l.viewed_at)
  union all
  select e.prospect_id, coalesce(e.last_seen_at, e.first_seen_at), coalesce(nullif(e.engagement_type, ''), 'reaction'),
         left(e.comment_text, 240)
  from post_engagers e
  where e.prospect_id is not null and coalesce(e.last_seen_at, e.first_seen_at) >= now() - interval '21 days'
),
last_out as (
  select distinct on (m.prospect_id) m.prospect_id, m.sent_at, m.ai_model, m.message_text
  from outreach_messages m
  where m.direction = 'outbound' and m.sent_at is not null and m.message_type in ('dm', 'inmail')
    and m.prospect_id in (select s.prospect_id from sig s)
  order by m.prospect_id, m.sent_at desc
),
after as (
  select s.prospect_id,
         max(s.at) as last_signal_at,
         count(*) filter (where s.kind = 'view')::integer as n_views,
         count(*) filter (where s.kind <> 'view')::integer as n_engagements,
         jsonb_agg(jsonb_build_object('kind', s.kind, 'at', s.at, 'detail', s.detail) order by s.at desc) as signals
  from sig s
  join last_out o on o.prospect_id = s.prospect_id and s.at > o.sent_at
  group by s.prospect_id
)
select p.id, coalesce(c.client_id, 'ivan'), p.name, p.headline, p.company, p.title, p.country,
       p.icp_score::integer, p.stage, c.name, p.linkedin_url, coalesce(p.dm_count, 0)::integer,
       o.sent_at, o.ai_model, left(o.message_text, 280),
       a.last_signal_at, a.n_views, a.n_engagements, a.signals
from after a
join last_out o on o.prospect_id = a.prospect_id
join outreach_prospects p on p.id = a.prospect_id
join outreach_campaigns c on c.id = p.campaign_id
where p.blacklisted = false
  and p.call_booked_at is null
  and p.stage in ('connected', 'dm_sent')
  and not exists (
    select 1 from outreach_messages i
    where i.prospect_id = p.id and i.direction = 'inbound'
      and coalesce(i.is_reaction, false) = false and i.created_at > o.sent_at)
  and coalesce((p.enrichment_data->>'came_back_dismissed_at')::timestamptz, '-infinity') < a.last_signal_at
order by a.last_signal_at desc;
$$;

create or replace function public.came_back_dismiss(p_prospect_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update outreach_prospects
     set enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('came_back_dismissed_at', now())
   where id = p_prospect_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
end $$;

revoke all on function public.came_back_cards() from public, anon;
revoke all on function public.came_back_dismiss(uuid) from public, anon;
grant execute on function public.came_back_cards() to authenticated, service_role;
grant execute on function public.came_back_dismiss(uuid) to authenticated, service_role;
