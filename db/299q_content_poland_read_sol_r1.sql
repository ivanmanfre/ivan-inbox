-- db/299q (cross-review r1 on db/299p): the content-brain vote judged the RELEASED body. Once Ivan edits the draft
-- the vote may no longer hold (a Poland draft rewritten into a business post kept "poland: true", and
-- content_poland_due skipped it for good). The vote now counts only while the draft's body is still the one the
-- brain released (cb34_p2_members.body_sha256); an edited brain draft gets its own proxy read like any other.

create or replace function public.content_poland_brain_vote_current(p_draft uuid, p_taxonomy jsonb, p_body text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case when exists (
           select 1 from public.cb34_p2_members m
            where m.draft_id = p_draft
              and m.body_sha256 = encode(sha256(convert_to(coalesce(p_body, ''), 'UTF8')), 'hex'))
         then public.content_poland_brain_vote(p_taxonomy) end
$$;

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
     and public.content_poland_brain_vote_current(d.id, d.taxonomy, d.post_body) is null
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
  with x as (
    select d.id, d.post_body, public.content_poland_brain_vote_current(d.id, d.taxonomy, d.post_body) as vote,
           case when r.body_md5 = md5(d.post_body) then r.is_poland end as read_poland,
           case when r.body_md5 = md5(d.post_body) then r.why end as read_why
      from public.carousel_drafts d
      left join public.content_poland_reads r on r.draft_id = d.id
     where d.id = any(coalesce(p_ids, '{}'::uuid[])) and d.client_id is null
     limit 500
  )
  select x.id, coalesce(x.vote, x.read_poland),
         case when x.vote is not null then 'brain_check' when x.read_poland is not null then 'read' end,
         case when x.vote is not null then null::text else x.read_why end
    from x;
end;
$$;

revoke all on function public.content_poland_brain_vote_current(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.content_poland_brain_vote_current(uuid, jsonb, text) to service_role;
