-- 100: operator_lanes + operator_market_readout.
--
-- Two new read functions. Nothing existing is replaced: 099 and 100 add objects and change no
-- live definition, so the five lane-keyed RPCs keep their bodies byte for byte.
--
-- ---------------------------------------------------------------------------------------------
-- WHY operator_lanes
--
-- The inbox types its tenants into the code: src/lib/content.ts:14 reads
--     export const CONTENT_LANES = ['ivan', 'risedtc', 'arch'] as const
-- and eight surfaces build their lane switch from it. A fourth client with a full roster cannot
-- appear on any of them without a deploy. The database already knows the answer -- db/088's
-- lane_allowed() says which client_registry rows are answerable -- but lane_allowed is granted to
-- service_role only, on purpose, so the browser cannot ask it. This function is the one door:
-- it runs the same guard as every other operator RPC, applies lane_allowed, and hands back the
-- ids with their display names.
--
-- The extra `is_active` filter is not redundant. lane_allowed has a second door (db/091): a row
-- carrying platform.measurement.selftest = 'true' passes even while inactive, which is how
-- zz-selftest is exercised without ever being a live tenant. Ivan's inbox must never list it, so
-- the lane list asks for BOTH: allowed, and switched on.
--
-- The display name: client_registry.display_name reads "RISE DTC (Mattan Danino)", while the
-- inbox has always called that lane "Mattan Danino". platform.client.name is the registry's own
-- slot for the name a human uses, so it wins when it is set and display_name carries the lane
-- otherwise. A client nobody has named yet reads as whatever the registry calls it, which is
-- honest rather than blank.
--
-- ---------------------------------------------------------------------------------------------
-- WHY operator_market_readout
--
-- The static market readout (tools/client-research/readout) makes five RPC round trips and one
-- query per theme to draw one page. The Markets view in the inbox draws the same page and makes
-- ONE call. Everything below is that page, section by section, in the order layout B renders it.
--
-- Four rules this body keeps, each one paid for by a defect already shipped:
--   * every window reads v_since. db/084: the own-side clicks and gate DMs were all-time under a
--     "since 19 Jun" label for four days because one CTE read an all-time view.
--   * `distinct on (slug)` wherever lead_magnets is joined. db/080: a duplicated slug multiplied
--     the per-slug joins and printed a catalog of 72 where 57 exist.
--   * no correlated subquery over a view per row. db/078: 3,040 ms on Ivan's lane, 95 ms once
--     each source was read once and joined.
--   * the two populations stay apart. The accounts we follow are the roster the client and Ivan
--     agreed on; the wider feed is every other author the harvest stored, and it is unvetted.
--     Ivan's lane carries 35 roster gates and ARCH's feed carries 340 posts from 302 authors
--     nobody vetted, so a ranking over the whole table would be a ranking of strangers.
--
-- Sentences are NOT built here. The RPC returns which readings qualify and the numbers behind
-- them; the view writes the words, where the copy lint can read them.

-- =============================================================================================
-- operator_lanes
-- =============================================================================================

create or replace function public.operator_lanes(p_gate text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('client_id', r.client_id, 'display_name', r.display_name)
                     order by r.display_name, r.client_id)
    from (
      select c.client_id,
             coalesce(nullif(btrim(c.platform->'client'->>'name'), ''), c.display_name) as display_name
      from public.client_registry c
      where coalesce(c.is_active, false)
        and public.lane_allowed(c.client_id)
    ) r
  ), '[]'::jsonb);
end $function$;

-- A default-privileges rule on this schema grants execute to anon on every new function, and a
-- revoke from PUBLIC does not touch that explicit grant. anon is revoked by name, the way 088
-- revokes it on lane_allowed. Proof after apply: has_function_privilege('anon', ..., 'execute')
-- reads false on both functions.
revoke all on function public.operator_lanes(text) from public;
revoke all on function public.operator_lanes(text) from anon;
grant execute on function public.operator_lanes(text) to authenticated;
grant execute on function public.operator_lanes(text) to service_role;

-- =============================================================================================
-- operator_market_readout
-- =============================================================================================

