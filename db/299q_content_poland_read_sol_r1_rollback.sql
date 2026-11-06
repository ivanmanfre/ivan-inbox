-- Rollback of db/299q: db/299p's content_poland_due and content_poland_of again, then the helper goes.
create or replace function public.content_poland_due(p_limit int default 20)
returns table(draft_id uuid, body text, body_md5 text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select d.id, d.post_body, md5(d.post_body)
    from public.carousel_drafts d
    left join public.content_poland_reads r on r.draft_id = d.id
   where d.client_id is null
     and nullif(btrim(coalesce(d.post_body, '')), '') is not null
     and d.created_at > now() - interval '60 days'
     and (d.status in ('review', 'approved', 'scheduled')
          or (d.published_at is not null and d.published_at > now() - interval '21 days'))
     and not coalesce((d.taxonomy->>'deleted_by_operator') = 'true', false)
     and public.content_poland_brain_vote(d.taxonomy) is null
     and (r.draft_id is null or r.body_md5 is distinct from md5(d.post_body))
   order by d.created_at desc
   limit greatest(coalesce(p_limit, 20), 0);
$$;

create or replace function public.content_poland_of(p_ids uuid[])
returns table(draft_id uuid, poland boolean, source text, why text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.cb34_p2_operator_lane_allowed('ivan') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return query
  select d.id,
         coalesce(public.content_poland_brain_vote(d.taxonomy), case when r.body_md5 = md5(d.post_body) then r.is_poland end),
         case when public.content_poland_brain_vote(d.taxonomy) is not null then 'brain_check'
              when r.body_md5 = md5(d.post_body) then 'read' end,
         case when public.content_poland_brain_vote(d.taxonomy) is not null then null::text
              when r.body_md5 = md5(d.post_body) then r.why end
    from public.carousel_drafts d
    left join public.content_poland_reads r on r.draft_id = d.id
   where d.id = any(coalesce(p_ids, '{}'::uuid[])) and d.client_id is null
   limit 500;
end;
$$;

drop function if exists public.content_poland_brain_vote_current(uuid, jsonb, text);
