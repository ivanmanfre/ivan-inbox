-- Compare the channel and email shown when the schedule sheet opened.
drop function if exists public.schedule_inbox_dm(uuid,uuid[],text[],timestamptz,text,text);
create or replace function public.schedule_inbox_dm(p_prospect_id uuid,p_message_ids uuid[],p_texts text[],p_at timestamptz,p_timezone text,p_chat_id text default null,p_expected_delivery jsonb default null)
returns uuid[] language plpgsql security invoker set search_path=public,pg_temp as $$
declare ids uuid[]:=coalesce(p_message_ids,'{}'); m outreach_messages%rowtype; guard jsonb; baseline jsonb; g uuid:=gen_random_uuid(); i integer; meta jsonb; expected jsonb;
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
  if p_expected_delivery is not null or m.draft_evidence->>'send_via' is not null then
   select x into expected from jsonb_array_elements(coalesce(p_expected_delivery,'[]'::jsonb)) x where x->>'id'=m.id::text;
   if expected is null or (expected->>'send_via') is distinct from (m.draft_evidence->>'send_via')
     or (expected->>'recipient_email') is distinct from m.recipient_email
     or (expected->>'email_mirror_text') is distinct from m.email_mirror_text
     or (expected->>'email_subject') is distinct from (m.draft_evidence->>'email_subject')
     or coalesce(expected->'email_cc','[]'::jsonb) is distinct from coalesce(m.draft_evidence->'email_cc','[]'::jsonb) then
    raise exception 'The send channel or email changed. Refresh before scheduling.';
   end if;
  end if;
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


revoke all on function public.schedule_inbox_dm(uuid,uuid[],text[],timestamptz,text,text,jsonb) from public, anon;
grant execute on function public.schedule_inbox_dm(uuid,uuid[],text[],timestamptz,text,text,jsonb) to authenticated,service_role;
notify pgrst, 'reload schema';
