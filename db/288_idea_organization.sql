begin;
set local lock_timeout='5s';
-- Personal curation only. No idea status, generator, board or publishing writes.
create table public.content_idea_organization (
 user_id uuid not null,
 client_id text not null,
 idea_id text not null check(length(idea_id) between 1 and 200),
 shortlisted boolean not null default false,
 topic text check(topic in ('Content & LinkedIn','Sales & outreach','Founder life','Unsorted')),
 updated_at timestamptz not null default now(),
 primary key(user_id,client_id,idea_id)
);
alter table public.content_idea_organization enable row level security;
revoke all on public.content_idea_organization from public,anon,authenticated;
grant all on public.content_idea_organization to service_role;

create function public.operator_idea_organization(p_gate text,p_client text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $fn$
begin
 if auth.uid() is null or not coalesce(public.operator_gate_ok(p_gate),false) or not coalesce(public.lane_allowed(p_client),false) then raise exception 'unauthorized' using errcode='42501'; end if;
 return jsonb_build_object('ok',true,'client',p_client,'rows',coalesce((
  select jsonb_agg(jsonb_build_object('id',idea_id,'shortlisted',shortlisted,'topic',topic) order by idea_id)
  from public.content_idea_organization where user_id=auth.uid() and client_id=p_client),'[]'::jsonb));
end $fn$;
create function public.operator_set_idea_organization(p_gate text,p_client text,p_id text,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $fn$
declare r public.content_idea_organization;
begin
 if auth.uid() is null or not coalesce(public.operator_gate_ok(p_gate),false) or not coalesce(public.lane_allowed(p_client),false) then raise exception 'unauthorized' using errcode='42501'; end if;
 if p_id is null or length(p_id) not between 1 and 200 or p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'invalid curation'; end if;
 if p_patch='{}'::jsonb or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('shortlisted','topic')) then raise exception 'invalid curation fields'; end if;
 if p_patch?'shortlisted' and jsonb_typeof(p_patch->'shortlisted') is distinct from 'boolean' then raise exception 'invalid shortlist value'; end if;
 if p_patch?'topic' and p_patch->'topic'<>'null'::jsonb and (jsonb_typeof(p_patch->'topic')<>'string' or p_patch->>'topic' not in ('Content & LinkedIn','Sales & outreach','Founder life','Unsorted')) then raise exception 'invalid topic'; end if;
 insert into public.content_idea_organization(user_id,client_id,idea_id,shortlisted,topic)
 values(auth.uid(),p_client,p_id,coalesce((p_patch->>'shortlisted')::boolean,false),p_patch->>'topic')
 on conflict(user_id,client_id,idea_id) do update set
  shortlisted=case when p_patch?'shortlisted' then excluded.shortlisted else content_idea_organization.shortlisted end,
  topic=case when p_patch?'topic' then excluded.topic else content_idea_organization.topic end,
  updated_at=now()
 returning * into r;
 return jsonb_build_object('ok',true,'client',p_client,'row',jsonb_build_object('id',r.idea_id,'shortlisted',r.shortlisted,'topic',r.topic));
end $fn$;
revoke all on function public.operator_idea_organization(text,text) from public,anon;
revoke all on function public.operator_set_idea_organization(text,text,text,jsonb) from public,anon;
grant execute on function public.operator_idea_organization(text,text) to authenticated;
grant execute on function public.operator_set_idea_organization(text,text,text,jsonb) to authenticated;
commit;
