-- Explicit operator override of an unsent rejection, on its original row.
create or replace function public.send_rejected_inbox_draft(
  p_message_id uuid, p_text text, p_expected_reason text,
  p_expected_blocked_at timestamptz, p_expected_approved_at timestamptz,
  p_expected_evidence jsonb, p_chat_id text default null
) returns void language plpgsql security invoker
set search_path = public, pg_temp as $$
declare
  m public.outreach_messages%rowtype;
  approved_time timestamptz := clock_timestamp();
  evidence jsonb;
  guard jsonb;
begin
  select * into m from public.outreach_messages where id=p_message_id for update;
  if not found or m.direction is distinct from 'outbound'
    or m.sent_at is not null or m.unipile_message_id is not null
    or m.message_text is distinct from p_text or nullif(trim(p_text),'') is null
    or m.send_blocked_reason is distinct from p_expected_reason
    or m.send_blocked_at is distinct from p_expected_blocked_at
    or m.approved_at is distinct from p_expected_approved_at
    or m.draft_evidence is distinct from p_expected_evidence
    or m.send_blocked_reason is null or m.send_blocked_at is null
    or m.send_blocked_reason ~ '^(discarded|superseded|scheduled)(_|$)'
    or m.send_blocked_reason like 'native_email_send_failed:%'
    or m.send_blocked_reason in ('owner_confirmation','reply_retry_pending','owner_confirmation_superseded')
  then raise exception 'The rejected draft changed. Refresh before sending.'; end if;
  evidence := coalesce(m.draft_evidence,'{}'::jsonb);
  if m.ai_model='inbox_on_demand_reply' then
    guard := public.conversation_agent_before_manual_send(m.prospect_id);
    if coalesce((guard->>'ok')::boolean,false) is not true
      or coalesce((guard->>'allow_send')::boolean,false) is not true
      or coalesce((guard->>'in_flight')::boolean,false)
    then raise exception 'Conversation ownership could not be confirmed.'; end if;
    evidence := evidence || jsonb_build_object('conversation_agent_manual_revision',(guard->>'revision')::bigint);
  end if;
  evidence := evidence || jsonb_build_object(
    'operator_copy_approval',jsonb_build_object('source','inbox','text',p_text,'approved_at',approved_time),
    'operator_send_anyways',jsonb_build_object('source','inbox','message_id',m.id,'text',p_text,
      'approved_at',approved_time,'operator_id',auth.uid(),'rejected_reason',m.send_blocked_reason,
      'rejected_at',m.send_blocked_at,'previous_approval',m.draft_evidence->'operator_copy_approval'));
  update public.outreach_messages set approved_at=approved_time, draft_evidence=evidence,
    send_blocked_reason=null,send_blocked_at=null,
    unipile_chat_id=coalesce(nullif(p_chat_id,''),m.unipile_chat_id)
  where id=m.id;
end $$;
revoke all on function public.send_rejected_inbox_draft(uuid,text,text,timestamptz,timestamptz,jsonb,text) from public, anon;
grant execute on function public.send_rejected_inbox_draft(uuid,text,text,timestamptz,timestamptz,jsonb,text) to authenticated;
