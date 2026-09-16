-- 070: operator_post_audience returns {posts, followers}. Each post also carries
-- the tracker's winner flag, funnel class, profile views, the hook type from
-- Ivan's outcome spine, and the reuse idea (client_ideas.reuse_of) when one was
-- staged. followers = the lane's latest follower count. Same signature as 069.
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
        select m.reactions, m.comments, m.profile_views_from_post
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
