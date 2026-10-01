-- Scheduling keeps approval NULL until due. The existing sender remains the only transport.
create or replace function public.inbox_schedule_snapshot(p_prospect_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'inbound',(select id from outreach_messages where prospect_id=p.id and direction='inbound' order by coalesce(sent_at,created_at) desc,id desc limit 1),
  'outbound',(select id from outreach_messages where prospect_id=p.id and direction='outbound' and (sent_at is not null or approved_at is not null) order by coalesce(sent_at,approved_at,created_at) desc,id desc limit 1),
  'prospect',jsonb_build_array(p.stage,p.blacklisted,p.skip_reason,p.skip_state),
  'owners',coalesce((select jsonb_agg(jsonb_build_array(t.id,t.revision,t.owner,t.state,t.pause_reason) order by t.id) from outreach_agent_threads t
    where t.prospect_id=p.id or t.person_key=case when nullif(trim(p.linkedin_profile_id),'') is not null then 'linkedin_profile_id:'||trim(p.linkedin_profile_id)
      when lower(p.linkedin_url)~'^https://(www\.)?linkedin\.com/in/' then 'linkedin_url:'||regexp_replace(split_part(lower(trim(p.linkedin_url)),'?',1),'/+$','') end),'[]'::jsonb))
 from outreach_prospects p where p.id=p_prospect_id;
$$;

create or replace function public.schedule_inbox_dm(p_prospect_id uuid,p_message_ids uuid[],p_texts text[],p_at timestamptz,p_timezone text,p_chat_id text default null)
returns uuid[] language plpgsql security invoker set search_path=public,pg_temp as $$
declare ids uuid[]:=coalesce(p_message_ids,'{}'); m outreach_messages%rowtype; guard jsonb; baseline jsonb; g uuid:=gen_random_uuid(); i integer; meta jsonb;
begin
 if p_at is null or p_at<=now() then raise exception 'Choose a future send time.'; end if;
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Choose a valid timezone.'; end if;
 if coalesce(cardinality(p_texts),0)=0 or cardinality(p_texts)>2 or (cardinality(ids)>0 and cardinality(ids)<>cardinality(p_texts))
   or (cardinality(ids)=0 and cardinality(p_texts)<>1) then raise exception 'The scheduled message changed. Refresh.'; end if;
 if exists(select 1 from unnest(p_texts) s where nullif(trim(s),'') is null or length(s)>8000)
   then raise exception 'The reply is empty or too long.'; end if;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'The draft changed. Refresh.'; end if;
 perform 1 from outreach_prospects where id=p_prospect_id for update;
 if not found then raise exception 'The conversation could not be loaded.'; end if;
 if exists(select 1 from outreach_prospects where id=p_prospect_id and (blacklisted is true or stage in ('archived','declined','unsubscribed','closed','skipped','disqualified','blacklisted') or skip_state in ('manual_skip','opted_out','stopped')))
   then raise exception 'This conversation is closed.'; end if;
 if exists(select 1 from outreach_messages where prospect_id=p_prospect_id and direction='outbound' and sent_at is null
    and (approved_at is not null or (send_blocked_reason='scheduled_in_inbox' and not(id=any(ids)))))
   then raise exception 'A message is already scheduled or in the send queue.'; end if;
 -- Validate every leg before the ownership write. Existing schedule groups must be rescheduled whole.
 for m in select * from outreach_messages where id=any(ids) order by id for update loop
  if m.prospect_id<>p_prospect_id or m.direction<>'outbound' or m.sent_at is not null or m.approved_at is not null or m.unipile_message_id is not null
    or (m.send_blocked_reason is not null and m.send_blocked_reason<>'scheduled_in_inbox' and m.send_blocked_reason not like 'post_approval_race:%' and left(m.send_blocked_reason,5)<>'lint_')
    then raise exception 'The draft changed or was already approved. Refresh.'; end if;
  if m.send_blocked_reason in ('scheduled_in_inbox','post_approval_race:scheduled_thread_changed') and not(ids @> array(select jsonb_array_elements_text(m.draft_evidence->'scheduled_send'->'ids')::uuid))
    then raise exception 'Reschedule both message legs together.'; end if;
 end loop;
 if (select count(*) from outreach_messages where id=any(ids))<>cardinality(ids) then raise exception 'The draft changed. Refresh.'; end if;
 guard:=conversation_agent_before_manual_send(p_prospect_id);
 if coalesce((guard->>'ok')::boolean,false) is not true or coalesce((guard->>'allow_send')::boolean,false) is not true or coalesce((guard->>'in_flight')::boolean,false)
   then raise exception 'Conversation ownership could not be confirmed: %',coalesce(guard->>'reason','unknown'); end if;
 baseline:=inbox_schedule_snapshot(p_prospect_id);
 if cardinality(ids)=0 then
   insert into outreach_messages(prospect_id,direction,message_type,channel,message_text,ai_model,sent_at,approved_at,send_blocked_reason,send_blocked_at,unipile_chat_id)
   values(p_prospect_id,'outbound','manual_reply','linkedin',p_texts[1],'inbox_scheduled_manual_v1',null,null,'scheduled_in_inbox',now(),p_chat_id) returning id into g;
   ids:=array[g];
   -- A handwritten scheduled reply replaces pending drafts, as immediate compose does.
   update outreach_messages set send_blocked_reason='discarded_in_inbox',send_blocked_at=now()
    where prospect_id=p_prospect_id and id<>g and direction='outbound' and sent_at is null and approved_at is null
    and (send_blocked_reason is null or send_blocked_reason like 'post_approval_race:%' or left(send_blocked_reason,5)='lint_');
 end if;
 meta:=jsonb_build_object('at',p_at,'timezone',p_timezone,'ids',to_jsonb(ids),'group',g,'baseline',baseline,'state','scheduled');
 for i in 1..cardinality(ids) loop
  update outreach_messages set message_text=p_texts[i],approved_at=null,send_blocked_reason='scheduled_in_inbox',send_blocked_at=now(),
   unipile_chat_id=case when coalesce(channel,'linkedin')='email' then unipile_chat_id else coalesce(nullif(p_chat_id,''),unipile_chat_id) end,
   message_type='manual_reply',
   draft_evidence=(coalesce(draft_evidence,'{}')-'conversation_agent_manual_revision')||jsonb_build_object('scheduled_send',meta)
     ||case when guard->>'revision' is not null then jsonb_build_object('conversation_agent_manual_revision',(guard->>'revision')::bigint) else '{}'::jsonb end
  where id=ids[i];
 end loop;
 return ids;
