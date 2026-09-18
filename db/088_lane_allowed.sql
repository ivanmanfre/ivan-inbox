-- 088: the seat allowlist reads client_registry instead of a literal lane triple.
--
-- Until now every lane-keyed operator RPC carried the same line:
--     if p_client_id not in ('ivan','risedtc','arch') then raise exception 'unknown seat'; end if;
-- so a fourth tenant could not be read at all, however complete its data was. This migration
-- replaces that literal with one function, lane_allowed(), and changes NOTHING else: each
-- function body below is byte-identical to the live definition apart from that single line.
--
-- The rule: a lane is allowed when client_registry says it is active AND it carries a non-empty
-- platform.measurement.roster array. Both halves matter. `is_active` is the operator's switch;
-- the roster is what makes the lane answerable at all -- operator_roster_posts reads that exact
-- array, so a lane without one has nothing to return and should not be a valid seat.
--
-- lane_allowed is deliberately NOT granted to anon or authenticated. Every caller is a
-- `security definer` function owned by the same role, so the guard runs as the owner, never as
-- the caller -- the same shape operator_gate_ok already has (anon false, authenticated false).
-- Granting it would widen the surface for no caller that exists.
--
-- The three live lanes (ivan, risedtc, arch) are all active with rosters of 14, 20 and 10, so
-- they keep passing and their RPC payloads are unchanged. Proof: the 15 md5 fingerprints in
-- goal-runs/client-research-launcher-2026-09-17-out/reports/fingerprint-before.json must match
-- fingerprint-after.json exactly.

create or replace function public.lane_allowed(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.client_registry r
    where r.client_id = p_client_id
      and coalesce(r.is_active, false)
      and jsonb_typeof(r.platform->'measurement'->'roster') = 'array'
      and jsonb_array_length(r.platform->'measurement'->'roster') > 0
  );
$fn$;

revoke all on function public.lane_allowed(text) from public;
revoke all on function public.lane_allowed(text) from anon;
revoke all on function public.lane_allowed(text) from authenticated;
grant execute on function public.lane_allowed(text) to service_role;

