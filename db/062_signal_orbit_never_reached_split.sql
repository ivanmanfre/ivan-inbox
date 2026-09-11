-- 062_signal_orbit_never_reached_split.sql — split the Orbit "never reached" bucket in three.
-- Goal run own-engager-promotion-2026-09-12. Requires 058_signal_orbit_events.sql.
--
-- Filed as 062 (not 060) because 060/061 were already taken by the bot-thread work that
-- landed on main between the goal spec being written and this run (db/060_bot_thread.sql,
-- db/061_bot_tick_cron.sql). Signature of signal_graph is unchanged, so `create or replace`.
--
-- A person = one contact_id, never reached (no signal_events row that reaches stage s1) is
-- split into exactly three buckets, computed the same way for the per-person `nr`/`nrw`
-- fields and the `stats` counts so the two can never disagree:
--   judged_out   — never reached AND judged not-ICP by any of: max(post_engagers.icp_score) < 7
--                  (via contact_links), profile_view_log.icp_pass = false (via contact_links),
--                  or ANY of the person's prospect rows (this tenant) has
--                  stage in ('skipped','disqualified','archived') or blacklisted = true.
--   icp_unasked  — never reached AND NOT judged_out AND a positive judgement exists:
--                  max(post_engagers.icp_score) >= 7, or profile_view_log.icp_pass = true,
--                  or a prospect row's icp_score >= 7.
--   unjudged     — never reached AND neither of the above (no score anywhere).
-- judged_out + icp_unasked + unjudged == never_reached, by construction (the three arms are
-- mutually exclusive CASE branches over the same never-reached predicate).

-- Additive column: blacklisted, needed to compute judged_out. Nothing downstream selects
-- this view by ordinal position, so appending a column is safe.
create or replace view public.signal_prospect_links as
select cl.contact_id, p.id as prospect_id, p.campaign_id, coalesce(c.client_id,'ivan') as tenant,
       c.name as campaign_name, public.lane_of(c.name) as lane, p.stage, p.icp_score, p.skip_state,
       p.created_at as prospect_created_at, p.blacklisted
from public.contact_links cl
join public.outreach_prospects p on p.id::text = cl.source_id
join public.outreach_campaigns c on c.id = p.campaign_id
where cl.source_type = 'outreach_prospect' and cl.review_status <> 'rejected';

