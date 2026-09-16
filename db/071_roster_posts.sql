-- 071: (a) operator_post_audience also carries the tracker's share (repost) count,
--          same {posts, followers} shape as 070, additive key only;
--      (b) operator_roster_posts: the watch roster's posts (client_registry
--          platform.measurement.roster, roles direct_competitor / buyer_voice /
--          format_reference / warm_anchor) from the last 91 days (covers 12 ISO
--          weeks) with comments, reposts and, on Ivan's lane, the analysed angle fields.
--          Text travels only for each author's three most commented posts and
--          for posts with an angle. No reach or demographics exist for anyone
--          but the author, so none are claimed here.
create or replace function public.operator_post_audience(p_gate text, p_client_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client_id not in ('ivan','risedtc','arch') then raise exception 'unknown seat'; end if;
  return jsonb_build_object(
    'posts', coalesce((
      select jsonb_agg(
        to_jsonb(r) || jsonb_build_object(
          'reactions', coalesce(t.reactions, h.reactions),
          'comments', coalesce(t.comments, h.comments),
          'shares', t.shares,
          'profile_views', t.profile_views_from_post,
          'is_winner', coalesce(w.is_winner, false),
          'winner_detected_at', w.winner_detected_at,
          'funnel_class', w.funnel_class,
          'hook_type', s.hook_type,
          'reuse', case when ri.status is null then null
                   else jsonb_build_object('status', ri.status, 'eligible_at', ri.eligible_at, 'title', ri.title) end)
        order by r.published_at desc nulls last)
      from public.post_audience_rows(p_client_id) r
      left join lateral (
        select m.reactions, m.comments, m.shares, m.profile_views_from_post
        from public.client_post_metrics m,
          lateral (select coalesce(substring(m.post_url from 'activity[-:](\d{15,})'),
                                   substring(m.social_id from 'activity:(\d+)')) as aid) x
        where r.source = 'tracker' and m.client_id = p_client_id and x.aid = r.activity_id
        order by m.captured_at desc nulls last
        limit 1
      ) t on true
      left join lateral (
        select bool_or(m.is_winner) as is_winner, min(m.winner_detected_at) as winner_detected_at,
               max(m.funnel_class) as funnel_class, array_agg(m.id::text) as ids
        from public.client_post_metrics m,
          lateral (select coalesce(substring(m.post_url from 'activity[-:](\d{15,})'),
                                   substring(m.social_id from 'activity:(\d+)')) as aid) x
        where r.source = 'tracker' and m.client_id = p_client_id and x.aid = r.activity_id
      ) w on true
      left join lateral (
        select ci.status, ci.eligible_at, ci.title
        from public.client_ideas ci
        where ci.client_id = p_client_id and ci.reuse_of is not null and ci.reuse_of::text = any(w.ids)
        order by ci.created_at desc
        limit 1
      ) ri on true
      left join lateral (
        select sp.hook_type from public.ivan_post_outcome_spine sp
        where p_client_id = 'ivan' and sp.post_social_id = 'urn:li:activity:' || r.activity_id and sp.hook_type is not null
        limit 1
      ) s on true
      left join public.post_audience_history h
        on r.source = 'backfill' and h.seat = p_client_id and h.activity_id = r.activity_id
    ), '[]'::jsonb),
    'followers', (
      select jsonb_build_object('count', f.follower_count, 'date', f.date)
      from public.linkedin_follower_history f
      where f.client_id = p_client_id and f.follower_count is not null
      order by f.date desc
      limit 1));
end $$;

create or replace function public.operator_roster_posts(p_gate text, p_client_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_since timestamptz := now() - interval '91 days';
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client_id not in ('ivan','risedtc','arch') then raise exception 'unknown seat'; end if;
  return (
    with roster as (
      select x->>'account' as account, x->>'role' as role, coalesce(x->'aliases', '[]'::jsonb) as aliases
      from public.client_registry r
      cross join lateral jsonb_array_elements(coalesce(r.platform->'measurement'->'roster', '[]'::jsonb)) x
      where r.client_id = p_client_id
        and x->>'role' in ('direct_competitor', 'buyer_voice', 'format_reference', 'warm_anchor')
    ),
    src as (
      select p.competitor_name as who, p.post_date as at,
             p.comments_count as comments, p.reposts_count as reposts,
             p.linkedin_post_url as url, p.post_text as body,
             p.suggested_angle as angle, p.post_topic as topic, p.opportunity_actioned as actioned
      from public.competitor_posts p
      where p_client_id = 'ivan' and (p.client_id is null or p.client_id = 'ivan')
        and coalesce(p.competitor_role, '') <> 'killed' and p.post_date >= v_since
      union all
      select p.competitor_name, p.post_date, p.comments_count, p.reposts_count,
             p.linkedin_post_url, p.post_text, p.suggested_angle, null, null
      from public.audn_competitor_posts p
      where p_client_id <> 'ivan' and p.client_id = p_client_id
        and coalesce(p.competitor_role, '') <> 'killed' and p.post_date >= v_since
    ),
    matched as (
      select s.*, r.role
      from src s
      join lateral (
        select min(x.role) as role
        from roster x
        where lower(btrim(split_part(x.account, ' (', 1))) = lower(btrim(s.who))
           or exists (
             select 1 from jsonb_array_elements(x.aliases) a(value)
             where lower(btrim(a.value->>'name')) = lower(btrim(s.who))
               and lower(s.url) like '%/posts/' || lower(a.value->>'url_owner') || '\_%' escape '\')
        having count(*) = 1
      ) r on true
      where s.comments is not null and s.at is not null
    ),
    ranked as (
      select m.*, row_number() over (partition by m.who order by m.comments desc nulls last, m.at desc) as rn
      from matched m
    )
    select jsonb_build_object(
      'since', v_since,
      'roster', (select coalesce(jsonb_agg(jsonb_build_object('account', account, 'role', role) order by role, account), '[]'::jsonb) from roster),
      'posts', (select coalesce(jsonb_agg(jsonb_build_object(
          'who', who, 'role', role, 'at', at,
          'comments', comments, 'reposts', reposts, 'url', url,
          'text', case when rn <= 3 or angle is not null then left(coalesce(body, ''), 220) end,
          'angle', angle, 'topic', topic, 'actioned', actioned)
          order by at desc), '[]'::jsonb) from ranked)
    )
  );
end $$;

revoke all on function public.operator_roster_posts(text, text) from public, anon;
grant execute on function public.operator_roster_posts(text, text) to authenticated, service_role;
