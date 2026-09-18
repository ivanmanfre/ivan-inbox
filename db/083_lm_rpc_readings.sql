-- 083 — True readings: three additive keys on the two lead-magnet RPCs.
--
-- Goal run `lm-readings-true-and-history-2026-09-17`, phase P1.
--
-- Why: the two live surfaces (Strategy > Results "Lead magnets", Strategy > Lead magnets) open
-- with lists. Ivan reads them with a short attention span and needs the answer on top. Three
-- numbers carry that answer and none of them existed in the payload:
--
--   operator_gated_posts.unjudged  how many roster posts in the window carry NO judgment, so a
--                                  surface can say "{judged} of {judged + unjudged} judged, treat
--                                  the gate share as an upper bound" instead of printing a rate
--                                  that is really a ceiling. 1,205 of 1,378 were unjudged when
--                                  this run started.
--   operator_gated_posts.best      the single loudest gate on the roster, by reach efficiency
--                                  (comments per 1,000 followers) where the author's size is
--                                  known, by raw comments where it is not.
--   operator_lead_magnets.best_own the operator's own best performing lead magnet, by the two
--                                  things a lead magnet is actually for: CTA clicks and gate DMs.
--
-- ADDITIVE ONLY. Same signatures, same gate, same seat check, same window, same tenancy, same
-- `distinct on (slug)` (080). Every pre-existing key keeps its exact value: proven by an md5 of
-- each RPC's JSON minus the new keys and `since`, taken back to back around this DDL on all three
-- lanes, with the backlog judge paused so `judged`/`gated` could not move underneath the check.
-- Receipts: goal-runs/lm-readings-true-and-history-2026-09-17-out/01-readings.md.
--
-- Shapes (contract with the frontend):
--   unjudged   integer, never null, 0 when every roster post in the window is judged.
--   best       one element of the `posts` array, or JSON null when the lane has no gated post.
--              It IS `posts -> 0`: both are built from one expression in the `ranked` CTE below,
--              so they can never drift apart.
--   best_own   one element of the `lms` array, or JSON null when no row has any CTA click or
--              gate DM. Same field names as a catalog row.

begin;

-- ---------------------------------------------------------------------------------------------
-- operator_gated_posts: + unjudged, + best
-- ---------------------------------------------------------------------------------------------
create or replace function public.operator_gated_posts(p_gate text, p_client_id text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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

revoke all on function public.operator_gated_posts(text, text) from public, anon;
grant execute on function public.operator_gated_posts(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- operator_lead_magnets: + best_own
-- ---------------------------------------------------------------------------------------------
create or replace function public.operator_lead_magnets(p_gate text, p_client_id text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_since timestamptz := now() - interval '91 days';
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client_id not in ('ivan','risedtc','arch') then raise exception 'unknown seat'; end if;
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
    -- 078: each view is read ONCE into a per-key aggregate instead of once per lead magnet
    -- (72 correlated view scans took ~3 s on Ivan's lane and timed the section out).
    gk as (
      select g.slug, sum(g.dms_sent) as dms_sent from public.gate_keyword_performance g
      where g.slug in (select slug from lm) group by g.slug
    ),
    spine as (
      -- 079: the spine view's comment_gate_dms is count(*) of linkedin_comment_events by
      -- post_id; read that table directly instead of the 1 s view.
      select lce.post_id as post_social_id, count(*) as dms from public.linkedin_comment_events lce
      where p_client_id = 'ivan' and lce.post_id in (select linkedin_social_id from lm where linkedin_social_id is not null)
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
        where e.event_type = 'cta_click' and e.lm_slug in (select slug from lm) group by e.lm_slug
      ) ev on ev.lm_slug = m.slug
    ),
    -- Calls are only claimed where a booking actually carries the slug. lm_attribution held a
    -- single test row at build time, so this returns null on every lane today. Null means not
    -- attributable, never zero calls: see calls_note.
    calls as (
      select m.slug,
             (select count(*) from public.lm_attribution a
              where a.lm_slug = m.slug and a.booked_at is not null) as booked
      from lm m
    ),
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
               'calls', case when k.booked > 0 then k.booked else null end,
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
      'calls_note', 'calls is null when no booking carries the lead magnet slug. lm_attribution is the only booking ledger keyed by slug and it holds no production row, so calls reads null on every lane today. A null here means not attributable, it does not mean zero calls.',
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
  );
end $function$;

revoke all on function public.operator_lead_magnets(text, text) from public, anon;
grant execute on function public.operator_lead_magnets(text, text) to authenticated, service_role;

commit;
