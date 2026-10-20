-- 20261020 replied-but-quiet engagers + RISE ICP owner engager cards
begin;

CREATE OR REPLACE FUNCTION public.came_back_cards()
 RETURNS TABLE(prospect_id uuid, tenant text, name text, headline text, company text, title text, country text, icp_score integer, stage text, campaign text, linkedin_url text, dm_count integer, last_out_at timestamp with time zone, last_out_model text, last_out_text text, last_signal_at timestamp with time zone, n_views integer, n_engagements integer, signals jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with sig as (
  -- one view per person per day: the lane re-captures the same LinkedIn view on later days
  -- (Bob Generale read 8 views in 4 days on 2026-09-18 before this).
  (select distinct on (l.prospect_id, l.viewed_at::date)
         l.prospect_id, l.viewed_at as at, 'view'::text as kind, null::text as detail, null::text as post_ref
  from profile_view_log l
  where l.prospect_id is not null and l.viewed_at >= now() - interval '21 days'
  order by l.prospect_id, l.viewed_at::date, l.viewed_at)
  union all
  select e.prospect_id, coalesce(e.first_seen_at, e.last_seen_at), coalesce(nullif(e.engagement_type, ''), 'reaction'),
         left(e.comment_text, 240), e.post_social_id
  from post_engagers e
  where e.prospect_id is not null and coalesce(e.first_seen_at, e.last_seen_at) >= now() - interval '21 days'
  union all
  -- 097: they opened the scan we sent. The scan URL is one per prospect, so the slug in OUR sent
  -- message is the join (scans.prospect_token is null on every outreach scan, measured 2026-09-18).
  -- A scan_opens row is only trusted as a PERSON when it arrived from linkedin.com or inside the
  -- LinkedIn app, 5+ minutes after the send: 29 of the 21-day "opens" landed inside 2 minutes of the
  -- send (LinkedIn's link preview) and others were our own headless tools. One open per person per day.
  -- 211 (Ivan 2026-09-23): "we shouldn't be saying came back, no reply unless they open the scan
  -- again". Everyone opens the scan once; a first open is not a signal and was filling this section.
  -- Only an open 1h+ after that person's FIRST trusted open counts. The first open is found over all
  -- time, so a reopen today still counts when the first open fell outside the 21-day window.
  (select distinct on (t.prospect_id, t.opened_at::date)
         t.prospect_id, t.opened_at, 'scan_open'::text, null::text, null::text
  from (
    select sl.prospect_id, so.opened_at,
           min(so.opened_at) over (partition by sl.prospect_id) as first_open_at
    from scan_opens so
    join (select m.prospect_id, min(m.sent_at) as sent_at,
                 lower(substring(m.message_text from '/scan/([A-Za-z0-9_-]+)')) as slug
          from outreach_messages m
          where m.direction = 'outbound' and m.sent_at is not null and m.message_text ~ '/scan/[A-Za-z0-9_-]+'
          group by 1, 3) sl on lower(so.company_slug) = sl.slug
    where so.is_owner = false
      and so.opened_at > sl.sent_at + interval '5 minutes'
      and so.user_agent !~* 'headless|bot|crawler|spider|preview'
      and (so.referrer_host ilike '%linkedin%' or so.user_agent ilike '%LinkedInApp%')
  ) t
  where t.opened_at >= now() - interval '21 days'
    and t.opened_at > t.first_open_at + interval '1 hour'
  order by t.prospect_id, t.opened_at::date, t.opened_at)
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
         count(*) filter (where s.kind not in ('view', 'scan_open'))::integer as n_engagements,
         jsonb_agg(jsonb_build_object('kind', s.kind, 'at', s.at, 'detail', s.detail, 'post_title', pm.title, 'post_url', pm.post_url) order by s.at desc) as signals
  from sig s
  join last_out o on o.prospect_id = s.prospect_id and s.at > o.sent_at
  -- 20260924 (Ivan 2026-09-24 "doesnt say to what post they reacted"): the post they engaged with, from our own post tracker.
  left join lateral (
    select m.title, m.post_url from client_post_metrics m
    where s.post_ref is not null and m.social_id like '%' || substring(s.post_ref from '(\d{15,})') || '%'
    order by m.captured_at desc limit 1
  ) pm on true
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
  -- 20261020 (Ivan: an ICP owner engaging the seat's post should appear on signals, and get a drafted
  -- follow-up when already in outreach). A person who replied before and went quiet joins only on a
  -- post reaction or comment after our last message; a view or scan open alone keeps the old rule.
  and (p.stage in ('connected', 'dm_sent') or (p.stage in ('replied', 'positive_reply') and a.n_engagements > 0))
  -- our own seats are never a signal (Ivan's own thread with Mattan sits in RISE's inbound campaign)
  and not exists (select 1 from integration_config ic
    where ic.key in ('unipile_linkedin_id', 'risedtc_linkedin_id', 'arch_linkedin_id', 'swishdm_linkedin_id')
      and nullif(ic.value, '') is not null
      and (p.linkedin_profile_id = ic.value or p.linkedin_url ilike '%' || ic.value || '%'))
  and not exists (
    select 1 from outreach_messages i
    where i.prospect_id = p.id and i.direction = 'inbound'
      and coalesce(i.is_reaction, false) = false and i.created_at > o.sent_at)
  and coalesce((p.enrichment_data->>'came_back_dismissed_at')::timestamptz, '-infinity') < a.last_signal_at
order by a.last_signal_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.inbox_interest_cards()
 RETURNS TABLE(prospect_id uuid, tenant text, name text, headline text, company text, title text, country text, icp_score integer, stage text, campaign text, linkedin_url text, dm_count integer, last_out_at timestamp with time zone, last_out_model text, last_out_text text, last_signal_at timestamp with time zone, n_views integer, n_engagements integer, signals jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with sig as (
  -- one view per person per day: the lane re-captures the same LinkedIn view on later days
  -- (Bob Generale read 8 views in 4 days on 2026-09-18 before this).
  (select distinct on (l.prospect_id, l.viewed_at::date)
         l.prospect_id, l.viewed_at as at, 'view'::text as kind, null::text as detail, null::text as post_ref
  from profile_view_log l
  join outreach_prospects vp on vp.id = l.prospect_id
  join outreach_campaigns vc on vc.id = vp.campaign_id and coalesce(vc.client_id, 'ivan') = l.seat
  where l.prospect_id is not null and l.viewed_at >= now() - interval '21 days'
  order by l.prospect_id, l.viewed_at::date, l.viewed_at desc)
  union all
  select e.prospect_id, coalesce(e.first_seen_at, e.last_seen_at), coalesce(nullif(e.engagement_type, ''), 'reaction'),
         left(e.comment_text, 240), e.post_social_id
  from post_engagers e
  where e.prospect_id is not null and coalesce(e.first_seen_at, e.last_seen_at) >= now() - interval '21 days'
  union all
  -- 097: they opened the scan we sent. The scan URL is one per prospect, so the slug in OUR sent
  -- message is the join (scans.prospect_token is null on every outreach scan, measured 2026-09-18).
  -- A scan_opens row is only trusted as a PERSON when it arrived from linkedin.com or inside the
  -- LinkedIn app, 5+ minutes after the send: 29 of the 21-day "opens" landed inside 2 minutes of the
  -- send (LinkedIn's link preview) and others were our own headless tools. One open per person per day.
  -- 211 (Ivan 2026-09-23): "we shouldn't be saying came back, no reply unless they open the scan
  -- again". Everyone opens the scan once; a first open is not a signal and was filling this section.
  -- Only an open 1h+ after that person's FIRST trusted open counts. The first open is found over all
  -- time, so a reopen today still counts when the first open fell outside the 21-day window.
  (select distinct on (t.prospect_id, t.opened_at::date)
         t.prospect_id, t.opened_at, 'scan_open'::text, null::text, null::text
  from (
    select sl.prospect_id, so.opened_at,
           min(so.opened_at) over (partition by sl.prospect_id) as first_open_at
    from scan_opens so
    -- 247: ARCH audit pages (madebyarch.com/<folder>-audit/) log opens as company_slug 'arch-<folder>'.
    join (select m.prospect_id, min(m.sent_at) as sent_at,
                 coalesce(lower(substring(m.message_text from '/scan/([A-Za-z0-9_-]+)')),
                          'arch-' || lower(substring(m.message_text from 'madebyarch\.com/([A-Za-z0-9_-]+-audit)'))) as slug
          from outreach_messages m
          where m.direction = 'outbound' and m.sent_at is not null
            and m.message_text ~ '(/scan/[A-Za-z0-9_-]+|madebyarch\.com/[A-Za-z0-9_-]+-audit)'
          group by 1, 3) sl on lower(so.company_slug) = sl.slug
    where so.is_owner = false
      and so.opened_at > sl.sent_at + interval '5 minutes'
      and so.user_agent !~* 'headless|bot|crawler|spider|preview'
      and (so.referrer_host ilike '%linkedin%' or so.user_agent ilike '%LinkedInApp%')
  ) t
  where t.opened_at >= now() - interval '21 days'
    and t.opened_at > t.first_open_at + interval '1 hour'
  order by t.prospect_id, t.opened_at::date, t.opened_at)
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
         count(*) filter (where s.kind not in ('view', 'scan_open'))::integer as n_engagements,
         case when bool_or(v.profile_return) and bool_or(s.kind in ('comment', 'scan_open')) then 3
              when bool_or(v.profile_return) or bool_or(s.kind <> 'view') then 2
              else 1 end as priority,
         jsonb_agg(jsonb_build_object('kind', s.kind, 'at', s.at, 'detail', s.detail, 'post_title', pm.title, 'post_url', pm.post_url, 'profile_return', case when s.kind = 'view' then v.profile_return end) order by s.at desc) as signals
  from sig s
  join last_out o on o.prospect_id = s.prospect_id and s.at > o.sent_at
  left join lateral (
    select exists (
      select 1 from profile_view_log earlier
      join outreach_prospects ep on ep.id = earlier.prospect_id
      join outreach_campaigns ec on ec.id = ep.campaign_id
      where earlier.prospect_id = s.prospect_id
        and earlier.seat = coalesce(ec.client_id, 'ivan')
        and earlier.viewed_at > o.sent_at
        and earlier.viewed_at <= s.at - interval '24 hours'
    ) as profile_return
  ) v on s.kind = 'view'
  -- 20260924 (Ivan 2026-09-24 "doesnt say to what post they reacted"): the post they engaged with, from our own post tracker.
  left join lateral (
    select m.title, m.post_url from client_post_metrics m
    where s.post_ref is not null and m.social_id like '%' || substring(s.post_ref from '(\d{15,})') || '%'
    order by m.captured_at desc limit 1
  ) pm on true
  -- 246 (Ivan 2026-10-09, Amar Willem Thomas: one view 40h after DM1 sat in Signals): a lone view
  -- must be days after our message. Measured on 1,485 first DMs (75d): one view 24-72h after = 1/5
  -- replied (no-view baseline 20%), one view 72h+ after = 7/21 (33%). A verified return still counts.
  where s.kind <> 'view' or s.at >= o.sent_at + interval '72 hours' or v.profile_return
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
  -- 20261020 (Ivan: an ICP owner engaging the seat's post should appear on signals, and get a drafted
  -- follow-up when already in outreach). A person who replied before and went quiet joins only on a
  -- post reaction or comment after our last message; a view or scan open alone keeps the old rule.
  and (p.stage in ('connected', 'dm_sent') or (p.stage in ('replied', 'positive_reply') and a.n_engagements > 0))
  -- our own seats are never a signal (Ivan's own thread with Mattan sits in RISE's inbound campaign)
  and not exists (select 1 from integration_config ic
    where ic.key in ('unipile_linkedin_id', 'risedtc_linkedin_id', 'arch_linkedin_id', 'swishdm_linkedin_id')
      and nullif(ic.value, '') is not null
      and (p.linkedin_profile_id = ic.value or p.linkedin_url ilike '%' || ic.value || '%'))
  and not exists (
    select 1 from outreach_messages i
    where i.prospect_id = p.id and i.direction = 'inbound'
      and coalesce(i.is_reaction, false) = false and i.created_at > o.sent_at)
  and coalesce((p.enrichment_data->>'came_back_dismissed_at')::timestamptz, '-infinity') < a.last_signal_at
order by a.priority desc, a.last_signal_at desc;
$function$;

-- New ICP store owners who engaged a client's own post and are not in that client's outreach yet.
-- Source: client_post_engagers (the client post judge: side + icp_score). RISE only today.
create table if not exists public.owner_engager_dismissals (
  client_id text not null,
  profile_id text not null,
  dismissed_at timestamptz not null default now(),
  primary key (client_id, profile_id)
);
alter table public.owner_engager_dismissals enable row level security;
revoke all on public.owner_engager_dismissals from public, anon, authenticated;

create or replace function public.owner_engager_cards()
 returns table(tenant text, profile_id text, name text, headline text, linkedin_url text, icp_score integer,
               why text, n_engagements integer, last_signal_at timestamptz, signals jsonb)
 language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $f$
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.outreach_agent_accounts a
    where a.client_id = 'ivan' and auth.uid() = any(a.operator_ids)
  ) then raise exception 'operator_denied' using errcode = '42501'; end if;
  return query
  with e as (
    select e.client_id, e.profile_id, e.name, e.headline, e.public_slug, e.icp_score, e.judged_why, e.icp_reasoning,
           e.kind, e.seen_at, m.title, m.post_url
    from client_post_engagers e
    left join client_post_metrics m on m.id = e.post_id and m.client_id = e.client_id
    where e.client_id = 'risedtc' and e.side = 'owner' and e.icp_score >= 7 and e.seen_at >= now() - interval '21 days'
      and nullif(e.profile_id, '') is not null
      and not exists (select 1 from integration_config ic where ic.key in ('unipile_linkedin_id', 'risedtc_linkedin_id', 'arch_linkedin_id', 'swishdm_linkedin_id') and ic.value = e.profile_id)
      -- Match names from the existing exclusion list as whole phrases in the public headline.
      -- JustUs is already a RISE client and must never become a new-owner outreach card.
      and not exists (
        select 1 from client_post_engagers known,
          jsonb_array_elements_text(coalesce((select ic.value::jsonb from integration_config ic where ic.key = 'rise_do_not_target'), '[]'::jsonb)) entry
        where known.client_id = e.client_id and known.profile_id = e.profile_id
          and length(regexp_replace(lower(entry), '[^a-z0-9]', '', 'g')) >= 4
          and position(' ' || trim(regexp_replace(lower(entry), '[^a-z0-9]+', ' ', 'g')) || ' '
            in ' ' || trim(regexp_replace(lower(coalesce(known.name, '') || ' ' || coalesce(known.headline, '')), '[^a-z0-9]+', ' ', 'g')) || ' ') > 0
      )
      and not exists (select 1 from outreach_prospects p join outreach_campaigns c on c.id = p.campaign_id
                      where c.client_id = e.client_id and (p.linkedin_profile_id = e.profile_id
                        or li_slug(p.linkedin_url) = lower(nullif(e.public_slug, ''))
                        or li_slug(p.linkedin_url) = li_slug(e.linkedin_url)))
  )
  select e.client_id, e.profile_id, (array_agg(e.name order by e.seen_at desc))[1],
         (array_agg(e.headline order by e.seen_at desc))[1],
         'https://www.linkedin.com/in/' || coalesce((array_agg(e.public_slug order by e.seen_at desc) filter (where e.public_slug is not null))[1], e.profile_id),
         max(e.icp_score)::integer,
         (array_agg(coalesce(e.judged_why, e.icp_reasoning) order by e.seen_at desc))[1],
         count(*)::integer, max(e.seen_at),
         jsonb_agg(jsonb_build_object('kind', coalesce(nullif(e.kind, ''), 'reaction'), 'at', e.seen_at,
                                      'post_title', e.title, 'post_url', e.post_url) order by e.seen_at desc)
  from e
  left join owner_engager_dismissals d on d.client_id = e.client_id and d.profile_id = e.profile_id
  group by e.client_id, e.profile_id, d.dismissed_at
  having d.dismissed_at is null or max(e.seen_at) > d.dismissed_at
  order by max(e.seen_at) desc;
end;
$f$;

-- Dismiss returns only on a newer engagement (same rule as came_back_dismiss).
create or replace function public.owner_engager_dismiss(p_client_id text, p_profile_id text)
 returns boolean language plpgsql volatile security definer set search_path to 'public', 'pg_temp'
as $f$
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.outreach_agent_accounts a
    where a.client_id = 'ivan' and auth.uid() = any(a.operator_ids)
  ) then raise exception 'operator_denied' using errcode = '42501'; end if;
  insert into owner_engager_dismissals(client_id, profile_id) values (p_client_id, p_profile_id)
  on conflict (client_id, profile_id) do update set dismissed_at = now();
  return true;
end;
$f$;

create or replace function public.owner_engager_undismiss(p_client_id text, p_profile_id text)
 returns boolean language plpgsql volatile security definer set search_path to 'public', 'pg_temp'
as $f$
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.outreach_agent_accounts a
    where a.client_id = 'ivan' and auth.uid() = any(a.operator_ids)
  ) then raise exception 'operator_denied' using errcode = '42501'; end if;
  delete from owner_engager_dismissals where client_id = p_client_id and profile_id = p_profile_id;
  return found;
end;
$f$;

revoke all on function public.owner_engager_cards() from public, anon;
revoke all on function public.owner_engager_dismiss(text, text) from public, anon;
revoke all on function public.owner_engager_undismiss(text, text) from public, anon;
grant execute on function public.owner_engager_cards() to authenticated, service_role;
grant execute on function public.owner_engager_dismiss(text, text) to authenticated, service_role;
grant execute on function public.owner_engager_undismiss(text, text) to authenticated, service_role;

commit;
