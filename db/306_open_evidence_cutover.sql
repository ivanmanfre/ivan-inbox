-- 306 open tracking truth, part 4: draft readers read the human class behind a cutover. Plan Task 7.
-- Requires 303-305. Readers: n8n qCCZhgogk549PP6v (evidence RPCs + came_back_cards, writes bump drafts) and the inbox app
-- (inbox_interest_cards). Names, arguments and return columns are unchanged.
-- Links sent at or after the cutover: open_class = 'human'. Links sent before it: 'human' AND the lane's old rule.
-- The second branch can only remove fake evidence from old links; it can never add an old prospect to a bump queue.

insert into public.integration_config (key, value) values ('open_class_cutover_at', now()::text)
on conflict (key) do nothing;

-- No row (or a bad value) means every link is "before the cutover": the old rule AND human, which only ever removes.
create or replace function public.open_class_cutover() returns timestamptz
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce((select value::timestamptz from public.integration_config where key = 'open_class_cutover_at'), 'infinity');
exception when others then
  return 'infinity';
end $$;
revoke all on function public.open_class_cutover() from public, anon;
grant execute on function public.open_class_cutover() to authenticated, service_role;

create or replace function public.human_scan_opens(p_lane text)
returns table (prospect_id uuid, slug text, sent_at timestamptz, opened_at timestamptz, device_type text, referrer_host text)
language sql stable security definer set search_path = public, pg_temp as $$
  with multi as (
    select so.ip_hash from public.scan_opens so where so.ip_hash is not null
    group by so.ip_hash having count(distinct lower(so.company_slug)) >= 3),
  sl as (
    select m.prospect_id, min(m.sent_at) as sent_at,
           lower(substring(m.message_text from '/scan/([A-Za-z0-9_-]+)')) as slug
    from public.outreach_messages m
    join public.outreach_prospects p on p.id = m.prospect_id
    join public.outreach_campaigns c on c.id = p.campaign_id
     and (case when p_lane = 'ivan' then c.client_id is null else c.client_id = p_lane end)
    where m.direction = 'outbound' and m.sent_at is not null and m.message_text ~ '/scan/[A-Za-z0-9_-]+'
      and m.sent_at > now() - interval '45 days'
    group by 1, 3)
  select sl.prospect_id, sl.slug, sl.sent_at, so.opened_at, so.device_type, so.referrer_host
    from sl
    join public.scan_opens so on lower(so.company_slug) = sl.slug
   where so.open_class = 'human'
     and so.opened_at > sl.sent_at
     and (sl.sent_at >= public.open_class_cutover() or (
           -- the lane's old rule (live bodies 2026-11-17)
           so.is_owner = false
       and so.opened_at > sl.sent_at + interval '5 minutes'
       and coalesce(so.user_agent, '') !~* 'headless|bot|crawler|spider|preview'
       and (p_lane <> 'risedtc' or (
             coalesce(so.user_agent, '') !~ '(Windows NT|Macintosh|X11|Linux x86)[^)]*\).*Chrome/[0-9]+\.0\.[1-9][0-9]*\.[0-9]+'
         and (so.ip_hash is null or so.ip_hash not in (select multi.ip_hash from multi))))))
$$;
revoke all on function public.human_scan_opens(text) from public, anon, authenticated;
grant execute on function public.human_scan_opens(text) to service_role;

create or replace function public.ivan_scan_open_evidence()
 returns table(prospect_id uuid, scan_slug text, scan_sent_at timestamp with time zone, open_days integer, real_opens integer, first_open_at timestamp with time zone, last_open_at timestamp with time zone, replied_after_scan boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  with o as (
    select h.prospect_id, h.slug, h.sent_at,
           count(distinct date_trunc('day', h.opened_at))::int as open_days,
           count(*)::int as real_opens,
           min(h.opened_at) as first_open_at, max(h.opened_at) as last_open_at
    from public.human_scan_opens('ivan') h
    group by 1, 2, 3)
  select o.prospect_id, o.slug, o.sent_at, o.open_days, o.real_opens, o.first_open_at, o.last_open_at,
         exists (select 1 from outreach_messages i where i.prospect_id = o.prospect_id and i.direction = 'inbound'
                 and coalesce(i.is_reaction, false) = false and i.created_at > o.sent_at) as replied_after_scan
  from o
$function$;

create or replace function public.rise_scan_open_evidence()
 returns table(prospect_id uuid, scan_slug text, scan_sent_at timestamp with time zone, open_days integer, real_opens integer, first_open_at timestamp with time zone, last_open_at timestamp with time zone, replied_after_scan boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  with o as (
    select h.prospect_id, h.slug, h.sent_at,
           count(distinct date_trunc('day', h.opened_at))::int as open_days,
           count(*)::int as real_opens,
           min(h.opened_at) as first_open_at, max(h.opened_at) as last_open_at
    from public.human_scan_opens('risedtc') h
    group by 1, 2, 3)
  select o.prospect_id, o.slug, o.sent_at, o.open_days, o.real_opens, o.first_open_at, o.last_open_at,
         exists (select 1 from outreach_messages i where i.prospect_id = o.prospect_id and i.direction = 'inbound'
                 and coalesce(i.is_reaction, false) = false and i.created_at > o.sent_at) as replied_after_scan
  from o
$function$;

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
    -- 306 (2026-11-17): a person is open_class = 'human'. Links sent before the cutover also keep the old rule, so
    -- the relabel can only remove old evidence, never add an old prospect to a card.
    where so.open_class = 'human'
      and (sl.sent_at >= public.open_class_cutover() or (
            so.is_owner = false
        and so.opened_at > sl.sent_at + interval '5 minutes'
        and so.user_agent !~* 'headless|bot|crawler|spider|preview'
        and (so.referrer_host ilike '%linkedin%' or so.user_agent ilike '%LinkedInApp%')))
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
    -- 306 (2026-11-17): a person is open_class = 'human'. Links sent before the cutover also keep the old rule, so
    -- the relabel can only remove old evidence, never add an old prospect to a card.
    where so.open_class = 'human'
      and (sl.sent_at >= public.open_class_cutover() or (
            so.is_owner = false
        and so.opened_at > sl.sent_at + interval '5 minutes'
        and so.user_agent !~* 'headless|bot|crawler|spider|preview'
        and (so.referrer_host ilike '%linkedin%' or so.user_agent ilike '%LinkedInApp%')))
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
