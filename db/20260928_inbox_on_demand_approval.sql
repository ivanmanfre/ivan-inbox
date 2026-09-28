-- A reviewed on-demand reply uses the existing human ownership contract.
-- Lock before takeover: duplicate approvals cannot invalidate the winning revision.
create or replace function public.approve_inbox_on_demand_reply(
  p_message_id uuid, p_text text, p_chat_id text default null
) returns void
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  m public.outreach_messages%rowtype;
  guard jsonb;
  evidence jsonb;
  touched integer;
begin
  select * into m from public.outreach_messages where id=p_message_id for update;
  if not found then raise exception 'The draft could not be loaded.'; end if;
  if m.ai_model is distinct from 'inbox_on_demand_reply'
    or m.draft_evidence->>'v' is distinct from 'inbox_on_demand_reply_v1'
    or m.direction is distinct from 'outbound'
    or coalesce(m.message_type,'') not in ('dm','manual_reply')
    or m.sent_at is not null or m.approved_at is not null or m.unipile_message_id is not null
    or (m.send_blocked_reason is not null and m.send_blocked_reason not like 'post_approval_race:%' and left(m.send_blocked_reason,5)<>'lint_')
  then raise exception 'The draft changed or was already approved. Refresh before sending.'; end if;
  if nullif(trim(p_text),'') is null or length(p_text)>8000 then raise exception 'The reply is empty or too long.'; end if;

  guard := public.conversation_agent_before_manual_send(m.prospect_id);
  if coalesce((guard->>'ok')::boolean,false) is not true
    or coalesce((guard->>'allow_send')::boolean,false) is not true
    or coalesce((guard->>'in_flight')::boolean,false)
  then raise exception 'Conversation ownership could not be confirmed: %', coalesce(guard->>'reason','unknown'); end if;

  evidence := coalesce(m.draft_evidence,'{}'::jsonb) - 'conversation_agent_manual_revision';
  if guard->>'revision' is not null then
    evidence := evidence || jsonb_build_object('conversation_agent_manual_revision',(guard->>'revision')::bigint);
  end if;
  update public.outreach_messages set message_type='manual_reply', message_text=p_text,
    approved_at=now(), send_blocked_at=null, send_blocked_reason=null,
    unipile_chat_id=coalesce(nullif(p_chat_id,''),m.unipile_chat_id), draft_evidence=evidence
  where id=m.id;
  get diagnostics touched = row_count;
  if touched<>1 then raise exception 'The draft could not be approved. Refresh before sending.'; end if;
end;
$$;
revoke all on function public.approve_inbox_on_demand_reply(uuid,text,text) from public;
grant execute on function public.approve_inbox_on_demand_reply(uuid,text,text) to authenticated, service_role;
