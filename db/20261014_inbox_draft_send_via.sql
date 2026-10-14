-- Saved channel choice. Email-only approval uses the existing standalone email sender.
create or replace function public.set_inbox_draft_send_via(
  p_message_id uuid, p_send_via text, p_expected_evidence jsonb, p_expected_recipient text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp
as $function$
declare
  saved public.outreach_messages%rowtype;
  address text;
begin
  if p_send_via is null or p_send_via not in ('dm','email','both') then
    raise exception 'Choose a valid send channel.';
  end if;
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
  if not found then raise exception 'The draft changed. Refresh before approving.'; end if;
  address := coalesce(nullif(saved.recipient_email,''),nullif(saved.draft_evidence->>'email_delivery_recipient',''));
  if address is null then raise exception 'Refresh to check the email recipient.'; end if;
  if p_send_via='email' and nullif(btrim(saved.email_mirror_text),'') is null then
    raise exception 'Email-only needs a saved email draft.';
  end if;
  update public.outreach_messages m set
    recipient_email=case when p_send_via='dm' then null else address end,
    draft_evidence=coalesce(m.draft_evidence,'{}'::jsonb)
      || jsonb_build_object('email_delivery_recipient',address,'send_via',p_send_via)
      || case when p_send_via='dm' then jsonb_build_object('email_cc','[]'::jsonb) else '{}'::jsonb end
  where m.id=p_message_id returning * into saved;
  return jsonb_build_object('recipient_email',saved.recipient_email,'email_delivery_recipient',address,'send_via',p_send_via,
    'draft_evidence',saved.draft_evidence,'email_cc',coalesce(saved.draft_evidence->'email_cc','[]'::jsonb));
end;
$function$;
revoke all on function public.set_inbox_draft_send_via(uuid,text,jsonb,text) from public, anon;
grant execute on function public.set_inbox_draft_send_via(uuid,text,jsonb,text) to authenticated, service_role;

-- Existing browser tabs keep their boolean choice contract and also reset the saved mode.
create or replace function public.set_inbox_draft_email_delivery(
  p_message_id uuid, p_enabled boolean, p_expected_evidence jsonb, p_expected_recipient text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp
as $function$
begin
  if p_enabled is null then raise exception 'The draft changed. Refresh before approving.'; end if;
  return public.set_inbox_draft_send_via(p_message_id,case when p_enabled then 'both' else 'dm' end,
    p_expected_evidence,p_expected_recipient);
end;
$function$;

drop function if exists public.approve_inbox_pipeline_draft(uuid,text,jsonb,text,text,text,text,jsonb);
create or replace function public.approve_inbox_pipeline_draft(
  p_message_id uuid, p_text text, p_expected_evidence jsonb, p_chat_id text default null,
  p_expected_email_mirror_text text default null, p_expected_recipient_email text default null,
  p_expected_email_subject text default null, p_expected_email_cc jsonb default null,
  p_expected_send_via text default null
) returns void language plpgsql security invoker set search_path = public, pg_temp
as $function$
declare
  approved_time timestamptz := now();
  saved public.outreach_messages%rowtype;
  email_only boolean;
  send_text text := p_text;
  email_body text;
  touched integer;
begin
  select * into saved from public.outreach_messages m
  where m.id=p_message_id and m.direction='outbound'
    and m.ai_model is distinct from 'inbox_on_demand_reply'
    and m.sent_at is null and m.approved_at is null and m.unipile_message_id is null
    and m.draft_evidence is not distinct from p_expected_evidence
    and (m.draft_evidence->>'send_via') is not distinct from p_expected_send_via
    and m.email_mirror_text is not distinct from p_expected_email_mirror_text
    and m.recipient_email is not distinct from p_expected_recipient_email
    and coalesce(m.draft_evidence->>'email_subject','')=coalesce(p_expected_email_subject,'')
    and coalesce(m.draft_evidence->'email_cc','[]'::jsonb)=coalesce(p_expected_email_cc,'[]'::jsonb)
    and (m.send_blocked_reason is null
      or starts_with(m.send_blocked_reason,'post_approval_race:')
      or starts_with(m.send_blocked_reason,'lint_'))
  for update;
  if not found then raise exception 'The draft changed before approval. Refresh before sending.'; end if;
  email_only := coalesce(saved.channel,'linkedin')='linkedin' and saved.draft_evidence->>'send_via'='email';
  if email_only then
    if saved.message_type<>'dm' or nullif(btrim(saved.recipient_email),'') is null then
      raise exception 'Refresh to check the email recipient and draft.';
    end if;
    send_text := saved.email_mirror_text;
    email_body := regexp_replace(coalesce(send_text,''),'^[[:space:]]*(\*\*)?Subject:[^\r\n]*(\r?\n|$)','', 'i');
    if nullif(btrim(email_body),'') is null then raise exception 'Email-only needs a saved email body.'; end if;
    if send_text !~* '^[[:space:]]*(\*\*)?Subject:' then
      send_text := 'Subject: ' || coalesce(nullif(saved.draft_evidence->>'email_subject',''),'Quick question') || E'\n\n' || send_text;
    end if;
  end if;
  update public.outreach_messages m set
    message_text=send_text, approved_at=approved_time,
    channel=case when email_only then 'email' else m.channel end,
    message_type=case when email_only then 'email' else m.message_type end,
    email_mirror_text=case when email_only then case when m.ai_model ~* 'rise_dm2_scan_delivery|rise_reply_softdecline' then send_text else null end else m.email_mirror_text end,
    draft_evidence=coalesce(m.draft_evidence,'{}'::jsonb)
      || case when email_only then jsonb_build_object('unsent_dm_text',p_text)
        || case when m.draft_evidence->'followup' is not null then jsonb_build_object('followup',
          (m.draft_evidence->'followup') || jsonb_build_object('channel','email','chat_id',null)) else '{}'::jsonb end
      else '{}'::jsonb end
      || jsonb_build_object('operator_copy_approval',jsonb_build_object(
        'source','inbox','text',send_text,'approved_at',approved_time,
        'email_mirror_text',case when email_only then case when m.ai_model ~* 'rise_dm2_scan_delivery|rise_reply_softdecline' then send_text else '' end else coalesce(m.email_mirror_text,'') end,
        'recipient_email',coalesce(m.recipient_email,''),
        'email_subject',coalesce(m.draft_evidence->>'email_subject',''),
        'email_cc',coalesce(m.draft_evidence->'email_cc','[]'::jsonb))),
    send_blocked_reason=null, send_blocked_at=null,
    unipile_chat_id=case when email_only then null else coalesce(nullif(p_chat_id,''),m.unipile_chat_id) end
  where m.id=p_message_id;
  get diagnostics touched = row_count;
  if touched<>1 then raise exception 'The draft changed before approval. Refresh before sending.'; end if;
end;
$function$;

revoke all on function public.approve_inbox_pipeline_draft(uuid,text,jsonb,text,text,text,text,jsonb,text) from public, anon;
grant execute on function public.approve_inbox_pipeline_draft(uuid,text,jsonb,text,text,text,text,jsonb,text) to authenticated, service_role;

-- Scheduled sends use a separate approval writer. Apply the same choice when scheduling
-- and stamp the exact email receipt when the existing scheduler releases it.
create or replace function public.inbox_scheduled_email_choice() returns trigger
language plpgsql security invoker set search_path = public, pg_temp
as $function$
declare
  email_text text;
begin
  if new.approved_at is not null and coalesce(new.channel,'linkedin')<>'email'
    and new.draft_evidence->>'send_via'='email' and new.draft_evidence->'scheduled_send' is null then
    raise exception 'Use Send email to approve this email-only draft.';
  end if;
  if new.draft_evidence->>'send_via'='email' and new.draft_evidence->'scheduled_send' is not null
    and old.approved_at is null and old.sent_at is null then
    if coalesce(old.channel,'linkedin')='linkedin' then
      email_text := old.email_mirror_text;
      if nullif(btrim(regexp_replace(coalesce(email_text,''),'^[[:space:]]*(\*\*)?Subject:[^\r\n]*(\r?\n|$)','', 'i')),'') is null
        or nullif(btrim(new.recipient_email),'') is null then
        raise exception 'Email-only needs a saved email body and recipient.';
      end if;
      if email_text !~* '^[[:space:]]*(\*\*)?Subject:' then
        email_text := 'Subject: ' || coalesce(nullif(new.draft_evidence->>'email_subject',''),'Quick question') || E'\n\n' || email_text;
      end if;
      new.channel := 'email'; new.message_text := email_text;
      new.email_mirror_text := case when old.ai_model ~* 'rise_dm2_scan_delivery|rise_reply_softdecline' then email_text else null end; new.unipile_chat_id := null;
      new.draft_evidence := new.draft_evidence || jsonb_build_object('unsent_dm_text',old.message_text)
        || case when new.draft_evidence->'followup' is not null then jsonb_build_object('followup',
          (new.draft_evidence->'followup') || jsonb_build_object('channel','email','chat_id',null)) else '{}'::jsonb end;
    end if;
    if new.channel='email' and new.approved_at is not null then
      new.draft_evidence := new.draft_evidence || jsonb_build_object('operator_copy_approval',jsonb_build_object(
        'source','inbox','text',new.message_text,'approved_at',new.approved_at,'email_mirror_text',coalesce(new.email_mirror_text,''),
        'recipient_email',coalesce(new.recipient_email,''),'email_subject',coalesce(new.draft_evidence->>'email_subject',''),
        'email_cc',coalesce(new.draft_evidence->'email_cc','[]'::jsonb)));
    end if;
  end if;
  return new;
end;
$function$;
create or replace trigger inbox_scheduled_email_choice
  before update on public.outreach_messages for each row execute function public.inbox_scheduled_email_choice();
revoke all on function public.inbox_scheduled_email_choice() from public, anon;

notify pgrst, 'reload schema';
