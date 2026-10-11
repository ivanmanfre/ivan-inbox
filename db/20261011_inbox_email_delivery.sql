-- Select delivery for the email attached to a pending LinkedIn draft.
create or replace function public.set_inbox_draft_email_delivery(
  p_message_id uuid, p_enabled boolean, p_expected_evidence jsonb, p_expected_recipient text
) returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $function$
declare
  saved public.outreach_messages%rowtype;
  address text;
begin
  select * into saved from public.outreach_messages m
  where m.id=p_message_id and m.direction='outbound' and m.message_type='dm'
    and coalesce(m.channel,'linkedin')='linkedin'
    and m.sent_at is null and m.approved_at is null and m.unipile_message_id is null
    and m.draft_evidence is not distinct from p_expected_evidence
    and m.recipient_email is not distinct from p_expected_recipient
    and (m.email_mirror_text is not null or m.ai_model='rise_dm2_scan_delivery_v1')
    and (m.send_blocked_reason is null
      or starts_with(m.send_blocked_reason,'post_approval_race:')
      or starts_with(m.send_blocked_reason,'lint_'))
  for update;
  if not found or p_enabled is null then raise exception 'The draft changed. Refresh before approving.'; end if;
  address := coalesce(nullif(saved.recipient_email,''),nullif(saved.draft_evidence->>'email_delivery_recipient',''));
  if address is null then raise exception 'Refresh to check the email recipient.'; end if;
  update public.outreach_messages m set
    recipient_email=case when p_enabled then address else null end,
    draft_evidence=coalesce(m.draft_evidence,'{}'::jsonb)
      || jsonb_build_object('email_delivery_recipient',address)
      || case when p_enabled then '{}'::jsonb else jsonb_build_object('email_cc','[]'::jsonb) end
  where m.id=p_message_id
  returning * into saved;
  return jsonb_build_object('recipient_email',saved.recipient_email,'email_delivery_recipient',address,
    'draft_evidence',saved.draft_evidence,'email_cc',coalesce(saved.draft_evidence->'email_cc','[]'::jsonb));
end;
$function$;
revoke all on function public.set_inbox_draft_email_delivery(uuid,boolean,jsonb,text) from public, anon;
grant execute on function public.set_inbox_draft_email_delivery(uuid,boolean,jsonb,text) to authenticated, service_role;