-- ---------------------------------------------------------------------------
-- operator_lead_magnets: guard line only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_lead_magnets(p_gate text, p_client_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_since timestamptz := now() - interval '91 days';
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if not public.lane_allowed(p_client_id) then raise exception 'unknown seat'; end if;
  return (
    with lm as (
      -- 080: one row per slug. lead_magnets carried a duplicated slug on Ivan's lane
      -- (agent-ready-letter, twice) and the per-slug joins below multiplied it into 16 rows,
      -- so the catalog denominator read 72 where 57 slugs exist. (083 deleted the older of the
      -- two rows; `distinct on (slug)` stays, because nothing stops a future duplicate.)
      select distinct on (l.slug) l.slug, l.gate_keyword, l.linkedin_social_id, l.post_url, l.title, l.status
      from public.lead_magnets l
      where l.slug is not null
        and ((p_client_id = 'ivan' and l.client_id is null) or l.client_id = p_client_id)
      order by l.slug, l.updated_at desc nulls last, l.created_at desc nulls last
    ),
    -- 086: each post source is read ONCE, windowed here, then joined to lm. The old shape joined
    -- own_posts_scored per lead magnet; that view carries a correlated subquery per row, so on a
    -- 57-slug lane it was scanned 57 times.
    own as (
      select o.social_id, o.posted_at, o.num_comments, o.lead_magnet_slug
      from public.own_posts_scored o
      where p_client_id = 'ivan' and o.posted_at >= v_since
    ),
    cpm as (
      select c.social_id, c.published_at, c.comments, c.lead_magnet_slug, c.post_url
      from public.client_post_metrics c
      where p_client_id <> 'ivan' and c.client_id = p_client_id and c.published_at >= v_since
    ),
    -- Posts attributed to a lead magnet. A post is attributed by its explicit slug stamp or by
    -- matching the lead magnet's linkedin_social_id / post_url. Nothing is inferred from text.
    -- `union` (not `union all`) plus count(distinct post_key) below: a post that matches two ways
    -- is one post.
    attributed as (
      select m.slug, o.social_id as post_key, o.posted_at, o.num_comments as comments
      from lm m
      join own o
        on o.lead_magnet_slug = m.slug
        or (m.linkedin_social_id is not null and o.social_id = m.linkedin_social_id)
      union
      select m.slug, c.social_id, c.published_at, c.comments
      from lm m
      join cpm c
        on c.lead_magnet_slug = m.slug                                            -- 086, new
        or (m.linkedin_social_id is not null and c.social_id = m.linkedin_social_id)
        or (m.post_url is not null and c.post_url = m.post_url)
    ),
    agg as (
      select slug,
             count(distinct post_key) as posts,
             coalesce(sum(comments), 0) as comments,
             min(posted_at) as first_post,
             max(posted_at) as last_post
      from attributed group by slug
    ),
    -- 086: the lane's own output in the window, and how much of it resolves to a lead magnet.
    -- Ivan's denominator is own_posts (not own_posts_scored, which is one row per own_post
    -- anyway, and not his client_post_metrics rows).
    lane_posts as (
      select o.social_id from public.own_posts o
       where p_client_id = 'ivan' and o.posted_at >= v_since and o.social_id is not null
      union all
      select c.social_id from public.client_post_metrics c
       where p_client_id <> 'ivan' and c.client_id = p_client_id
         and c.published_at >= v_since and c.social_id is not null
    ),
    lane_counts as (
      select count(*) filter (where a.post_key is not null) as attributed_posts,
             count(*) filter (where a.post_key is null)     as unattributed_posts
      from (select distinct social_id from lane_posts) lp
      left join (select distinct post_key from attributed) a on a.post_key = lp.social_id
    ),
    -- Gate DMs: the keyword worker's own ledger, plus Ivan's outcome spine for posts that
    -- carry the lead magnet's social id. Whichever is larger is reported, never the sum, so a
    -- post counted in both ledgers is not double counted.
    -- 078: each view is read ONCE into a per-key aggregate instead of once per lead magnet
    -- (72 correlated view scans took ~3 s on Ivan's lane and timed the section out).
    gk as (
      -- 084: gate_keyword_performance is an all-time aggregate of linkedin_comment_events by
      -- post_id; read the events directly so the count honours v_since like every other number.
      select m.slug, count(distinct lce.id) as dms_sent
      from lm m
      join public.linkedin_comment_events lce on lce.post_id = m.linkedin_social_id
      where m.gate_keyword is not null and lce.action_taken = 'dm_sent' and lce.created_at >= v_since
      group by m.slug
    ),
    spine as (
      -- 079: the spine view's comment_gate_dms is count(*) of linkedin_comment_events by
      -- post_id; read that table directly instead of the 1 s view.
      select lce.post_id as post_social_id, count(*) as dms from public.linkedin_comment_events lce
      where p_client_id = 'ivan' and lce.post_id in (select linkedin_social_id from lm where linkedin_social_id is not null)
        and lce.created_at >= v_since  -- 084
      group by lce.post_id
    ),
    dms as (
      select m.slug,
             greatest(coalesce(gk.dms_sent, 0), coalesce(spine.dms, 0)) as gate_dms
      from lm m
      left join gk on gk.slug = m.slug
      left join spine on spine.post_social_id = m.linkedin_social_id
    ),
    -- 079: lm_dashboard_performance and lm_performance both count distinct cta_click events
    -- per slug over lm_events (3 s cold through the views); read the events once.
    clicks as (
      select m.slug, coalesce(ev.cta, 0) as cta_clicks
      from lm m
      left join (
        select e.lm_slug, count(distinct e.id) as cta from public.lm_events e
        where e.event_type = 'cta_click' and e.lm_slug in (select slug from lm)
          and e.created_at >= v_since  -- 084
        group by e.lm_slug
      ) ev on ev.lm_slug = m.slug
    ),
    -- Calls are only claimed where a booking actually carries the slug, is not canceled, and
    -- landed inside the same window as every other number here. 086: aggregated once, and the
    -- `in (select slug from lm)` filter is what scopes the ledger to THIS lane -- lm_attribution
    -- has no client_id of its own. Null means not attributable, never zero calls: see calls_note.
    calls as (
      select m.slug, coalesce(b.booked, 0) as booked
      from lm m
      left join (
        select a.lm_slug, count(*) as booked
        from public.lm_attribution a
        where a.lm_slug in (select slug from lm)
          and coalesce(a.status, '') <> 'canceled'
          and coalesce(a.booked_at, a.created_at) >= v_since
        group by a.lm_slug
      ) b on b.lm_slug = m.slug
    ),
    calls_total as (select coalesce(sum(booked), 0) as n from calls),
    -- 083: the catalog row is built ONCE here. `lms` aggregates these objects in the catalog
    -- order; `best_own` picks one of the very same objects by a different order, so the answer on
    -- top is always a row the list below also shows.
    lmrows as (
      select jsonb_build_object(
               'slug', m.slug,
               'title', m.title,
               'status', m.status,
               'keyword', m.gate_keyword,
               'posts', coalesce(a.posts, 0),
               'comments', coalesce(a.comments, 0),
               'gate_dms', d.gate_dms,
               'cta_clicks', c.cta_clicks,
               -- 086: while the lane has no real booking at all, every row reads null and
               -- calls_note explains it. Once one booking lands, the lane reports real numbers
               -- and a lead magnet with none reads 0, which is a fact rather than a gap.
               'calls', case when (select n from calls_total) > 0 then k.booked else null end,
               'first_post', a.first_post,
               'last_post', a.last_post,
               'per_post_comments', case when coalesce(a.posts, 0) > 0
                                    then round(a.comments::numeric / a.posts, 2) else null end) as obj,
             coalesce(a.posts, 0) as posts,
             coalesce(c.cta_clicks, 0) as cta_clicks,
             coalesce(d.gate_dms, 0) as gate_dms,
             m.slug as slug
      from lm m
      left join agg a on a.slug = m.slug
      left join dms d on d.slug = m.slug
      left join clicks c on c.slug = m.slug
      left join calls k on k.slug = m.slug
    )
    select jsonb_build_object(
      'since', v_since,
      'attributed_posts', (select attributed_posts from lane_counts),
      'unattributed_posts', (select unattributed_posts from lane_counts),
      'lms', coalesce((
        select jsonb_agg(obj order by posts desc, cta_clicks desc, slug) from lmrows
      ), '[]'::jsonb),
      -- 083: the operator's own best lead magnet, by the two outcomes a lead magnet exists for.
      -- The surfaces call a row "active" when it shows any activity (a post, a CTA click, a gate
      -- DM or a call: `activeLms` in src/lib/leadMagnets.ts). A row with cta_clicks + gate_dms > 0
      -- is active by that definition, so requiring the sum to be positive IS the active filter,
      -- and it is also what makes this JSON null instead of a zero row when no lead magnet has
      -- earned a click or a DM yet. Never a row with nothing to show.
      'best_own', (
        select obj from lmrows
        where cta_clicks + gate_dms > 0
        order by cta_clicks + gate_dms desc, posts desc, slug
        limit 1
      )
    )
    -- 086: calls_note is a statement about a lane with no attributable booking. It stays exactly
    -- as it was while that is true, and disappears for a lane the moment a real booking lands.
    || case when (select n from calls_total) > 0 then '{}'::jsonb else jsonb_build_object(
         'calls_note', 'calls is null when no booking carries the lead magnet slug. lm_attribution is the only booking ledger keyed by slug and it holds no production row, so calls reads null on every lane today. A null here means not attributable, it does not mean zero calls.')
       end
  );
end $function$;

-- ---------------------------------------------------------------------------
-- operator_gated_posts: guard line only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_gated_posts(p_gate text, p_client_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_since timestamptz := now() - interval '91 days';
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if not public.lane_allowed(p_client_id) then raise exception 'unknown seat'; end if;
  return (
    with src as (
      select p.linkedin_post_url as post_ref, p.competitor_name as author,
             p.linkedin_profile_url as author_url, p.post_date as posted_at,
             p.likes_count as likes, p.comments_count as comments, p.reposts_count as reposts
      from public.competitor_posts p
      where p_client_id = 'ivan' and (p.client_id is null or p.client_id = 'ivan')
        and coalesce(p.competitor_role, '') <> 'killed'   -- 080: same exclusion as operator_roster_posts
        and p.post_date >= v_since
      union all
      select p.linkedin_post_url, p.competitor_name, p.linkedin_profile_url, p.post_date,
             p.likes_count, p.comments_count, p.reposts_count
      from public.audn_competitor_posts p
      where p_client_id <> 'ivan' and p.client_id = p_client_id
        and coalesce(p.competitor_role, '') <> 'killed'   -- 080
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
    ),
    -- 083: the gated row and its sort keys are built ONCE here. `posts` aggregates these objects
    -- and `best` takes the first of the same ordered set, so `best` is exactly `posts -> 0` and
    -- the two can never disagree about which gate is the loudest.
    ranked as (
      select jsonb_build_object(
               'post_ref', post_ref, 'author', author, 'author_url', author_url,
               'posted_at', posted_at, 'likes', likes, 'comments', comments, 'reposts', reposts,
               'follower_count', follower_count, 'followers_source', followers_source,
               'per_1k', case when follower_count is not null and follower_count > 0
                         then round(comments::numeric * 1000 / follower_count, 3) else null end,
               'cta_kind', cta_kind, 'gate_keyword', gate_keyword, 'offer', offer,
               'confidence', confidence) as obj,
             case when follower_count is not null and follower_count > 0
                  then round(comments::numeric * 1000 / follower_count, 3) else null end as per_1k,
             comments
      from withfoll where is_gated
    ),
    posts_arr as (
      select coalesce(
               jsonb_agg(obj order by per_1k desc nulls last, comments desc nulls last),
               '[]'::jsonb) as arr
      from ranked
    )
    select jsonb_build_object(
      'since', v_since,
      'judged', (select count(*) from judged),
      'gated', (select count(*) from judged where is_gated),
      -- 083: roster posts in the window that carry no judgment at all. competitor_gated_posts has
      -- a PRIMARY KEY on post_ref, so the `judged` join above cannot multiply a src row and this
      -- subtraction is exact: judged + unjudged = every roster post in the window, always.
      'unjudged', (select count(*) from src) - (select count(*) from judged),
      'posts', (select arr from posts_arr),
      -- 083: the loudest gate. Identical to posts -> 0 by construction; JSON null when the lane
      -- has no gated post in the window.
      'best', (select case when jsonb_array_length(arr) > 0 then arr -> 0 else null end
               from posts_arr)
    )
  );
end $function$;

-- ---------------------------------------------------------------------------
-- operator_roster_posts: guard line only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_roster_posts(p_gate text, p_client_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_since timestamptz := now() - interval '91 days';
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if not public.lane_allowed(p_client_id) then raise exception 'unknown seat'; end if;
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
end $function$;

-- ---------------------------------------------------------------------------
-- operator_post_audience: guard line only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_post_audience(p_gate text, p_client_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if not public.lane_allowed(p_client_id) then raise exception 'unknown seat'; end if;
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
end $function$;

-- ---------------------------------------------------------------------------
-- operator_network_drift: guard line only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_network_drift(p_gate text, p_client_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_since timestamptz := now() - interval '180 days';
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if not public.lane_allowed(p_client_id) then raise exception 'unknown seat'; end if;
  return jsonb_build_object(
    'since', v_since,
    'joined', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'connected_at', p.connected_at,
          'title', p.title,
          'country', p.country,
          'location', p.location,
          'company', p.company)
        order by p.connected_at desc), '[]'::jsonb)
      from public.outreach_prospects p
      join public.outreach_campaigns c on c.id = p.campaign_id
      where p.connected_at >= v_since
        and ((p_client_id = 'ivan' and c.client_id is null) or c.client_id = p_client_id)
    )
  );
end $function$;

