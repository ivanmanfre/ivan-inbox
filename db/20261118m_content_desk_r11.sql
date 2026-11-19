-- Content Desk, Sol desk-backend r10 #7 (2026-11-18): every live visible draft of Ivan's in ONE statement.
--
-- The desk resolves a draft action's target from Ivan's own words against ALL his live visible drafts
-- (resolution first, write-eligibility after). This returns them in one statement, as one jsonb array:
-- no paging and no PostgREST row cap, so the set can never be partially read.
-- SECURITY INVOKER: runs as Ivan's session, so the Review visibility view (cb34_p2_safe_drafts) is his.
-- Unfinished drafts must be in his Review; eval fixtures only when p_fixtures (and only then).
create or replace function public.desk_live_drafts(p_fixtures boolean)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'status', d.status, 'type', d.type, 'scheduled_at', d.scheduled_at, 'published_at', d.published_at,
           'body_head', left(coalesce(d.post_body, ''), 1200), 'updated_at', d.updated_at, 'created_at', d.created_at,
           'fixture', d.taxonomy->>'desk_eval_fixture') order by d.id), '[]'::jsonb)
    from public.carousel_drafts d
   where d.client_id is null
     and (d.status in ('review', 'approved', 'error', 'generating', 'scheduled')
          or (d.status = 'published' and d.published_at > now() - interval '31 days'))
     and ((d.taxonomy->>'desk_eval_fixture') is not null) = coalesce(p_fixtures, false)
     and (d.status not in ('review', 'approved', 'error', 'generating')
          or (d.taxonomy->>'desk_eval_fixture') is not null
          or exists (select 1 from public.cb34_p2_safe_drafts v where v.id = d.id))
$$;
revoke all on function public.desk_live_drafts(boolean) from public, anon;
grant execute on function public.desk_live_drafts(boolean) to authenticated;
