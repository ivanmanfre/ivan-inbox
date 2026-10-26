-- Formatting and its searchable source change together under the existing operator RLS policy.
create or replace function public.save_inbox_email_composition(
  p_message_id uuid, p_text text, p_composition jsonb, p_mirror boolean,
  p_expected_text text, p_expected_evidence jsonb
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp
as $function$
declare
  saved public.outreach_messages%rowtype;
  composition_key text := case when p_mirror then 'email_mirror_composition' else 'email_composition' end;
begin
  if p_mirror is null or p_text is null or length(p_text)>100000 then
    raise exception 'Enter a valid email body.';
  end if;
  if p_composition is not null and p_composition<>'null'::jsonb and (
    jsonb_typeof(p_composition)<>'object' or p_composition->>'version' is distinct from '1'
    or p_composition->>'source_text' is distinct from p_text
    or jsonb_typeof(p_composition->'body') is distinct from 'object'
    or p_composition->'body'->>'type' is distinct from 'doc'
    or coalesce(jsonb_typeof(p_composition->'signature'),'missing') not in ('object','null')
    or length(p_composition::text)>300000
  ) then raise exception 'The email formatting does not match its text.'; end if;

  update public.outreach_messages m set
    message_text=case when p_mirror then m.message_text else p_text end,
    email_mirror_text=case when p_mirror then p_text else m.email_mirror_text end,
    draft_evidence=case when p_composition is null or p_composition='null'::jsonb
      then coalesce(m.draft_evidence,'{}'::jsonb)-composition_key
      else coalesce(m.draft_evidence,'{}'::jsonb) || jsonb_build_object(composition_key,p_composition) end
  where m.id=p_message_id and m.direction='outbound'
    and (p_mirror or m.channel='email')
    and m.sent_at is null and m.approved_at is null and m.unipile_message_id is null
    and (case when p_mirror then m.email_mirror_text else m.message_text end) is not distinct from p_expected_text
    and m.draft_evidence is not distinct from p_expected_evidence
    and (m.send_blocked_reason is null
      or starts_with(m.send_blocked_reason,'post_approval_race:')
      or starts_with(m.send_blocked_reason,'lint_')
      or (m.send_blocked_reason='awaiting_client_review' and m.ai_model like 'swishdm_reply_%'))
  returning * into saved;
  if not found then raise exception 'The email draft changed. Refresh before saving.'; end if;
  return jsonb_build_object('message_text',saved.message_text,'email_mirror_text',saved.email_mirror_text,'draft_evidence',saved.draft_evidence);
end;
$function$;
revoke all on function public.save_inbox_email_composition(uuid,text,jsonb,boolean,text,jsonb) from public, anon;
grant execute on function public.save_inbox_email_composition(uuid,text,jsonb,boolean,text,jsonb) to authenticated, service_role;

-- Runs after the existing email-only/scheduled channel conversion trigger.
create or replace function public.inbox_reviewed_email_composition() returns trigger
language plpgsql security invoker set search_path = public, pg_temp
as $function$
declare
  evidence jsonb := coalesce(new.draft_evidence,'{}'::jsonb);
  receipt jsonb;
begin
  if new.channel='email' and (coalesce(old.channel,'linkedin')<>'email' or new.approved_at is distinct from old.approved_at)
    and evidence->'email_composition' is null
    and evidence->'email_mirror_composition'->>'source_text'=new.message_text then
    evidence := evidence || jsonb_build_object('email_composition',evidence->'email_mirror_composition');
  end if;
  if new.approved_at is not null and new.approved_at is distinct from old.approved_at
    and (evidence->'email_composition' is not null or evidence->'email_mirror_composition' is not null) then
    if new.channel='email' and evidence->'email_composition' is not null
      and evidence->'email_composition'->>'source_text' is distinct from new.message_text then
      raise exception 'The email formatting changed. Refresh before sending.';
    end if;
    receipt := coalesce(evidence->'operator_copy_approval','{}'::jsonb);
    if evidence->'email_composition' is not null then
      receipt := receipt || jsonb_build_object('email_composition',evidence->'email_composition');
    end if;
    if evidence->'email_mirror_composition' is not null then
      receipt := receipt || jsonb_build_object('email_mirror_composition',evidence->'email_mirror_composition');
    end if;
    evidence := evidence || jsonb_build_object('operator_copy_approval',receipt);
  end if;
  new.draft_evidence := case when new.draft_evidence is null and evidence='{}'::jsonb then null else evidence end;
  return new;
end;
$function$;
create or replace trigger inbox_z_reviewed_email_composition before update on public.outreach_messages
  for each row execute function public.inbox_reviewed_email_composition();
revoke all on function public.inbox_reviewed_email_composition() from public, anon;
notify pgrst, 'reload schema';