end;
$$;

create or replace function public.cancel_scheduled_inbox_dm(p_message_id uuid) returns uuid[]
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m outreach_messages%rowtype; ids uuid[]; n integer; pid uuid;
begin
 select prospect_id into pid from outreach_messages where id=p_message_id;
 perform 1 from outreach_prospects where id=pid for update;
 select * into m from outreach_messages where id=p_message_id for update;
 if not found or m.sent_at is not null or m.approved_at is not null or coalesce(m.send_blocked_reason,'') not in ('scheduled_in_inbox','post_approval_race:scheduled_thread_changed')
   then raise exception 'The message changed or is already in the send queue.'; end if;
 ids:=array(select jsonb_array_elements_text(m.draft_evidence->'scheduled_send'->'ids')::uuid);
 perform 1 from outreach_messages where id=any(ids) order by id for update;
 if cardinality(ids)=0 or exists(select 1 from outreach_messages where id=any(ids) and (sent_at is not null or approved_at is not null or coalesce(send_blocked_reason,'') not in ('scheduled_in_inbox','post_approval_race:scheduled_thread_changed')))
   then raise exception 'The scheduled message changed. Refresh.'; end if;
 update outreach_messages set send_blocked_reason='scheduled_send_cancelled',send_blocked_at=now(),
   draft_evidence=jsonb_set(draft_evidence,'{scheduled_send,state}','"cancelled"') where id=any(ids);
 get diagnostics n=row_count;
 if n<>cardinality(ids) then raise exception 'The scheduled message changed. Refresh.'; end if;
 return ids;
end;
$$;

create or replace function public.release_scheduled_inbox_dms() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare candidate record; m outreach_messages%rowtype; ids uuid[]; valid boolean; n integer; released integer:=0;
begin
 for candidate in select distinct prospect_id,draft_evidence->'scheduled_send'->>'group' as grp from outreach_messages
  where send_blocked_reason='scheduled_in_inbox' and approved_at is null and sent_at is null and (draft_evidence->'scheduled_send'->>'at')::timestamptz<=now() loop
  perform 1 from outreach_prospects where id=candidate.prospect_id for update;
  perform 1 from outreach_agent_threads where prospect_id=candidate.prospect_id order by id for update;
  select * into m from outreach_messages where prospect_id=candidate.prospect_id and draft_evidence->'scheduled_send'->>'group'=candidate.grp
    and send_blocked_reason='scheduled_in_inbox' and approved_at is null and sent_at is null order by id limit 1 for update;
  if not found then continue; end if;
  ids:=array(select jsonb_array_elements_text(m.draft_evidence->'scheduled_send'->'ids')::uuid);
  perform 1 from outreach_messages where id=any(ids) order by id for update;
  valid:=cardinality(ids)>0 and (select count(*) from outreach_messages where id=any(ids) and prospect_id=candidate.prospect_id and direction='outbound'
    and send_blocked_reason='scheduled_in_inbox' and approved_at is null and sent_at is null and unipile_message_id is null
    and draft_evidence->'scheduled_send'->>'group'=candidate.grp)=cardinality(ids)
    and m.draft_evidence->'scheduled_send'->'baseline'=inbox_schedule_snapshot(candidate.prospect_id);
  if valid then
   update outreach_messages set approved_at=now(),send_blocked_reason=null,send_blocked_at=null,
     draft_evidence=jsonb_set(draft_evidence,'{scheduled_send,state}','"released"') where id=any(ids);
   get diagnostics n=row_count; released:=released+n;
  else
   update outreach_messages set send_blocked_reason='post_approval_race:scheduled_thread_changed',send_blocked_at=now(),
     draft_evidence=jsonb_set(draft_evidence,'{scheduled_send,state}','"review"')
     where id=any(ids) and send_blocked_reason='scheduled_in_inbox' and sent_at is null and approved_at is null;
  end if;
 end loop;
 return released;
end;
$$;
revoke all on function public.inbox_schedule_snapshot(uuid) from public;
revoke all on function public.schedule_inbox_dm(uuid,uuid[],text[],timestamptz,text,text) from public;
revoke all on function public.cancel_scheduled_inbox_dm(uuid) from public;
revoke all on function public.release_scheduled_inbox_dms() from public;
grant execute on function public.inbox_schedule_snapshot(uuid),public.schedule_inbox_dm(uuid,uuid[],text[],timestamptz,text,text),public.cancel_scheduled_inbox_dm(uuid) to authenticated,service_role;
grant execute on function public.release_scheduled_inbox_dms() to service_role;
create index if not exists outreach_messages_scheduled_inbox_idx on public.outreach_messages(prospect_id) where send_blocked_reason='scheduled_in_inbox' and sent_at is null and approved_at is null;
-- CRON INSTALL
select cron.schedule('inbox-scheduled-dm-release','* * * * *','select public.release_scheduled_inbox_dms()');
