-- X articles on the content calendar (Ivan 2026-10-11: "a small flag on every box when there is an x article scheduled").
-- One row per article that has a day: scheduled (publish_after), going out, published, or failed after approval.
alter table x_articles add column if not exists publish_after timestamptz;

create or replace function public.x_calendar(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'status', a.status, 'x_url', a.x_url,
      'at', case when a.status = 'published' then coalesce(a.published_at, a.publish_after, a.approved_at)
                 else coalesce(a.publish_after, a.approved_at) end)
    order by coalesce(a.published_at, a.publish_after, a.approved_at)), '[]'::jsonb)
  from x_articles a
  where auth.uid() is not null
    and a.status in ('approved', 'publishing', 'published', 'failed')
    and (case when a.status = 'published' then coalesce(a.published_at, a.publish_after, a.approved_at)
              else coalesce(a.publish_after, a.approved_at) end) between p_from and p_to
$$;
revoke all on function public.x_calendar(timestamptz, timestamptz) from public, anon;
grant execute on function public.x_calendar(timestamptz, timestamptz) to authenticated;
