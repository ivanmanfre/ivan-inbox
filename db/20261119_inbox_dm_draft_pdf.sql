begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inbox-dm-draft-files', 'inbox-dm-draft-files', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create or replace function public.set_inbox_dm_draft_file(p_id uuid, p_expected_file_id text, p_file jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare result jsonb;
begin
  update public.outreach_messages m
  set draft_evidence = case when p_file is null then m.draft_evidence - 'dm_attachment'
    else jsonb_set(m.draft_evidence, '{dm_attachment}', p_file) end
  where m.id = p_id and m.draft_evidence#>>'{dm_attachment,id}' is not distinct from p_expected_file_id
    and m.approved_at is null and m.sent_at is null and m.send_blocked_at is null and m.unipile_message_id is null
    and m.direction = 'outbound' and m.channel = 'linkedin' and m.message_type in ('dm','manual_reply')
    and m.ai_model = 'inbox_on_demand_reply' and m.draft_evidence->>'v' = 'inbox_on_demand_reply_v1'
    and m.unipile_chat_id is not null
    and exists (select 1 from public.inbox_messages_v v where v.id = m.id and v.client_id = 'ivan')
  returning draft_evidence into result;
  return result;
end;
$$;
revoke all on function public.set_inbox_dm_draft_file(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.set_inbox_dm_draft_file(uuid,text,jsonb) to service_role;

-- One multipart transport attempt per attached object, including after an ambiguous timeout.
create or replace function public.claim_inbox_dm_pdf_transport(p_id uuid, p_claimed_at timestamptz, p_file_id text, p_account_id text, p_chat_id text, p_text text)
returns boolean language sql security invoker set search_path = public, pg_temp as $$
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
      and btrim(m.message_text, E' \t\r\n') = p_text
      and m.draft_evidence->>'dm_attachment_transport_id' is distinct from p_file_id
      and exists (select 1 from public.inbox_messages_v v where v.id = m.id and v.client_id = 'ivan')
      and exists (select 1 from public.outreach_agent_accounts a where a.client_id = 'ivan' and a.provider_account_id = p_account_id)
    returning m.id
  )
  select exists (select 1 from claimed);
$$;
revoke all on function public.claim_inbox_dm_pdf_transport(uuid,timestamptz,text,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_inbox_dm_pdf_transport(uuid,timestamptz,text,text,text,text) to service_role;

-- All approval surfaces must preserve and review the attachment before queueing.
create or replace function public.check_inbox_dm_draft_file_approval()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.draft_evidence ? 'dm_attachment' and new.approved_at is not null
    and new.draft_evidence->'dm_attachment' is distinct from old.draft_evidence->'dm_attachment' then
    raise exception 'An approved attachment is read-only.';
  end if;
  if old.approved_at is null and new.approved_at is not null and new.draft_evidence ? 'dm_attachment'
    and current_setting('inbox.reviewed_dm_pdf', true) is distinct from new.id::text || ':' || coalesce(new.draft_evidence#>>'{dm_attachment,id}', '') then
    raise exception 'Review the attached PDF in the draft before approving.';
  end if;
  return new;
end;
$$;
drop trigger if exists check_inbox_dm_draft_file_approval on public.outreach_messages;
create trigger check_inbox_dm_draft_file_approval before update of approved_at, draft_evidence on public.outreach_messages
for each row execute function public.check_inbox_dm_draft_file_approval();

create or replace function public.approve_inbox_on_demand_reply_with_file(p_message_id uuid, p_text text, p_chat_id text, p_file_id text)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare m public.outreach_messages%rowtype;
begin
  select * into m from public.outreach_messages where id = p_message_id for update;
  if not found or nullif(p_file_id,'') is null or m.draft_evidence#>>'{dm_attachment,id}' is distinct from p_file_id then
    raise exception 'The attached PDF changed. Refresh before sending.';
  end if;
  if p_chat_id is null or m.unipile_chat_id is distinct from p_chat_id
    or m.channel is distinct from 'linkedin' or p_text ~ '(^|[[:cntrl:]])[[:blank:]]*-{3,}[[:blank:]]*([[:cntrl:]]|$)'
    or nullif(trim(m.email_mirror_text),'') is not null or m.draft_evidence->>'send_via' in ('email','both')
    or not exists (select 1 from public.inbox_messages_v v where v.id = m.id and v.client_id = 'ivan' and v.prospect_stage <> 'engaged') then
    raise exception 'PDFs can be sent with one message to the existing LinkedIn chat.';
  end if;
  perform set_config('inbox.reviewed_dm_pdf', m.id::text || ':' || p_file_id, true);
  perform public.approve_inbox_on_demand_reply(p_message_id, p_text, p_chat_id);
  update public.outreach_messages
  set draft_evidence = jsonb_set(draft_evidence, '{operator_copy_approval}',
    draft_evidence->'operator_copy_approval' || jsonb_build_object('attachment_id', p_file_id, 'attachment_chat', p_chat_id))
  where id = m.id;
  perform set_config('inbox.reviewed_dm_pdf', '', true);
end;
$$;
revoke all on function public.approve_inbox_on_demand_reply_with_file(uuid,text,text,text) from public, anon;
grant execute on function public.approve_inbox_on_demand_reply_with_file(uuid,text,text,text) to authenticated, service_role;
commit;
