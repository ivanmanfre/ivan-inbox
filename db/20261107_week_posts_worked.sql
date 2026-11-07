-- Sunday work review: "Posts that worked" (triage #50, wave 2, 2026-11-07).
-- Read-only. Ivan's own posts in one review window, each against his organic 90-day median, using the
-- same rules as ivan_rerun_check (build 09, PR #94): boost-marked posts never count, dead twins
-- (0 impressions, never read by the tracker) are skipped, the median covers posts 3-90 days old with
-- impressions > 0, and "worked" is the same 1.5x bar a re-run needs. A post read less than 48 hours
-- after it went out is "too new": its views are still coming in.
create or replace function public.ivan_week_posts_worked(p_start timestamptz, p_end timestamptz)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  with asof as (select least(p_end, now()) t),
  boosted as (select b.post_ref from public.own_post_boost_current_v b where b.client_id = 'ivan' and b.boosted is true),
  own as (
    select o.id, o.linkedin_url, o.posted_at, o.num_impressions, o.num_likes, o.num_comments, o.post_text, o.metrics_updated_at,
           exists (select 1 from boosted b where b.post_ref in (public.outlier_canonical_post_ref(o.social_id), public.outlier_canonical_post_ref(o.linkedin_url))) is_boosted
      from public.own_posts o, asof
     where o.posted_at <= asof.t and coalesce(o.post_text, '') <> ''
       and not (coalesce(o.num_impressions, 0) = 0 and o.metrics_updated_at is null)),
  med as (
    select percentile_cont(0.5) within group (order by o.num_impressions)::numeric md, count(*) n
      from own o, asof
     where o.posted_at > asof.t - interval '90 days' and o.posted_at <= asof.t - interval '3 days'
       and o.num_impressions > 0 and not o.is_boosted),
  wk as (
    select o.*, (o.metrics_updated_at is null or o.metrics_updated_at < o.posted_at + interval '48 hours') too_new
      from own o where o.posted_at >= p_start and o.posted_at < p_end)
  select jsonb_build_object(
    'start', p_start, 'end', p_end, 'as_of', (select t from asof),
    'median', round(m.md), 'median_n', m.n, 'bar', ceil(1.5 * m.md),
    'posts', coalesce((select jsonb_agg(jsonb_build_object(
        'posted_at', w.posted_at,
        'url', case when w.linkedin_url ~* '^https://' then w.linkedin_url end,
        'first_line', left(btrim(split_part(btrim(w.post_text), E'\n', 1)), 90),
        'impressions', coalesce(w.num_impressions, 0), 'likes', coalesce(w.num_likes, 0), 'comments', coalesce(w.num_comments, 0),
        'read_at', w.metrics_updated_at, 'boosted', w.is_boosted, 'too_new', w.too_new,
        'times_median', case when m.md > 0 then round(coalesce(w.num_impressions, 0) / m.md, 1) end,
        'worked', (not w.is_boosted and not w.too_new and m.n >= 5 and coalesce(w.num_impressions, 0) >= 1.5 * m.md))
      order by w.num_impressions desc nulls last, w.posted_at) from wk w), '[]'::jsonb))
  from med m
$$;
revoke all on function public.ivan_week_posts_worked(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ivan_week_posts_worked(timestamptz, timestamptz) to service_role;
