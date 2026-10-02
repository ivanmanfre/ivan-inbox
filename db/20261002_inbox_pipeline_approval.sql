-- Keep large research evidence in the RPC body, never a PostgREST URL filter.
-- The guarded update preserves the original approval concurrency contract.
create or replace function public.approve_inbox_pipeline_draft(
  p_message_id uuid, p_text text, p_expected_evidence jsonb, p_chat_id text default null
) returns void
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  approved_time timestamptz := now();
  touched integer;
begin
  update public.outreach_messages m set
    message_text=p_text, approved_at=approved_time,
    draft_evidence=coalesce(m.draft_evidence,'{}'::jsonb) || jsonb_build_object(
      'operator_copy_approval', jsonb_build_object('source','inbox','text',p_text,'approved_at',approved_time)),
    send_blocked_reason=null, send_blocked_at=null,
    unipile_chat_id=coalesce(nullif(p_chat_id,''),m.unipile_chat_id)
  where m.id=p_message_id
    and m.direction='outbound'
    and m.ai_model is distinct from 'inbox_on_demand_reply'
    and m.sent_at is null and m.approved_at is null and m.unipile_message_id is null
    and m.draft_evidence is not distinct from p_expected_evidence
    and (m.send_blocked_reason is null
      or starts_with(m.send_blocked_reason,'post_approval_race:')
      or starts_with(m.send_blocked_reason,'lint_'));
  get diagnostics touched = row_count;
  if touched<>1 then raise exception 'The draft changed before approval. Refresh before sending.'; end if;
end;
$$;
revoke all on function public.approve_inbox_pipeline_draft(uuid,text,jsonb,text) from public, anon;
grant execute on function public.approve_inbox_pipeline_draft(uuid,text,jsonb,text) to authenticated, service_role;
