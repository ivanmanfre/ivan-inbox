-- 093: inbox_viewed_back(): per client, of the people invited in the last 7 and 30 days, how many
-- looked at the sending seat's profile afterwards. One caption line under the Lanes funnel.
-- Ivan 2026-09-18: "this should be judged in all clients. me, mattan, davoirin".
-- A CAPTION, never a funnel step: the funnel is strictly denominated (confirmed invitations, accepted
-- within 72 h) and LinkedIn exposes only some viewers, so this count is a floor.
-- Counts distinct prospects, so profile_view_log re-capturing one view on later days cannot inflate it.
-- profile_view_log is service_role-only under RLS, hence SECURITY DEFINER.

create or replace function public.inbox_viewed_back()
returns table (client_id text, invited_7d int, viewed_7d int, invited_30d int, viewed_30d int)
language sql stable security definer set search_path = public, pg_temp as $$
  with inv as (
    select pr.id, coalesce(c.client_id, 'ivan') as client_id, pr.connection_sent_at,
      exists (select 1 from profile_view_log l where l.prospect_id = pr.id
                and l.seat = coalesce(c.client_id, 'ivan') and l.viewed_at > pr.connection_sent_at) as viewed
    from outreach_prospects pr
    join outreach_campaigns c on c.id = pr.campaign_id
    where pr.connection_sent_at >= now() - interval '30 days'
  )
  select client_id,
    count(*) filter (where connection_sent_at >= now() - interval '7 days')::int,
    count(*) filter (where connection_sent_at >= now() - interval '7 days' and viewed)::int,
    count(*)::int,
    count(*) filter (where viewed)::int
  from inv group by client_id
$$;

revoke all on function public.inbox_viewed_back() from public, anon;
grant execute on function public.inbox_viewed_back() to authenticated, service_role;
