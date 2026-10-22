begin;
set local lock_timeout='5s';
-- Ops notes: Ivan's own free-text notes on the Ops page. Personal only: nothing
-- reads them, nothing is sent. Delete is soft (deleted_at) so Undo can bring a
-- note back with its first-written time.
create table public.ops_notes (
 id uuid primary key,
 user_id uuid not null,
 body text not null default '' check(length(body) <= 20000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz
);
create index ops_notes_user_live on public.ops_notes(user_id, created_at desc) where deleted_at is null;
alter table public.ops_notes enable row level security;
revoke all on public.ops_notes from public,anon,authenticated;
grant all on public.ops_notes to service_role;

create function public.operator_ops_notes(p_gate text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $fn$
begin
 if auth.uid() is null or not coalesce(public.operator_gate_ok(p_gate),false) then raise exception 'unauthorized' using errcode='42501'; end if;
 return jsonb_build_object('ok',true,'rows',coalesce((
  select jsonb_agg(jsonb_build_object('id',id,'body',body,'created_at',created_at,'updated_at',updated_at) order by created_at desc)
  from public.ops_notes where user_id=auth.uid() and deleted_at is null),'[]'::jsonb));
end $fn$;

-- Insert or update one note; saving a deleted note brings it back (Undo).
create function public.operator_save_ops_note(p_gate text,p_id uuid,p_body text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $fn$
declare r public.ops_notes;
begin
 if auth.uid() is null or not coalesce(public.operator_gate_ok(p_gate),false) then raise exception 'unauthorized' using errcode='42501'; end if;
 if p_id is null or p_body is null or length(p_body) > 20000 then raise exception 'invalid note'; end if;
 insert into public.ops_notes(id,user_id,body) values(p_id,auth.uid(),p_body)
 on conflict(id) do update set body=excluded.body, updated_at=now(), deleted_at=null
  where ops_notes.user_id=auth.uid()
 returning * into r;
 if r.id is null then raise exception 'unauthorized' using errcode='42501'; end if;
 return jsonb_build_object('ok',true,'row',jsonb_build_object('id',r.id,'body',r.body,'created_at',r.created_at,'updated_at',r.updated_at));
end $fn$;

create function public.operator_delete_ops_note(p_gate text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $fn$
begin
 if auth.uid() is null or not coalesce(public.operator_gate_ok(p_gate),false) then raise exception 'unauthorized' using errcode='42501'; end if;
 update public.ops_notes set deleted_at=now() where id=p_id and user_id=auth.uid() and deleted_at is null;
 return jsonb_build_object('ok',true,'id',p_id);
end $fn$;

revoke all on function public.operator_ops_notes(text) from public,anon;
revoke all on function public.operator_save_ops_note(text,uuid,text) from public,anon;
revoke all on function public.operator_delete_ops_note(text,uuid) from public,anon;
grant execute on function public.operator_ops_notes(text) to authenticated;
grant execute on function public.operator_save_ops_note(text,uuid,text) to authenticated;
grant execute on function public.operator_delete_ops_note(text,uuid) to authenticated;
commit;
