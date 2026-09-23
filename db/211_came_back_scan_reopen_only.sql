-- 211: came_back_cards() stops counting a FIRST scan open as "came back".
-- Ivan 2026-09-23: "everyone is going to open it... It's not a super strong signal... we shouldn't be
-- saying 'came back, no reply' unless they open the scan again." Built on the LIVE definition
-- (engagements keyed on first_seen_at, per the 09-21 last-seen restamp fix), not on db/097's text.
-- Readers: inbox Came-back section (src/wb/dms/cameBackData.ts) + Stalled Conversation Bump's
-- came-back arm. A first-open-only prospect falls back to the ordinary stalled bump.

create or replace function public.came_back_cards()
 RETURNS TABLE(prospect_id uuid, tenant text, name text, headline text, company text, title text, country text, icp_score integer, stage text, campaign text, linkedin_url text, dm_count integer, last_out_at timestamp with time zone, last_out_model text, last_out_text text, last_signal_at timestamp with time zone, n_views integer, n_engagements integer, signals jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with sig as (
  -- one view per person per day: the lane re-captures the same LinkedIn view on later days
  -- (Bob Generale read 8 views in 4 days on 2026-09-18 before this).
  (select distinct on (l.prospect_id, l.viewed_at::date)
         l.prospect_id, l.viewed_at as at, 'view'::text as kind, null::text as detail
  from profile_view_log l
  where l.prospect_id is not null and l.viewed_at >= now() - interval '21 days'
  order by l.prospect_id, l.viewed_at::date, l.viewed_at)
  union all
  select e.prospect_id, coalesce(e.first_seen_at, e.last_seen_at), coalesce(nullif(e.engagement_type, ''), 'reaction'),
         left(e.comment_text, 240)
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
         t.prospect_id, t.opened_at, 'scan_open'::text, null::text
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
$function$;
