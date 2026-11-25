-- Keep the original Desk claim, message, chips, weekly cap and source artifact.
-- Mirror only a newly won editorial claim, in the same transaction.
begin;
create or replace function public.desk_fire_assistant_trigger(
  p_kind text, p_dedupe_key text, p_payload jsonb, p_cap integer,
  p_user uuid, p_body text, p_meta jsonb
) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  message public.desk_messages%rowtype;
  main public.inbox_threads%rowtype;
begin
  result := public.desk_fire_trigger(p_kind, p_dedupe_key, p_payload, p_cap, p_user, p_body, p_meta);
  if not coalesce((result->>'fired')::boolean, false)
    or p_kind not in ('week_plan', 'empty_slot', 'post_beat', 'call_line')
    or p_meta->>'test' = 'true' then
    return result;
  end if;
  select * into message from public.desk_messages
    where id = (result->>'message_id')::uuid and user_id = p_user and origin = 'proactive'
      and role = 'assistant' and status = 'done' and meta->>'trigger' = p_kind;
  if not found then return result; end if;

  insert into public.inbox_threads(user_id, kind, title)
    values (p_user, 'bot', 'Assistant')
    on conflict (user_id) where kind = 'bot' do nothing;
  select * into strict main from public.inbox_threads where kind = 'bot' and user_id = p_user;
  -- Same durable ID, no synthetic operator prompt, CLI session or completion callback.
  insert into public.inbox_turns(id, thread_id, user_id, origin, prompt, answer, status, sources,
                               created_at, started_at, finished_at)
    values (message.id, main.id, p_user, 'bot', '', message.body, 'done',
      jsonb_build_array(jsonb_build_object('kind','content_desk','path',message.id,'at',message.created_at)),
      message.created_at, message.created_at, message.created_at);
  update public.desk_messages set meta = meta || jsonb_build_object('mirrored_main_thread', main.id)
    where id = message.id;
  update public.inbox_threads set last_turn_at = greatest(last_turn_at, message.created_at),
    updated_at = greatest(updated_at, message.created_at) where id = main.id;
  return result || jsonb_build_object('main_thread_id',main.id,'main_push_muted',main.bot_push_muted);
end $$;
revoke all on function public.desk_fire_assistant_trigger(text,text,jsonb,integer,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.desk_fire_assistant_trigger(text,text,jsonb,integer,uuid,text,jsonb) to service_role;
commit;
