-- Rollback for 20261127_take_lane_more_sources.sql: restores the 2026-11-07 candidates function (tracked X + competitor_posts only, no block list).
-- The 11-07 function ignores blocked_authors, so blocked creators come back: pause the lane (ivan_take_lane.enabled false) if that matters.
begin;
create or replace function public.ivan_take_candidates_v1(
  p_exclude text[] default '{}', p_x_days int default 7, p_li_days int default 14, p_per_platform int default 25)
returns jsonb
language sql stable security definer set search_path = public
as $$
with x as (
  select distinct on (source_id) source_id, source_url, owner, source_published_at, candidate_fields cf
  from editorial_sources
  where client_id = 'ivan'
    and candidate_fields->>'query_config_id' in ('ivan-x-tracked-v1', 'ivan-x-agency-owner-v1')
    and source_published_at > now() - interval '30 days'
  order by source_id, seen_version desc, created_at desc
), xm as (
  select owner, (percentile_cont(0.5) within group (
           order by coalesce((cf->'observed_metrics'->>'likes')::numeric, 0)))::numeric med, count(*) n
  from x group by owner
), xc as (
  select 'x'::text platform,
         'https://x.com/' || x.owner || '/status/' || coalesce(public.ivan_take_native_id(x.source_url), x.source_id) url, x.owner handle, null::text author_name,
         x.source_published_at published_at,
         coalesce((cf->'observed_metrics'->>'likes')::int, 0) likes,
         coalesce((cf->'observed_metrics'->>'reposts')::int, 0) reposts,
         coalesce((cf->'observed_metrics'->>'replies')::int, 0) comments,
         coalesce((cf->'observed_metrics'->>'views')::int, 0) views,
         xm.med own_median, xm.n median_n,
         round(coalesce((cf->'observed_metrics'->>'likes')::numeric, 0) / greatest(xm.med, 1), 1) ratio,
         coalesce(nullif(cf->>'evidence', ''), '') post_text,
         null::text post_type, cf->>'query_config_id' feed
  from x join xm using (owner)
  where x.source_published_at > now() - make_interval(days => p_x_days)
    and coalesce(cf->>'evidence', '') !~ '^\s*RT @'
    and length(coalesce(cf->>'evidence', '')) >= 40
    and coalesce((cf->'observed_metrics'->>'likes')::numeric, 0) >= greatest(1.5 * xm.med, 10)
    and not (coalesce((cf->'observed_metrics'->>'likes')::numeric, 0) >= greatest(3 * xm.med, 25)
             and x.source_published_at > now() - interval '2 days')
), lm as (
  select competitor_name, (percentile_cont(0.5) within group (order by likes_count))::numeric med, count(*) n
  from competitor_posts
  where client_id is null and post_date > now() - interval '60 days'
  group by competitor_name
), lc as (
  select 'linkedin'::text platform, p.linkedin_post_url url, null::text handle, p.competitor_name author_name,
         p.post_date published_at, coalesce(p.likes_count, 0) likes, coalesce(p.reposts_count, 0) reposts,
         coalesce(p.comments_count, 0) comments, null::int views, lm.med own_median, lm.n median_n,
         round(coalesce(p.likes_count, 0) / greatest(lm.med, 1), 1) ratio,
         coalesce(p.post_text, '') post_text, p.post_type, 'competitor_posts'::text feed
  from competitor_posts p join lm using (competitor_name)
  where p.client_id is null
    and p.post_date > now() - make_interval(days => p_li_days)
    and p.linkedin_post_url ~ '(activity|ugcPost|share)[-:][0-9]{16,20}'
    and length(coalesce(p.post_text, '')) >= 40
    and coalesce(p.likes_count, 0) >= greatest(1.5 * lm.med, 10)
), u as (
  select u0.*, public.ivan_take_native_id(u0.url) native_id
  from (select * from xc union all select * from lc) u0
), used as (
  -- Any draft of the same post, whatever URL form it was stored under (x.com / twitter.com / mobile / query string).
  select distinct public.ivan_take_native_id(source_ref) native_id
  from carousel_drafts where source_ref ~ '[0-9]{16,25}'
), fresh as (
  select u.* from u
  where u.native_id is not null
    and not exists (select 1 from unnest(coalesce(p_exclude, '{}')) e where public.ivan_take_native_id(e) = u.native_id)
    and not exists (select 1 from used where used.native_id = u.native_id)
), ranked as (
  select fresh.*, row_number() over (partition by platform order by ratio desc, likes desc) rn from fresh
)
select coalesce(jsonb_agg(to_jsonb(r) - 'rn' order by r.ratio desc), '[]'::jsonb)
from ranked r where r.rn <= greatest(1, least(p_per_platform, 200));
$$;
revoke all on function public.ivan_take_candidates_v1(text[], int, int, int) from public, anon, authenticated;
grant execute on function public.ivan_take_candidates_v1(text[], int, int, int) to service_role;
commit;
