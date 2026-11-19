begin;

CREATE OR REPLACE FUNCTION public.claim_inbox_dm_pdf_transport(p_id uuid, p_claimed_at timestamp with time zone, p_file_id text, p_account_id text, p_chat_id text, p_text text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with claimed as (
    update public.outreach_messages m
    set draft_evidence = jsonb_set(m.draft_evidence, '{dm_attachment_transport_id}', to_jsonb(p_file_id))
    where m.id = p_id and m.sent_at = p_claimed_at and m.approved_at is not null
      and m.unipile_message_id is null and m.send_blocked_at is null
      and m.channel = 'linkedin' and m.direction = 'outbound' and m.message_type = 'manual_reply'
      and m.ai_model = 'inbox_on_demand_reply' and m.unipile_chat_id = p_chat_id
      and m.draft_evidence#>>'{dm_attachment,id}' = p_file_id
      and m.draft_evidence#>>'{operator_copy_approval,attachment_id}' = p_file_id
      and m.draft_evidence#>>'{operator_copy_approval,attachment_chat}' = p_chat_id
      and m.draft_evidence#>>'{operator_copy_approval,text}' = m.message_text
      and m.message_text = p_text
      and m.draft_evidence->>'dm_attachment_transport_id' is distinct from p_file_id
      and exists (select 1 from public.inbox_messages_v v where v.id = m.id and v.client_id = 'ivan')
      and exists (select 1 from public.outreach_agent_accounts a where a.client_id = 'ivan' and a.provider_account_id = p_account_id)
    returning m.id
  )
  select exists (select 1 from claimed);
$function$;

CREATE OR REPLACE FUNCTION public.set_inbox_dm_draft_file(p_id uuid, p_expected_file_id text, p_file jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result jsonb;
begin
  update public.outreach_messages m
  set draft_evidence = case when p_file is null then m.draft_evidence - 'dm_attachment'
    else jsonb_set(m.draft_evidence, '{dm_attachment}', p_file) end,
    send_blocked_at = case when p_file is not null and m.send_blocked_reason = 'lint_pdf_file_unavailable' then null else m.send_blocked_at end,
    send_blocked_reason = case when p_file is not null and m.send_blocked_reason = 'lint_pdf_file_unavailable' then null else m.send_blocked_reason end
  where m.id = p_id and m.draft_evidence#>>'{dm_attachment,id}' is not distinct from p_expected_file_id
    and m.approved_at is null and m.sent_at is null and m.unipile_message_id is null
    and (m.send_blocked_at is null or (m.send_blocked_reason in
      ('lint_pdf_file_unavailable','lint_pdf_route_changed','post_approval_race:scheduled_pdf_requires_review')
      and m.draft_evidence->>'dm_attachment_transport_id' is null))
    and m.direction = 'outbound' and m.channel = 'linkedin' and m.message_type in ('dm','manual_reply')
    and m.ai_model = 'inbox_on_demand_reply' and m.draft_evidence->>'v' = 'inbox_on_demand_reply_v1'
    and m.unipile_chat_id is not null
    and exists (select 1 from public.inbox_messages_v v where v.id = m.id and v.client_id = 'ivan')
  returning draft_evidence into result;
  return result;
end;
$function$;

commit;