create or replace function public.operator_market_readout(p_gate text, p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_since timestamptz := now() - interval '91 days';
  -- A ranking by reach means nothing without enough of both. Same floor the readout applies.
  v_floor_comments  int := 10;
  v_floor_followers int := 1000;
  -- No test is written until this many ranked offers stand behind the page.
  v_min_test_base int := 5;
  -- A stored theme renders only with this much repetition behind it.
  v_theme_authors int := 2;
  v_theme_posts   int := 3;
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if not public.lane_allowed(p_client_id) then raise exception 'unknown seat'; end if;

  return (
    with
    -- ---- who this lane is -----------------------------------------------------------------
    reg as (
      select r.client_id,
             coalesce(nullif(btrim(r.platform->'client'->>'name'), ''), r.display_name) as display_name,
             coalesce(r.platform->'measurement'->'roster', '[]'::jsonb) as roster_raw
      from public.client_registry r
      where r.client_id = p_client_id
    ),
    -- ---- the accounts we follow -------------------------------------------------------------
    roster as (
      select x->>'account' as account, x->>'role' as role,
             coalesce(x->'aliases', '[]'::jsonb) as aliases
      from reg cross join lateral jsonb_array_elements(reg.roster_raw) x
      where x->>'role' in ('direct_competitor', 'buyer_voice', 'format_reference', 'warm_anchor')
    ),
    -- ---- every post the harvest stored in the window ----------------------------------------
    -- allsrc is the whole feed. src drops the authors the roster killed, the same exclusion
    -- operator_roster_posts and operator_gated_posts apply. The wider-feed COUNTS read allsrc,
    -- because a killed account is by definition an account we no longer follow and its posts
    -- belong in the wider feed rather than nowhere.
    allsrc as (
      select p.linkedin_post_url as post_ref, p.competitor_name as author,
             p.linkedin_profile_url as author_url, p.post_date as posted_at,
             p.likes_count as likes, p.comments_count as comments, p.reposts_count as reposts,
             coalesce(p.competitor_role, '') as role_raw
      from public.competitor_posts p
      where p_client_id = 'ivan' and (p.client_id is null or p.client_id = 'ivan')
        and p.post_date >= v_since
      union all
      select p.linkedin_post_url, p.competitor_name, p.linkedin_profile_url, p.post_date,
             p.likes_count, p.comments_count, p.reposts_count, coalesce(p.competitor_role, '')
      from public.audn_competitor_posts p
      where p_client_id <> 'ivan' and p.client_id = p_client_id
        and p.post_date >= v_since
    ),
    src as (select * from allsrc where role_raw <> 'killed'),
    -- ---- the posts that match an account we follow ------------------------------------------
    -- Byte-for-byte the matcher operator_roster_posts uses: exact name, or an alias whose
    -- url_owner also owns the post URL, and `having count(*) = 1` so an ambiguous name matches
    -- nothing rather than the wrong account.
    matched as (
      select s.post_ref, s.author, s.posted_at, s.comments, r.role
      from src s
      join lateral (
        select min(x.role) as role
        from roster x
        where lower(btrim(split_part(x.account, ' (', 1))) = lower(btrim(s.author))
           or exists (
             select 1 from jsonb_array_elements(x.aliases) a(value)
             where lower(btrim(a.value->>'name')) = lower(btrim(s.author))
               and lower(s.post_ref) like '%/posts/' || lower(a.value->>'url_owner') || '\_%' escape '\')
        having count(*) = 1
      ) r on true
      where s.comments is not null and s.posted_at is not null
    ),
    roster_urls as (select distinct post_ref from matched),
    -- ---- section: populations ----------------------------------------------------------------
    populations as (
      select
        (select count(*) from roster)                                          as roster_size,
        (select count(distinct author) from matched)                           as roster_authors,
        (select count(*) from matched)                                         as roster_posts,
        (select (percentile_cont(0.5) within group (order by comments))::numeric from matched) as roster_median_comments,
        (select max(comments) from matched)                                    as roster_max_post_comments,
        (select count(*) from allsrc a
          where not exists (select 1 from roster_urls u where u.post_ref = a.post_ref)) as wider_posts,
        (select count(distinct a.author) from allsrc a
          where not exists (select 1 from roster_urls u where u.post_ref = a.post_ref)) as wider_authors
    ),
    -- ---- the judged posts, and the offers among them ------------------------------------------
    judged as (
      select s.post_ref, s.author, s.author_url, s.posted_at, s.likes, s.comments, s.reposts,
             j.is_gated, j.cta_kind, j.gate_keyword, j.offer, j.confidence
      from src s
      join public.competitor_gated_posts j
        on j.post_ref = s.post_ref and j.client_id = p_client_id
    ),
    -- Follower join on a normalised profile URL, on both sides. No row, or a row with no count,
    -- stays null: size unknown is reported as unknown, never as zero.
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
    offers as (
      select w.*,
             exists (select 1 from roster_urls u where u.post_ref = w.post_ref) as on_roster,
             case when w.follower_count is not null and w.follower_count > 0
                  then round(w.comments::numeric * 1000 / w.follower_count, 3) end as per_1k
      from withfoll w
      where w.is_gated
    ),
    scored as (
      select o.*,
             (o.per_1k is not null
              and coalesce(o.comments, 0) >= v_floor_comments
              and coalesce(o.follower_count, 0) >= v_floor_followers) as clears_floor
      from offers o
    ),
    rank_stats as (
      select (percentile_cont(0.5) within group (order by per_1k))::numeric as median_per1k,
             max(per_1k) as max_per1k,
             min(per_1k) as min_per1k,
             count(*)    as ranked_count
      from scored where on_roster and clears_floor
    ),
    -- The offer row, built ONCE, so every list below shows the same object and no two can
    -- disagree about the same post.
    obj as (
      select s.*,
             jsonb_build_object(
               'post_ref', s.post_ref, 'author', s.author, 'author_url', s.author_url,
               'posted_at', s.posted_at, 'likes', s.likes, 'comments', s.comments,
               'reposts', s.reposts, 'follower_count', s.follower_count,
               'followers_source', s.followers_source, 'per_1k', s.per_1k,
               'cta_kind', s.cta_kind, 'gate_keyword', s.gate_keyword, 'offer', s.offer,
               'confidence', s.confidence,
               'vs_median', case when s.per_1k is not null and (select median_per1k from rank_stats) > 0
                            then round(s.per_1k / (select median_per1k from rank_stats), 3) end,
               -- Why an offer sits below the ranked ones. Two machine reasons, never a sentence:
               -- the view writes the words.
               'why_followers', case when s.clears_floor then null
                                     when s.follower_count is null then 'missing'
                                     when s.follower_count < v_floor_followers then 'small' end,
               'why_comments', case when s.clears_floor then null
                                    else coalesce(s.comments, 0) < v_floor_comments end
             ) as row_obj
      from scored s
    ),
    -- ---- section: offers ---------------------------------------------------------------------
    ranked_arr as (
      select coalesce(jsonb_agg(row_obj order by per_1k desc, comments desc nulls last, post_ref collate "C"), '[]'::jsonb) as arr
      from obj where on_roster and clears_floor
    ),
    below_arr as (
      select coalesce(jsonb_agg(row_obj order by comments desc nulls last, post_ref collate "C"), '[]'::jsonb) as arr
      from obj where on_roster and not clears_floor
    ),
    wider_arr as (
      select coalesce(jsonb_agg(row_obj order by comments desc nulls last, post_ref collate "C"), '[]'::jsonb) as arr
      from obj where not on_roster
    ),
    roster_offer_stats as (
      select count(*) as roster_offers,
             max(comments) as roster_max_comments,
             (percentile_cont(0.5) within group (order by comments))::numeric as roster_offer_median,
             count(*) filter (where cta_kind = 'link')         as cta_link,
             count(*) filter (where cta_kind = 'comment_gate') as cta_comment_gate,
             count(*) filter (where cta_kind = 'dm_gate')      as cta_dm_gate,
             count(*) filter (where gate_keyword is not null)  as with_keyword
      from scored where on_roster
    ),
    top_by_comments as (
      select row_obj from obj where on_roster
      order by comments desc nulls last, post_ref collate "C" limit 1
    ),
    -- ---- section: themes ---------------------------------------------------------------------
    -- The newest stored run only. Posts, authors and the median are RECOMPUTED here from the
    -- stored post addresses, so no printed number rests on the naming step's own arithmetic.
    theme_run as (
      select run_id from public.client_research_themes
      where client_id = p_client_id
      order by created_at desc, run_id desc limit 1
    ),
    theme_src as (
      select th.theme, th.post_refs
      from public.client_research_themes th
      where th.client_id = p_client_id
        and th.run_id = (select run_id from theme_run)
    ),
    -- The posts behind the stored themes, read from the lane's own post table by the addresses
    -- the naming step stored. The theme set carries no window of its own, exactly as the readout
    -- reads it: a theme is a reading of the corpus, not of the last 91 days.
    theme_posts as (
      select t.theme, p.linkedin_post_url as post_ref, p.competitor_name as author,
             p.comments_count as comments, p.post_text as body
      from theme_src t
      join public.competitor_posts p on p.linkedin_post_url = any(t.post_refs)
      where p_client_id = 'ivan' and (p.client_id is null or p.client_id = 'ivan')
      union all
      select t.theme, p.linkedin_post_url, p.competitor_name, p.comments_count, p.post_text
      from theme_src t
      join public.audn_competitor_posts p on p.linkedin_post_url = any(t.post_refs)
      where p_client_id <> 'ivan' and p.client_id = p_client_id
    ),
    theme_agg as (
      select theme,
             count(*)::int as posts,
             count(distinct author)::int as authors,
             (percentile_cont(0.5) within group (order by coalesce(comments, 0)))::numeric as med
      from theme_posts group by theme
    ),
    theme_keep as (
      select * from theme_agg where authors >= v_theme_authors and posts >= v_theme_posts
    ),
    theme_rows as (
      select k.theme, k.posts, k.authors, k.med, e.author as ex_author, e.post_ref as ex_url,
             left(e.body, 400) as ex_text
      from theme_keep k
      left join lateral (
        select tp.author, tp.post_ref, tp.body
        from theme_posts tp
        where tp.theme = k.theme
        order by coalesce(tp.comments, 0) desc, tp.post_ref collate "C"
        limit 1
      ) e on true
    ),
    -- ---- section: own ------------------------------------------------------------------------
    -- `stale` is the honest half of this section. own_posts carries 0 likes AND 0 comments on
    -- most of Ivan's recent rows: the publisher stored the post and no later pass wrote the
    -- counters back. A post with nothing on either counter is a post we have not measured, not a
    -- post nobody answered, so the view withholds the comparison rather than reading a zero as a
    -- result. A row that drew reactions and no comments is measured and counts as a real zero.
    own_src as (
      select o.social_id, o.posted_at as at, coalesce(o.num_comments, 0) as comments,
             o.linkedin_url as url, o.post_text as title,
             (coalesce(o.num_comments, 0) = 0 and coalesce(o.num_likes, 0) = 0) as stale
      from public.own_posts o
      where p_client_id = 'ivan' and o.posted_at >= v_since
      union all
      select c.social_id, c.published_at, coalesce(c.comments, 0), c.post_url, c.title,
             (coalesce(c.comments, 0) = 0 and coalesce(c.reactions, 0) = 0)
      from public.client_post_metrics c
      where p_client_id <> 'ivan' and c.client_id = p_client_id and c.published_at >= v_since
    ),
    own_stats as (
      select count(*) as posts,
             (percentile_cont(0.5) within group (order by comments))::numeric as median_comments,
             max(comments) as best_comments,
             count(*) filter (where stale) as stale_count,
             (percentile_cont(0.5) within group (order by comments)
               filter (where not stale))::numeric as median_measured
      from own_src
    ),
    own_best as (
      select jsonb_build_object('url', url, 'title', title, 'comments', comments, 'at', at) as obj
      from own_src order by comments desc, at desc nulls last limit 1
    ),
    -- ---- the lane's own offer catalog --------------------------------------------------------
    -- 080: one row per slug. lead_magnets has carried a duplicated slug, and a per-slug join
    -- multiplies it into the denominator.
    lm as (
      select distinct on (l.slug) l.slug, l.linkedin_social_id, l.post_url
      from public.lead_magnets l
      where l.slug is not null
        and ((p_client_id = 'ivan' and l.client_id is null) or l.client_id = p_client_id)
      order by l.slug, l.updated_at desc nulls last, l.created_at desc nulls last
    ),
    own_scored as (
      select o.social_id, o.lead_magnet_slug
      from public.own_posts_scored o
      where p_client_id = 'ivan' and o.posted_at >= v_since
    ),
    cpm as (
      select c.social_id, c.lead_magnet_slug, c.post_url
      from public.client_post_metrics c
      where p_client_id <> 'ivan' and c.client_id = p_client_id and c.published_at >= v_since
    ),
    -- A post is attributed by its own slug stamp or by matching the offer's social id or post
    -- URL. `union`, not `union all`: a post that matches two ways is one post.
    attributed as (
      select m.slug, o.social_id as post_key
      from lm m join own_scored o
        on o.lead_magnet_slug = m.slug
        or (m.linkedin_social_id is not null and o.social_id = m.linkedin_social_id)
      union
      select m.slug, c.social_id
      from lm m join cpm c
        on c.lead_magnet_slug = m.slug
        or (m.linkedin_social_id is not null and c.social_id = m.linkedin_social_id)
        or (m.post_url is not null and c.post_url = m.post_url)
    ),
    lane_keys as (select distinct social_id from own_src where social_id is not null),
    lane_counts as (
      select count(*) filter (where a.post_key is not null) as attributed_posts,
             count(*) filter (where a.post_key is null)     as unattributed_posts
      from lane_keys lp
      left join (select distinct post_key from attributed) a on a.post_key = lp.social_id
    ),
    lm_counts as (
      select (select count(*) from lm) as lm_catalog,
             (select count(distinct slug) from attributed) as lm_used
    ),
    -- ---- section: coverage --------------------------------------------------------------------
    coverage as (
      select (select count(*) from judged) as judged,
             (select count(*) from src) - (select count(*) from judged) as unjudged,
             (select count(*) from src) as total
    ),
    -- ---- section: tests ------------------------------------------------------------------------
    -- Which readings are strong enough to argue for a change, and the numbers behind each. Three
    -- candidates always, then two more only while fewer than three stand. The page prints at most
    -- three, largest base first. Under five ranked offers every test is arithmetic on nothing, so
    -- the whole section is empty.
    test_base as (
      select (select ranked_count from rank_stats) as ranked_count,
             (select roster_offers from roster_offer_stats) as roster_offers,
             (select posts from own_stats) as own_posts
    ),
    cand as (
      select 1 as ord, 'shape' as kind, (select ranked_count from rank_stats)::numeric as base,
             jsonb_build_object(
               'top', (select arr -> 0 from ranked_arr),
               'median_per1k', (select median_per1k from rank_stats),
               'ranked', (select ranked_count from rank_stats)) as n
      where (select ranked_count from rank_stats) >= 1
      union all
      select 2, 'ask', (select roster_offers from roster_offer_stats)::numeric,
             jsonb_build_object(
               'roster_offers', (select roster_offers from roster_offer_stats),
               'link', (select cta_link from roster_offer_stats),
               'comment_gate', (select cta_comment_gate from roster_offer_stats),
               'dm_gate', (select cta_dm_gate from roster_offer_stats))
      where (select cta_link + cta_comment_gate + cta_dm_gate from roster_offer_stats) > 0
      union all
      select 3, 'theme', t.posts::numeric,
             jsonb_build_object('theme', t.theme, 'posts', t.posts, 'authors', t.authors, 'med', t.med)
      from (select * from theme_rows order by posts desc, authors desc, med desc, theme collate "C" limit 1) t
      union all
      select 4, 'own_median', (select posts from own_stats)::numeric,
             jsonb_build_object(
               'own_posts', (select posts from own_stats),
               'own_median', (select median_comments from own_stats),
               'roster_median', (select roster_median_comments from populations),
               'roster_posts', (select roster_posts from populations))
      where (select posts from own_stats) > 0
        and (select median_comments from own_stats) is not null
        and (select roster_median_comments from populations) is not null
      union all
      select 5, 'offer_share', (select roster_posts from populations)::numeric,
             jsonb_build_object(
               'roster_offers', (select roster_offers from roster_offer_stats),
               'roster_posts', (select roster_posts from populations),
               'own_posts', (select posts from own_stats),
               'attributed', (select attributed_posts from lane_counts))
      where (select roster_offers from roster_offer_stats) > 0
    ),
    -- Candidates 4 and 5 exist only while the first three have not filled the page, exactly as
    -- the readout builds them: it appends the fourth only when fewer than three stand, then the
    -- fifth only when fewer than three still stand.
    cand_n as (
      select count(*) filter (where ord <= 3) as n3,
             count(*) filter (where ord = 4)  as has4
      from cand
    ),
    cand_kept as (
      select c.* from cand c, cand_n
      where c.ord <= 3
         or (c.ord = 4 and cand_n.n3 < 3)
         or (c.ord = 5 and cand_n.n3 + (case when cand_n.n3 < 3 then cand_n.has4 else 0 end) < 3)
    ),
    tests_arr as (
      select case when (select ranked_count from rank_stats) >= v_min_test_base
                  then coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'base', base, 'n', n)
                                                  order by base desc, ord)
                                 from (select * from cand_kept where base >= v_min_test_base
                                       order by base desc, ord limit 3) k), '[]'::jsonb)
                  else '[]'::jsonb end as arr
    ),
    -- ---- section: insights ---------------------------------------------------------------------
    insight_run as (
      select run_id from public.client_research_insights
      where client_id = p_client_id
      order by created_at desc, run_id desc limit 1
    ),
    insights_arr as (
      select coalesce(jsonb_agg(jsonb_build_object(
               'section', i.section, 'reading', i.reading, 'created_at', i.created_at)
               order by i.section collate "C"), '[]'::jsonb) as arr
      from public.client_research_insights i
      where i.client_id = p_client_id and i.run_id = (select run_id from insight_run)
    )

    select jsonb_build_object(
      'since', v_since,
      'window_days', 91,
      'client_id', p_client_id,
      'display_name', (select display_name from reg),
      'floor', jsonb_build_object('comments', v_floor_comments, 'followers', v_floor_followers),
      'min_test_base', v_min_test_base,

      'populations', (select jsonb_build_object(
        'roster_size', roster_size, 'roster_authors', roster_authors, 'roster_posts', roster_posts,
        'roster_median_comments', roster_median_comments,
        'roster_max_post_comments', roster_max_post_comments,
        'wider_posts', wider_posts, 'wider_authors', wider_authors) from populations),

      'offers', jsonb_build_object(
        'roster_offers', (select roster_offers from roster_offer_stats),
        'wider_offers', (select count(*) from scored where not on_roster),
        'ranked_count', (select ranked_count from rank_stats),
        'below_count', (select count(*) from scored where on_roster and not clears_floor),
        'roster_max_comments', (select roster_max_comments from roster_offer_stats),
        'roster_offer_median', (select roster_offer_median from roster_offer_stats),
        'cta', jsonb_build_object(
          'link', (select cta_link from roster_offer_stats),
          'comment_gate', (select cta_comment_gate from roster_offer_stats),
          'dm_gate', (select cta_dm_gate from roster_offer_stats)),
        'with_keyword', (select with_keyword from roster_offer_stats),
        'rank', (select jsonb_build_object('median_per1k', median_per1k,
                  'max_per1k', max_per1k, 'min_per1k', min_per1k) from rank_stats),
        'ranked', (select arr from ranked_arr),
        'below', (select arr from below_arr),
        'wider', (select arr from wider_arr),
        'top_by_comments', (select row_obj from top_by_comments),
        -- Does the offer with the most raw comments also lead the ranking by reach? When it does
        -- not, the page says so rather than letting a reader assume it.
        'top_leads_ranking', coalesce(
          ((select row_obj ->> 'post_ref' from top_by_comments)
            = (select arr -> 0 ->> 'post_ref' from ranked_arr)), false)),

      'themes', jsonb_build_object(
        'run_id', (select run_id from theme_run),
        'total', (select count(*) from theme_keep),
        'rows', coalesce((select jsonb_agg(jsonb_build_object(
            'theme', theme, 'posts', posts, 'authors', authors, 'med', med,
            'ex_author', ex_author, 'ex_url', ex_url, 'ex_text', ex_text)
            order by posts desc, authors desc, med desc, theme collate "C")
          from theme_rows), '[]'::jsonb)),

      'own', jsonb_build_object(
        'posts', (select posts from own_stats),
        'median_comments', (select median_comments from own_stats),
        'best_comments', (select best_comments from own_stats),
        'best', (select case when (select posts from own_stats) > 0 then (select obj from own_best) end),
        'stale_count', (select stale_count from own_stats),
        'median_measured', (select median_measured from own_stats),
        'attributed', (select attributed_posts from lane_counts),
        'unattributed', (select unattributed_posts from lane_counts),
        'lm_catalog', (select lm_catalog from lm_counts),
        'lm_used', (select lm_used from lm_counts)),

      'tests', (select arr from tests_arr),

      'coverage', (select jsonb_build_object('judged', judged, 'unjudged', unjudged, 'total', total)
                   from coverage),

      'insights', jsonb_build_object(
        'run_id', (select run_id from insight_run),
        'rows', (select arr from insights_arr))
    )
  );
end $function$;

revoke all on function public.operator_market_readout(text, text) from public;
revoke all on function public.operator_market_readout(text, text) from anon;
grant execute on function public.operator_market_readout(text, text) to authenticated;
grant execute on function public.operator_market_readout(text, text) to service_role;
