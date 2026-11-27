-- Take + screenshot lane: more sources and a per-author block list (Ivan 2026-11-27: "we can find way more
-- sources", plus a list of creators he does not want to react to).
--   X:        tracked handles (editorial_sources) + Ivan's scraped X competitor accounts (x_competitor_posts,
--             client_id 'ivan', no replies or retweets). Same post in both = one row (editorial copy wins).
--   LinkedIn: tracked creators (competitor_posts, client_id null) + the Ivan outlier-study authors
--             (outlier_supply_posts, client_id 'ivan', likes from the latest outlier_post_scores_v4 row).
--             Same post in both = one row (competitor_posts copy wins).
--   Each post is still scored against its author's OWN median likes, over the merged set.
--   Block list: integration_config ivan_take_lane.blocked_authors, lowercase X handles or LinkedIn names.
--   Output shape, parameters and the other rules are unchanged, so the n8n job needs no change.
--   Only reader: n8n "Ivan Take + Screenshot Lane" (who-reads 2026-11-27).
-- Rollback: 20261127_take_lane_more_sources_rollback.sql
begin;

create or replace function public.ivan_take_candidates_v1(
  p_exclude text[] default '{}', p_x_days int default 7, p_li_days int default 14, p_per_platform int default 25)
returns jsonb
language sql stable security definer set search_path = public
as $$
with cfg as (
  -- Only a JSON array counts; null, blank and non-string entries are ignored (a bad entry must not empty the pool).
  select coalesce((select array_agg(lower(trim(e #>> '{}')))
                     from jsonb_array_elements(case when jsonb_typeof(v.value::jsonb->'blocked_authors') = 'array'
                                                    then v.value::jsonb->'blocked_authors' else '[]'::jsonb end) e
                    where jsonb_typeof(e) = 'string' and trim(e #>> '{}') <> ''), '{}') blocked
  from (select (select value from integration_config where key = 'ivan_take_lane') value) v
), xe as (
  select distinct on (source_id) source_id, source_url, owner, source_published_at, candidate_fields cf
  from editorial_sources
  where client_id = 'ivan'
    and candidate_fields->>'query_config_id' in ('ivan-x-tracked-v1', 'ivan-x-agency-owner-v1')
    and source_published_at > now() - interval '30 days'
  order by source_id, seen_version desc, created_at desc
), xa0 as (
  select coalesce(public.ivan_take_native_id(source_url), source_id) native_id, owner handle, source_published_at published_at,
         -- numeric, as in the 11-07 version: metrics can arrive as "10.0"; null likes count as 0 there too.
         coalesce((cf->'observed_metrics'->>'likes')::numeric, 0) likes,
         (cf->'observed_metrics'->>'reposts')::numeric reposts,
         (cf->'observed_metrics'->>'replies')::numeric comments,
         (cf->'observed_metrics'->>'views')::numeric views,
         coalesce(nullif(cf->>'evidence', ''), '') post_text, cf->>'query_config_id' feed, 1 pri
  from xe
  union all
  select post_id, author_handle, created_at, coalesce(likes, 0)::numeric, reposts::numeric, replies::numeric, views::numeric,
         coalesce(text, ''), 'x_competitor_posts', 2
  from x_competitor_posts
  where client_id = 'ivan' and created_at > now() - interval '30 days'
    and not coalesce(is_reply, false) and not coalesce(is_retweet, false)
    and post_id ~ '^[0-9]{5,25}$' and coalesce(author_handle, '') <> ''
), xa as (
  select distinct on (native_id) * from xa0 order by native_id, pri, likes desc
), xm as (
  select lower(handle) hk, (percentile_cont(0.5) within group (order by likes))::numeric med, count(*) n
  from xa group by lower(handle)
), xc as (
  select 'x'::text platform, 'https://x.com/' || xa.handle || '/status/' || xa.native_id url, xa.handle, null::text author_name,
         xa.published_at, round(xa.likes)::int likes, coalesce(round(xa.reposts)::int, 0) reposts,
         coalesce(round(xa.comments)::int, 0) comments, coalesce(round(xa.views)::int, 0) views,
         xm.med own_median, xm.n median_n, round(xa.likes::numeric / greatest(xm.med, 1), 1) ratio,
         xa.post_text, null::text post_type, xa.feed
  from xa join xm on xm.hk = lower(xa.handle)
  where xa.published_at > now() - make_interval(days => p_x_days)
    and xa.post_text !~ '^\s*RT @'
    and length(xa.post_text) >= 40
    and xa.likes >= greatest(1.5 * xm.med, 10)
    and not (xa.likes >= greatest(3 * xm.med, 25) and xa.published_at > now() - interval '2 days')
), s4 as (
  select distinct on (post_ref) post_ref, likes, reposts, comments
  from outlier_post_scores_v4
  where client_id = 'ivan' and published_at > now() - interval '60 days'
  order by post_ref, created_at desc
), la0 as (
  select public.ivan_take_native_id(linkedin_post_url) native_id, linkedin_post_url url, competitor_name author_name,
         -- likes stay null when unknown, so the median ignores them (as in the 11-07 version) and the post cannot qualify.
         post_date published_at, likes_count::numeric likes, reposts_count reposts,
         comments_count comments, coalesce(post_text, '') post_text, post_type, 'competitor_posts'::text feed, 1 pri
  from competitor_posts
  where client_id is null and post_date > now() - interval '60 days'
  union all
  select public.ivan_take_native_id(o.source_url), o.source_url, o.author_name, o.published_at, s4.likes::numeric,
         s4.reposts, s4.comments, coalesce(o.post_text, ''), o.post_type, 'outlier_supply_posts', 2
  from outlier_supply_posts o join s4 on s4.post_ref = o.post_ref
  where o.client_id = 'ivan' and o.published_at > now() - interval '60 days' and coalesce(o.author_name, '') <> ''
), la as (
  select distinct on (native_id) * from la0 where native_id is not null order by native_id, pri, likes desc nulls last
), lm as (
  select lower(author_name) ak, (percentile_cont(0.5) within group (order by likes))::numeric med, count(*) n
  from la group by lower(author_name)
), lc as (
  select 'linkedin'::text platform, la.url, null::text handle, la.author_name, la.published_at, round(la.likes)::int likes,
         coalesce(la.reposts, 0) reposts, coalesce(la.comments, 0) comments, null::int views, lm.med own_median, lm.n median_n,
         round(la.likes::numeric / greatest(lm.med, 1), 1) ratio, la.post_text, la.post_type, la.feed
  from la join lm on lm.ak = lower(la.author_name)
  where la.published_at > now() - make_interval(days => p_li_days)
    and la.url ~ '(activity|ugcPost|share)[-:][0-9]{16,20}'
    and length(la.post_text) >= 40
    and coalesce(la.likes, 0) >= greatest(1.5 * lm.med, 10)
), u as (
  select u0.*, public.ivan_take_native_id(u0.url) native_id
  from (select * from xc union all select * from lc) u0
), used as (
  -- Any draft of the same post, whatever URL form it was stored under (x.com / twitter.com / mobile / query string).
  select distinct public.ivan_take_native_id(source_ref) native_id
  from carousel_drafts where source_ref ~ '[0-9]{16,25}'
), fresh as (
  select u.* from u, cfg
  where u.native_id is not null
    -- X rows match on the handle, LinkedIn rows on the author name.
    and not (case when u.platform = 'x' then lower(trim(coalesce(u.handle, ''))) else lower(trim(coalesce(u.author_name, ''))) end
             = any (cfg.blocked))
    and not exists (select 1 from unnest(coalesce(p_exclude, '{}')) e where public.ivan_take_native_id(e) = u.native_id)
    and not exists (select 1 from used where used.native_id = u.native_id)
), ranked as (
  select fresh.*, row_number() over (partition by platform order by ratio desc, likes desc) rn from fresh
)
select coalesce(jsonb_agg(to_jsonb(r) - 'rn' order by r.ratio desc), '[]'::jsonb)
-- 200+ = the manual only_urls test call: no cap there, so a requested URL is never cut off by a bigger pool.
from ranked r where r.rn <= case when p_per_platform >= 200 then 2147483647 else greatest(1, p_per_platform) end;
$$;
revoke all on function public.ivan_take_candidates_v1(text[], int, int, int) from public, anon, authenticated;
grant execute on function public.ivan_take_candidates_v1(text[], int, int, int) to service_role;

commit;
