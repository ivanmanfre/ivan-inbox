-- 077: the two operator RPCs behind the lead magnet surfaces. Additive only: no existing
-- function is touched. Both follow the db/071 shape (gate check, seat check, security definer,
-- fixed search_path, stable, revoke from public/anon).
--
--   operator_lead_magnets  our own side: one row per lead magnet with its posts, comments,
--                          gate DMs, CTA clicks and calls, plus the denominators the frontend
--                          needs to apply its own >= 2 posts floor.
--   operator_gated_posts   the competitor side: roster posts the gate judge marked gated,
--                          joined to competitor_followers on a normalised profile URL.
--
-- Tenancy note from the phase 1 inventory: lead_magnets and lm_funnel_by_slug store Ivan's rows
-- as client_id IS NULL, while client_post_metrics uses the literal 'ivan'. Both conventions are
-- handled below. lm_performance, lm_dashboard_performance, gate_keyword_performance,
-- lm_attribution, own_posts_scored and ivan_post_outcome_spine carry no client_id at all: they
-- are reached only through a lead_magnets row that has already been scoped to the seat, so no
-- tenant can see another tenant's rows through them.

create or replace function public.operator_lead_magnets(p_gate text, p_client_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_since timestamptz := now() - interval '91 days';
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client_id not in ('ivan','risedtc','arch') then raise exception 'unknown seat'; end if;
  return (
    with lm as (
      select l.slug, l.gate_keyword, l.linkedin_social_id, l.post_url, l.title, l.status
      from public.lead_magnets l
      where l.slug is not null
        and ((p_client_id = 'ivan' and l.client_id is null) or l.client_id = p_client_id)
    ),
    -- Posts attributed to a lead magnet. Ivan's own posts live in own_posts_scored; the client
    -- lanes' live in client_post_metrics. A post is attributed by its explicit slug stamp or by
    -- matching the lead magnet's linkedin_social_id / post_url. Nothing is inferred from text.
    attributed as (
      select m.slug, o.social_id as post_key, o.posted_at, o.num_comments as comments
      from lm m
      join public.own_posts_scored o
        on p_client_id = 'ivan'
       and (o.lead_magnet_slug = m.slug
            or (m.linkedin_social_id is not null and o.social_id = m.linkedin_social_id))
      where o.posted_at >= v_since
      union
      select m.slug, c.social_id, c.published_at, c.comments
      from lm m
      join public.client_post_metrics c
        on p_client_id <> 'ivan'
       and c.client_id = p_client_id
       and ((m.linkedin_social_id is not null and c.social_id = m.linkedin_social_id)
            or (m.post_url is not null and c.post_url = m.post_url))
      where c.published_at >= v_since
    ),
    agg as (
      select slug,
             count(distinct post_key) as posts,
             coalesce(sum(comments), 0) as comments,
             min(posted_at) as first_post,
             max(posted_at) as last_post
      from attributed group by slug
    ),
    -- Gate DMs: the keyword worker's own ledger, plus Ivan's outcome spine for posts that
    -- carry the lead magnet's social id. Whichever is larger is reported, never the sum, so a
    -- post counted in both ledgers is not double counted.
    dms as (
      select m.slug,
             greatest(
               coalesce((select sum(g.dms_sent) from public.gate_keyword_performance g where g.slug = m.slug), 0),
               coalesce((select sum(sp.comment_gate_dms) from public.ivan_post_outcome_spine sp
                         where p_client_id = 'ivan' and m.linkedin_social_id is not null
                           and sp.post_social_id = m.linkedin_social_id), 0)
             ) as gate_dms
      from lm m
    ),
    clicks as (
      select m.slug,
             coalesce((select max(d.cta_clicks_all) from public.lm_dashboard_performance d where d.slug = m.slug),
                      (select max(p.cta_clicks) from public.lm_performance p where p.slug = m.slug)) as cta_clicks
      from lm m
    ),
    -- Calls are only claimed where a booking actually carries the slug. lm_attribution held a
    -- single test row at build time, so this returns null on every lane today. Null means not
    -- attributable, never zero calls: see calls_note.
    calls as (
      select m.slug,
             (select count(*) from public.lm_attribution a
              where a.lm_slug = m.slug and a.booked_at is not null) as booked
      from lm m
    )
    select jsonb_build_object(
      'since', v_since,
      'calls_note', 'calls is null when no booking carries the lead magnet slug. lm_attribution is the only booking ledger keyed by slug and it holds no production row, so calls reads null on every lane today. A null here means not attributable, it does not mean zero calls.',
      'lms', coalesce((
        select jsonb_agg(jsonb_build_object(
            'slug', m.slug,
            'title', m.title,
            'status', m.status,
            'keyword', m.gate_keyword,
            'posts', coalesce(a.posts, 0),
            'comments', coalesce(a.comments, 0),
            'gate_dms', d.gate_dms,
            'cta_clicks', c.cta_clicks,
            'calls', case when k.booked > 0 then k.booked else null end,
            'first_post', a.first_post,
            'last_post', a.last_post,
            'per_post_comments', case when coalesce(a.posts, 0) > 0
                                 then round(a.comments::numeric / a.posts, 2) else null end)
          order by coalesce(a.posts, 0) desc, coalesce(c.cta_clicks, 0) desc, m.slug)
        from lm m
        left join agg a on a.slug = m.slug
        left join dms d on d.slug = m.slug
        left join clicks c on c.slug = m.slug
        left join calls k on k.slug = m.slug
      ), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.operator_lead_magnets(text, text) from public, anon;
grant execute on function public.operator_lead_magnets(text, text) to authenticated, service_role;


create or replace function public.operator_gated_posts(p_gate text, p_client_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_since timestamptz := now() - interval '91 days';
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client_id not in ('ivan','risedtc','arch') then raise exception 'unknown seat'; end if;
  return (
    with src as (
      select p.linkedin_post_url as post_ref, p.competitor_name as author,
             p.linkedin_profile_url as author_url, p.post_date as posted_at,
             p.likes_count as likes, p.comments_count as comments, p.reposts_count as reposts
      from public.competitor_posts p
      where p_client_id = 'ivan' and (p.client_id is null or p.client_id = 'ivan')
        and p.post_date >= v_since
      union all
      select p.linkedin_post_url, p.competitor_name, p.linkedin_profile_url, p.post_date,
             p.likes_count, p.comments_count, p.reposts_count
      from public.audn_competitor_posts p
      where p_client_id <> 'ivan' and p.client_id = p_client_id
        and p.post_date >= v_since
    ),
    judged as (
      select s.*, j.is_gated, j.cta_kind, j.gate_keyword, j.offer, j.confidence
      from src s
      join public.competitor_gated_posts j
        on j.post_ref = s.post_ref and j.client_id = p_client_id
    ),
    -- Follower join on a normalised profile URL: lowercased, query stripped, trailing slash
    -- stripped, on both sides. A competitor with no row, or a row with no count, stays null:
    -- size unknown is reported as unknown, never as zero.
    withfoll as (
      select j.*, f.follower_count, f.source as followers_source
      from judged j
      left join lateral (
        select cf.follower_count, cf.source
        from public.competitor_followers cf
        where cf.client_id = p_client_id
          and regexp_replace(regexp_replace(lower(cf.linkedin_profile_url), '\?.*$', ''), '/+$', '')
            = regexp_replace(regexp_replace(lower(j.author_url), '\?.*$', ''), '/+$', '')
        order by cf.observed_at desc nulls last
        limit 1
      ) f on j.author_url is not null
    )
    select jsonb_build_object(
      'since', v_since,
      'judged', (select count(*) from judged),
      'gated', (select count(*) from judged where is_gated),
      'posts', coalesce((
        select jsonb_agg(jsonb_build_object(
            'post_ref', post_ref, 'author', author, 'author_url', author_url,
            'posted_at', posted_at, 'likes', likes, 'comments', comments, 'reposts', reposts,
            'follower_count', follower_count, 'followers_source', followers_source,
            'per_1k', case when follower_count is not null and follower_count > 0
                      then round(comments::numeric * 1000 / follower_count, 3) else null end,
            'cta_kind', cta_kind, 'gate_keyword', gate_keyword, 'offer', offer,
            'confidence', confidence)
          order by case when follower_count is not null and follower_count > 0
                   then round(comments::numeric * 1000 / follower_count, 3) else null end desc nulls last,
                   comments desc nulls last)
        from withfoll where is_gated
      ), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.operator_gated_posts(text, text) from public, anon;
grant execute on function public.operator_gated_posts(text, text) to authenticated, service_role;
