-- 090: the fix round. Three corrections and one comment.
--
-- 1. lane_allowed() gets a second, explicit door.
--    087 made it `is_active AND a roster`, on the stated premise that nothing else read
--    is_active. That premise was wrong. Four live readers predate it:
--      /Users/ivanmanfredi/Desktop/claude-code-railway/entrypoint.sh:325 and :400
--      /Users/ivanmanfredi/Desktop/claude-code-railway/web-ui/server.js:437
--      /Users/ivanmanfredi/.claude/hooks/lib/identify_client.py:60
--    The last is a Claude Code session hook. It caches every ACTIVE row and, at line 163, falls
--    back to matching the first word of display_name against the cwd basename. 'Selftest Studio'
--    reduces to 'selftest', so activating that row made any directory containing "selftest"
--    resolve to the selftest tenant -- a client inferred from a path substring, which the project
--    rules forbid outright. zz-selftest goes back to is_active=false and carries
--    platform.measurement.selftest=true instead, which only this chain reads.
--
-- 2. operator_clients_overview() stops listing inactive rows.
--    Its registry read gated on `platform is not null` and nothing else, so the selftest tenant
--    appeared in Ivan's Client Ops dashboard
--    (personal-site/components/dashboard-v2/sections/clientops2/shared.tsx:493). Before: 4
--    clients (arch, ivan, risedtc, zz-selftest). After: 3. The function is otherwise byte-
--    identical to the live definition.
--
-- 3. client_research_runs accepts status 'harvest_not_built'.
--    The launcher's --apify-budget-usd > 0 path has no harvest code. Rather than ship an
--    unproven spend path, it now refuses the run and says where harvesting actually lives.
--
-- 4. operator_gated_posts: one stale comment. 083 justified the exact `unjudged` subtraction by
--    a PRIMARY KEY on post_ref alone; 088 widened that key. The guarantee survives for a
--    different reason, and the comment now states the real one. No behaviour change: the two
--    function bodies differ only inside that comment.

-- ---------------------------------------------------------------------------
-- 1. lane_allowed
-- ---------------------------------------------------------------------------
create or replace function public.lane_allowed(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  -- Two doors, one rule. A lane needs a non-empty roster in every case: operator_roster_posts
  -- reads that exact array, so a lane without one has nothing to answer with.
  --
  -- Door 1 is is_active, the operator's own switch for a real tenant.
  --
  -- Door 2 is platform.measurement.selftest, and it exists because is_active is NOT a private
  -- flag for this chain. Four live readers predate it -- the Railway container entrypoint (twice),
  -- the web UI's client list, and the Claude Code session hook identify_client.py, which caches
  -- every active row and falls back to matching the first word of display_name against the cwd
  -- basename. Setting a selftest tenant active therefore made any directory containing the word
  -- "selftest" resolve to it: a client inferred from a path substring, which is the exact thing
  -- the project rules forbid. So the selftest lane stays is_active=false and carries its own flag
  -- instead. A lane may not use door 2 to become a real tenant -- nothing but the selftest row
  -- should ever set it.
  select exists (
    select 1 from public.client_registry r
    where r.client_id = p_client_id
      and jsonb_typeof(r.platform->'measurement'->'roster') = 'array'
      and jsonb_array_length(r.platform->'measurement'->'roster') > 0
      and (coalesce(r.is_active, false)
           or coalesce(r.platform->'measurement'->>'selftest', '') = 'true')
  );
$fn$;

revoke all on function public.lane_allowed(text) from public;
revoke all on function public.lane_allowed(text) from anon;
revoke all on function public.lane_allowed(text) from authenticated;
grant execute on function public.lane_allowed(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. operator_clients_overview: inactive rows are not clients
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_clients_overview(p_gate text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare out jsonb;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  select jsonb_agg(c order by c->>'client_id') into out
  from (
    select jsonb_build_object(
      'client_id', r.client_id,
      'display_name', r.display_name,
      'status', r.platform->>'status',
      'tier', r.platform->'client'->>'tier',
      'company', r.platform->'client'->>'company',
      'board', jsonb_build_object(
        'slug',  r.platform->'board'->>'slug',
        'url',   r.platform->'board'->>'url',
        'token', r.platform->'board'->>'token'
      ),
      'lanes', (
        select jsonb_build_object(
          'armed', count(*) filter (where (w.value->>'armed')::boolean),
          'total', count(*)
        )
        from jsonb_each(coalesce(r.platform->'workflows', '{}'::jsonb)) w
      ),
      'drafts', (
        select jsonb_build_object(
          'review',  count(*) filter (where d.status = 'review'),
          'visible', count(*) filter (where d.board_visible),
          'total',   count(*)
        )
        from carousel_drafts d where d.client_id = r.client_id
      ),
      'spend', (
        select jsonb_build_object(
          'total_usd', round(coalesce(sum(u.est_cost_usd), 0)::numeric, 2),
          'week_usd',  round(coalesce(sum(u.est_cost_usd) filter (
                         where u.occurred_at >= now() - interval '7 days'), 0)::numeric, 2)
        )
        from client_api_usage u where u.client_id = r.client_id
      )
    ) as c
    from client_registry r
    -- An inactive registry row is not a client the operator has. It was reachable here because
    -- the only gate was `platform is not null`, so a deactivated or never-launched tenant showed
    -- up in Ivan's Client Ops list beside the real ones. coalesce(..., true) keeps the historical
    -- behaviour for any row whose is_active was never set.
    where r.platform is not null
      and coalesce(r.is_active, true)
  ) s;
  return jsonb_build_object('ok', true, 'clients', coalesce(out, '[]'::jsonb));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. client_research_runs: a run that cannot harvest says so
-- ---------------------------------------------------------------------------
alter table public.client_research_runs
  drop constraint if exists client_research_runs_status_chk;
alter table public.client_research_runs
  add constraint client_research_runs_status_chk
  check (status in ('running', 'ok', 'capped', 'failed', 'harvest_not_built'));

-- ---------------------------------------------------------------------------
-- 4. operator_gated_posts: the comment, not the code
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
      -- 083: roster posts in the window that carry no judgment at all. The subtraction is exact
      -- (judged + unjudged = every roster post in the window, always) because the `judged` join
      -- cannot multiply a src row. 083 justified that by competitor_gated_posts having a PRIMARY
      -- KEY on post_ref alone; 088 widened that key to (client_id, post_ref), and the guarantee
      -- now rests on the join itself -- it pins j.client_id = p_client_id, and (client_id,
      -- post_ref) is unique, so at most one row can match a given src post_ref.
      'unjudged', (select count(*) from src) - (select count(*) from judged),
      'posts', (select arr from posts_arr),
      -- 083: the loudest gate. Identical to posts -> 0 by construction; JSON null when the lane
      -- has no gated post in the window.
      'best', (select case when jsonb_array_length(arr) > 0 then arr -> 0 else null end
               from posts_arr)
    )
  );
end $function$;