drop function if exists public.signal_graph(text, date, date);
create or replace function public.signal_graph(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb; t0 timestamptz := clock_timestamp();
begin
  if auth.role() not in ('authenticated','service_role') then raise exception 'signal_graph: not allowed'; end if;
  if p_client not in ('ivan','arch','risedtc') then raise exception 'signal_graph: unknown tenant %', p_client; end if;

  -- window first (the selective scan), then the all-time events of only those people
  with win as materialized (
    select contact_id, kind, at, prospect_id, campaign_id, post_id, text
    from signal_events
    where tenant = p_client and contact_id is not null and at is not null
      and at >= p_from::timestamptz and at < (p_to + 1)::timestamptz
  ),
  who as materialized (select distinct contact_id from win),
  ev as materialized (
    select e.contact_id, e.kind, e.at
    from signal_events e join who w on w.contact_id = e.contact_id
    where e.tenant = p_client and e.at is not null
  ),
  facts as (
    select e.contact_id,
      min(e.at) filter (where e.kind in ('reaction','comment','reply','view_in','view_out','like_out','comment_out')) s0,
      min(e.at) filter (where e.kind in ('invite','invite_note','withdraw','dm_out','inmail_out','email_out')) s1,
      min(e.at) filter (where e.kind = 'connected') s2,
      min(e.at) filter (where e.kind in ('dm_in','email_in')) s3,
      min(e.at) filter (where e.kind = 'booked') s4,
      min(e.at) filter (where e.kind in ('reaction','comment','reply','view_in')) first_in,
      min(e.at) t0, max(e.at) t1,
      bool_or(e.kind = 'view_in') v, bool_or(e.kind in ('reaction','comment','reply')) pg,
      count(*) filter (where e.kind in ('dm_in','email_in')) dmi,
      count(*) filter (where e.kind in ('dm_out','inmail_out')) dmo,
      count(*) filter (where e.at > now() - interval '24 hours') fresh
    from ev e join who w on w.contact_id = e.contact_id
    group by e.contact_id
  ),
  -- Never-reached judgement, computed once here and reused for both the per-person
  -- nr/nrw fields and the stats counts below. Every left-joined source can carry
  -- multiple rows per contact (multiple engager hits, multiple prospect campaigns);
  -- bool_or/max are invariant to the resulting cartesian duplication so no extra
  -- de-dup is needed.
  -- Every field below is a deliberately non-null boolean (or a numeric that is
  -- only ever read from a branch its own boolean has already guarded), so the
  -- CASE chains and stat filters below never hit SQL's three-valued-logic trap
  -- (bool_or/max over an all-NULL group returns NULL, not false, and NULL
  -- silently drops a row out of every branch that tests it with OR/NOT).
  judge as (
    select w.contact_id,
      -- 'max over the person's rows' per the spec: one score decides both
      -- engager_bad and engager_icp_pass, so a person with a 4 on one post and
      -- an 8 on another reads as icp_unasked (their best read is a pass), not
      -- judged_out.
      max(pe.icp_score) filter (where pe.icp_score is not null) as engager_max_all,
      coalesce((max(pe.icp_score) filter (where pe.icp_score is not null)) < 7, false) as engager_bad,
      coalesce((max(pe.icp_score) filter (where pe.icp_score is not null)) >= 7, false) as engager_icp_pass,
      bool_or(pvl.icp_pass is not null and pvl.icp_pass = false) as view_fail,
      bool_or(pvl.icp_pass is not null and pvl.icp_pass = true) as view_pass,
      bool_or(coalesce(spl.blacklisted, false)) as prospect_blacklisted,
      max(spl.stage) filter (where spl.stage in ('skipped','disqualified','archived')) as prospect_bad_stage,
      bool_or(spl.icp_score is not null and spl.icp_score >= 7) as prospect_icp_pass,
      max(spl.icp_score) filter (where spl.icp_score is not null and spl.icp_score >= 7) as prospect_icp_max
    from who w
    left join contact_links cl_pe on cl_pe.contact_id = w.contact_id and cl_pe.source_type = 'post_engager' and cl_pe.review_status <> 'rejected'
    left join post_engagers pe on pe.id::text = cl_pe.source_id
    left join contact_links cl_pv on cl_pv.contact_id = w.contact_id and cl_pv.source_type = 'profile_view' and cl_pv.review_status <> 'rejected'
    left join profile_view_log pvl on pvl.id::text = cl_pv.source_id
    left join signal_prospect_links spl on spl.contact_id = w.contact_id and spl.tenant = p_client
    group by w.contact_id
  ),
  pros as (
    select distinct on (pl.contact_id) pl.contact_id, pl.prospect_id, pl.campaign_id, pl.campaign_name, pl.lane, pl.stage, pl.icp_score, pl.skip_state
    from signal_prospect_links pl join who w on w.contact_id = pl.contact_id
    where pl.tenant = p_client
    order by pl.contact_id, pl.prospect_created_at desc
  ),
  evlist as (
    select contact_id, jsonb_agg(jsonb_build_object('t', kind, 'd', at, 'x', left(text,120), 'p', post_id) order by at) filter (where rn <= 40) ev
    from (select w.*, row_number() over (partition by contact_id order by at desc) rn from win w) x
    group by contact_id
  ),
  people as (
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'n', c.name, 'ti', coalesce(c.owner_notes, cl_head.h, ''), 'c', coalesce(c.company,''),
      'i', coalesce(pr.icp_score, c.icp_score), 'url', c.linkedin_url, 'mid', c.linkedin_member_id,
      'pid', pr.prospect_id, 'camp', pr.campaign_id, 'lane', coalesce(pr.lane, 'content'), 'pstage', pr.stage, 'skip', pr.skip_state,
      'st', case when f.s4 is not null then 4 when f.s3 is not null then 3 when f.s2 is not null then 2 when f.s1 is not null then 1 else 0 end,
      'sd', jsonb_build_array(f.s0, f.s1, coalesce(f.s2, f.s3, f.s4), coalesce(f.s3, f.s4), f.s4),
      't0', f.t0, 't1', f.t1, 'fresh', f.fresh,
      'inb', (f.first_in is not null and f.first_in <= coalesce(f.s1, 'infinity'::timestamptz)),
      'reached', f.s1 is not null, 'v', f.v, 'pg', f.pg, 'dmi', f.dmi, 'dmo', f.dmo,
      -- never-reached split: null once reached, otherwise exactly one of the three buckets
      'nr', case when f.s1 is not null then null
                 when j.engager_bad or j.view_fail or j.prospect_blacklisted or j.prospect_bad_stage is not null then 'judged_out'
                 when j.engager_icp_pass or j.view_pass or j.prospect_icp_pass then 'icp_unasked'
                 else 'unjudged' end,
      'nrw', case when f.s1 is not null then null
                  when j.engager_bad then 'Judged out: engager rubric ' || round(j.engager_max_all)::int || '/10'
                  when j.view_fail then 'Judged out: profile-view judge failed'
                  when j.prospect_blacklisted then 'Judged out: blacklisted'
                  when j.prospect_bad_stage is not null then 'Judged out: stage ' || j.prospect_bad_stage
                  when j.engager_icp_pass then 'ICP ' || round(j.engager_max_all)::int || ', never asked'
                  when j.view_pass then 'ICP pass (profile view), never asked'
                  when j.prospect_icp_pass then 'ICP ' || j.prospect_icp_max::int || ', never asked'
                  else 'Not yet judged' end,
      'ev', coalesce(el.ev, '[]'::jsonb)
    ) order by f.t0) j, count(*) n
    from facts f
    join contacts c on c.id = f.contact_id
    left join pros pr on pr.contact_id = f.contact_id
    left join judge j on j.contact_id = f.contact_id
    left join evlist el on el.contact_id = f.contact_id
    left join lateral (select cl.source_ref->>'headline' h from contact_links cl where cl.contact_id = f.contact_id and cl.source_ref ? 'headline' order by cl.created_at desc limit 1) cl_head on true
  ),
  -- Same predicates as the per-person 'nr' branches above, aggregated to counts so the
  -- stats object and the per-person field can never drift apart.
  nrstats as (
    select
      count(*) filter (where f.s1 is null) as never_reached,
      count(*) filter (where f.s1 is null and (j.engager_bad or j.view_fail or j.prospect_blacklisted or j.prospect_bad_stage is not null)) as judged_out,
      count(*) filter (where f.s1 is null
        and not (j.engager_bad or j.view_fail or j.prospect_blacklisted or j.prospect_bad_stage is not null)
        and (j.engager_icp_pass or j.view_pass or j.prospect_icp_pass)) as icp_unasked,
      count(*) filter (where f.s1 is null
        and not (j.engager_bad or j.view_fail or j.prospect_blacklisted or j.prospect_bad_stage is not null)
        and not (j.engager_icp_pass or j.view_pass or j.prospect_icp_pass)) as unjudged
    from facts f left join judge j on j.contact_id = f.contact_id
  ),
  postrows as (
    select o.social_id id, o.posted_at d, left(o.post_text, 160) txt, o.num_likes li, o.num_comments cm, o.num_impressions im, o.linkedin_url url, o.id::text row_id
    from own_posts o where p_client = 'ivan' and o.social_id is not null
      and (o.posted_at::date between p_from and p_to or o.social_id in (select post_id from win where post_id is not null))
    union all
    select m.social_id, m.published_at, left(m.title, 160), m.reactions, m.comments, m.impressions, m.post_url, m.id::text
    from client_post_metrics m where m.client_id = p_client and m.social_id is not null
      and (m.published_at::date between p_from and p_to or m.social_id in (select post_id from win where post_id is not null))
  ),
  posts as (
    select jsonb_agg(jsonb_build_object('id', id, 'd', d, 'txt', txt, 'li', li, 'cm', cm, 'im', im, 'url', url, 'row', row_id) order by d) j, count(*) n from postrows
  ),
  cedges as (
    select jsonb_agg(jsonb_build_object('s', contact_id, 't', post_id, 'k', kind, 'd', d)) j, count(*) n
    from (select contact_id, post_id, kind, min(at) d from win where post_id is not null and kind in ('reaction','comment') group by 1,2,3) x
  ),
  lanes as (
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'lane', lane_of(c.name), 'active', (c.is_active and not c.archived),
                                        'n', (select count(distinct pr.contact_id) from pros pr where pr.campaign_id = c.id)) order by c.name) j
    from outreach_campaigns c
    where coalesce(c.client_id,'ivan') = p_client
      and ((c.is_active and not c.archived) or exists (select 1 from pros pr where pr.campaign_id = c.id))
  )
  select jsonb_build_object(
    'tenant', p_client, 'from', p_from, 'to', p_to, 'generated_at', now(),
    'people', coalesce(people.j, '[]'::jsonb), 'posts', coalesce(posts.j, '[]'::jsonb),
    'content_edges', coalesce(cedges.j, '[]'::jsonb), 'lanes', coalesce(lanes.j, '[]'::jsonb),
    'stats', jsonb_build_object('people', people.n, 'posts', posts.n, 'content_edges', cedges.n,
      'events', (select count(*) from win),
      'never_reached', coalesce(nrstats.never_reached, 0),
      'judged_out', coalesce(nrstats.judged_out, 0),
      'icp_unasked', coalesce(nrstats.icp_unasked, 0),
      'unjudged', coalesce(nrstats.unjudged, 0),
      -- clock domain. t_min_abs is the true earliest touch; t_min is the 1st percentile, because a
      -- handful of imported 2013-2020 LinkedIn chats would otherwise collapse the whole dial into a
      -- sliver. The client lays out on t_min and pins anything older to the domain start.
      't_min_abs', (select min(at) from win),
      't_min', (select percentile_cont(0.01) within group (order by extract(epoch from at))
                from win),
      't_max', (select max(at) from win),
      'ms', round(extract(epoch from clock_timestamp() - t0) * 1000))
  ) into result
  from people, posts, cedges, lanes, nrstats;
  return result;
end $$;

revoke all on function public.signal_graph(text, date, date) from public, anon;
grant execute on function public.signal_graph(text, date, date) to authenticated, service_role;
