-- Private reply supervision; the sender remains the only owner of outbound work.
begin;
create or replace function public.assistant_reply_queue_settings(p_at timestamptz default now())
returns table(status text,cap int,pause_until timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
with cfg as (
  select (select value from public.integration_config where key='swishdm_outreach_enabled')='true'
     and (select value from public.integration_config where key='swishdm_dm_send_enabled')='true' as enabled,
    (select case when value ~ '^[0-9]{1,5}$' then value::int end from public.integration_config where key='swishdm_dm_daily_cap') as cap,
    (select case when nullif(value,'') is null then null when pg_input_is_valid(value,'timestamptz') then value::timestamptz
       else 'infinity'::timestamptz end from public.integration_config where key='swishdm_dm_pause_until') as pause_until
)
select case when enabled is null or cap is null or pause_until='infinity' then 'unavailable'
            when not enabled or cap=0 then 'disabled'
            when pause_until>p_at then 'paused' else 'checked' end,cap,pause_until from cfg
$$;
revoke all on function public.assistant_reply_queue_settings(timestamptz) from public,anon,authenticated;
grant execute on function public.assistant_reply_queue_settings(timestamptz) to service_role;

create or replace function public.assistant_reply_watch_cases(p_at timestamptz default now())
returns table(seat text,prospect_id uuid,person text,inbound_id uuid,kind text,since timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
with inbound as (
  select m.*,coalesce(m.sent_at,m.created_at) as at,
    coalesce(m.channel,case when m.message_type like 'email%' then 'email' else 'linkedin' end) as transport,
    coalesce(m.draft_evidence#>>'{email,thread_id}',m.unipile_chat_id) as conversation
  from public.outreach_messages m where m.direction='inbound' and m.created_at>=p_at-interval '15 days'
    and coalesce(m.sent_at,m.created_at) between p_at-interval '14 days' and p_at
), latest as (
  select distinct on (prospect_id,transport,conversation) i.* from inbound i
  order by prospect_id,transport,conversation,at desc,created_at desc,id desc
), active as (
  select i.*,p.name,p.stage,p.needs_manual_reply,p.enrichment_data->'inbox_referral' as referral,
    case when c.client_id='rise' then 'risedtc' else coalesce(c.client_id,'ivan') end as seat
  from latest i join public.outreach_prospects p on p.id=i.prospect_id
  join public.outreach_campaigns c on c.id=p.campaign_id
  where coalesce(c.client_id,'ivan') in ('ivan','risedtc','rise','arch','swishdm','anna','leah')
    and not coalesce(p.blacklisted,false) and p.call_booked_at is null and p.skip_state is null
    and nullif(p.skip_reason,'') is null and (p.next_touch_after is null or p.next_touch_after<=p_at)
    and (p.solved_at is null or p.solved_at<i.at)
    and p.stage not in ('archived','skipped','disqualified','unsubscribed','blacklisted','call_booked','engaged')
)
select a.seat,a.prospect_id,a.name,a.id,'missing_reply_draft'::text,a.at from active a
where a.at<=p_at-interval '48 hours' and not coalesce(a.is_reaction,false) and a.transport in ('email','linkedin')
  and ((a.transport='email' and a.reply_intent is null and a.needs_manual_reply) or a.reply_intent in ('info_ask','price_ask','booking','referral') or
    (a.needs_manual_reply and a.referral->>'status'='verified' and a.referral->>'input_message_id'=a.id::text))
  and not coalesce(a.referral->>'input_message_id'=a.id::text and
    (a.referral->>'dismissed_at' is not null or a.referral->>'lead_prospect_id' is not null or
     nullif(trim(a.referral->>'acknowledgement'),'') is not null or nullif(trim(a.referral->>'draft'),'') is not null),false)
  and nullif(trim(a.message_text),'') is not null
  and not (a.seat='risedtc' and exists(select from public.assistant_scan_watch w where w.inbound_id=a.id))
  and not exists (
    select from public.outreach_messages o
    cross join lateral (select array_remove(array[
      o.replies_to_message_id::text, o.draft_evidence->>'replies_to_inbound', o.draft_evidence->>'inbound_id',
      o.draft_evidence->>'target_inbound_id', o.draft_evidence->>'source_message_id',
      o.draft_evidence#>>'{instantly_reply,inbound_message_id}', o.draft_evidence#>>'{instantly_reply,reply_to_uuid}'
    ], null) refs, coalesce(o.draft_evidence#>>'{email,thread_id}',o.unipile_chat_id) as conversation) ref
    where o.prospect_id=a.prospect_id and o.direction='outbound' and o.message_type is distinct from 'connection_note'
      and (ref.refs && array[a.id::text,a.unipile_message_id,a.draft_evidence#>>'{email,instantly_email_id}'] or
        (cardinality(ref.refs)=0 and coalesce(o.sent_at,o.created_at)>=a.at
         and coalesce(o.channel,case when o.message_type like 'email%' then 'email' else 'linkedin' end)=a.transport
         and (ref.conversation=a.conversation or
           ((ref.conversation is null or a.conversation is null) and not exists (
             select from public.outreach_messages h where h.prospect_id=a.prospect_id
               and coalesce(h.channel,case when h.message_type like 'email%' then 'email' else 'linkedin' end)=a.transport
               and coalesce(h.draft_evidence#>>'{email,thread_id}',h.unipile_chat_id) is not null
               and coalesce(h.draft_evidence#>>'{email,thread_id}',h.unipile_chat_id) is distinct from
                   coalesce(a.conversation,ref.conversation))))))
      and (o.sent_at is not null or o.unipile_message_id is not null or
        (o.discard_mode is distinct from 'reply_myself' and (
          o.discard_mode in ('stop','answered_by_send') or o.snoozed_until>p_at or
          (o.send_blocked_at is null and o.send_blocked_reason is null) or
          o.send_blocked_reason in ('scheduled_in_inbox','owner_confirmation','reply_retry_pending','awaiting_client_review','discarded_in_inbox')
          or o.send_blocked_reason like 'lint\_%'
        ))))
union all
select a.seat,a.prospect_id,a.name,a.id,'overdue_reaction_queue'::text,q.due_at
from active a cross join public.assistant_reply_queue_settings(p_at) s
join lateral (
  select case when pg_input_is_valid(o.draft_evidence#>>'{dm_queue,due_at}','timestamptz')
    then (o.draft_evidence#>>'{dm_queue,due_at}')::timestamptz end as due_at
  from public.outreach_messages o where o.prospect_id=a.prospect_id and o.direction='outbound' and o.message_type='dm'
    and coalesce(o.channel,'linkedin')='linkedin' and o.sequence_step=1 and o.approved_at is not null
    and o.sent_at is null and o.unipile_message_id is null and o.send_blocked_reason is null and o.send_blocked_at is null
    and (o.snoozed_until is null or o.snoozed_until<=p_at) and o.draft_evidence->>'lane'='swishdm_first_list'
    and o.draft_evidence#>>'{dm_queue,state}'='queued' and o.draft_evidence#>>'{dm_queue,reason}'='reaction_fast_path'
    and not (o.draft_evidence ?| array['stopped','send_deferred'])
  order by o.approved_at desc,o.id desc limit 1
) q on true
where a.seat='swishdm' and a.stage='swishdm_connected' and a.is_reaction and a.transport='linkedin'
  and not coalesce(a.needs_manual_reply,false) and q.due_at>=a.at and q.due_at<=p_at-interval '4 hours'
  and s.status='checked'
  and not exists(select from public.outreach_messages o where o.prospect_id=a.prospect_id and o.direction='outbound'
        and o.message_type is distinct from 'connection_note' and coalesce(o.channel,'linkedin')='linkedin'
        and o.sent_at>=a.at and o.unipile_chat_id is not distinct from a.unipile_chat_id)
  -- Sum overlapping Sun-Fri London windows, cutting off each day at the cap-th send.
  and (select sum(greatest(interval '0 seconds',least(p_at,win.closes,coalesce(cap_at.sent_at,win.closes))
                    - greatest(q.due_at,win.opens,coalesce(s.pause_until,win.opens))))
       from generate_series((q.due_at at time zone 'Europe/London')::date::timestamp,
                            (p_at at time zone 'Europe/London')::date::timestamp,interval '1 day') dates(d)
       cross join lateral (select (d+interval '9 hours') at time zone 'Europe/London' as opens,
                                  (d+interval '17 hours') at time zone 'Europe/London' as closes) win
       left join lateral (select m.sent_at from public.outreach_messages m
         join public.outreach_prospects p on p.id=m.prospect_id join public.outreach_campaigns c on c.id=p.campaign_id
         where c.client_id='swishdm' and m.direction='outbound' and coalesce(m.channel,'linkedin')='linkedin'
           and m.message_type in ('dm','manual_reply','reply') and m.sent_at>=(d at time zone 'Europe/London')
           and m.sent_at<=least(win.closes,p_at) order by m.sent_at offset greatest(0,s.cap-1) limit 1) cap_at on true
       where extract(isodow from d)<>6)>=interval '4 hours'
$$;
revoke all on function public.assistant_reply_watch_cases(timestamptz) from public,anon,authenticated;
grant execute on function public.assistant_reply_watch_cases(timestamptz) to service_role;

create table if not exists public.assistant_reply_watch (
  operator_id uuid not null,inbound_id uuid not null,kind text not null,checked_at timestamptz not null,
  cleared_at timestamptz,first_chat_turn uuid,primary key(operator_id,inbound_id,kind)
);
alter table public.assistant_reply_watch enable row level security;
revoke all on public.assistant_reply_watch from public,anon,authenticated;
grant select,insert,update on public.assistant_reply_watch to service_role;
insert into public.integration_config(key,value) values('assistant_reply_watch_mode','shadow') on conflict(key) do nothing;

create or replace function public.assistant_reply_watch_sweep(p_operator uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  mode text; thread uuid; stamp timestamptz; r record; eligible int:=0; posted int:=0;
  previous uuid; turn_id uuid; rows_text text[]:='{}'; sources jsonb:='[]'::jsonb;
begin
  select value into mode from public.integration_config where key='assistant_reply_watch_mode';
  if mode is null or mode not in ('shadow','chat') then return jsonb_build_object('mode','off'); end if;
  perform pg_advisory_xact_lock(hashtextextended('assistant_reply_watch:'||p_operator::text,0));
  select id into strict thread from public.inbox_threads where user_id=p_operator and kind='bot';
  stamp:=clock_timestamp();
  turn_id:=gen_random_uuid();
  insert into public.assistant_reply_watch(operator_id,inbound_id,kind,checked_at)
    select p_operator,c.inbound_id,c.kind,'-infinity'::timestamptz from public.assistant_reply_watch_cases(stamp) c
    order by c.inbound_id,c.kind on conflict(operator_id,inbound_id,kind) do nothing;
  perform 1 from public.assistant_reply_watch where operator_id=p_operator order by inbound_id,kind for update;
  stamp:=clock_timestamp();
  for r in select c.*,w.first_chat_turn from public.assistant_reply_watch_cases(stamp) c join public.assistant_reply_watch w
       on w.operator_id=p_operator and w.inbound_id=c.inbound_id and w.kind=c.kind order by c.since,c.inbound_id,c.kind loop
    previous:=r.first_chat_turn;
    eligible:=eligible+1;
    update public.assistant_reply_watch set checked_at=stamp,cleared_at=null
      where operator_id=p_operator and inbound_id=r.inbound_id and kind=r.kind;
    if mode='chat' and previous is null and cardinality(rows_text)<4 then
      rows_text:=array_append(rows_text,format('%s (%s) %s%s%s',
        left(regexp_replace(coalesce(r.person,'Contact'),'[^[:alnum:] .''’-]','','g'),80),r.seat,
        case r.kind when 'missing_reply_draft' then 'asked for a reply at least two days ago. I found no sent reply or active draft for that request. Open the conversation to review it.'
        else 'has an approved opener still queued after four hours of available sending time. Check the sender before retrying.' end,
        E'\n','https://ivanmanfre.github.io/ivan-inbox/#exp/d/dms?seat='||r.seat||'&thread='||r.prospect_id));
      sources:=sources||jsonb_build_array(jsonb_build_object('kind','reply_watch','path',r.inbound_id,'at',stamp));
      update public.assistant_reply_watch set first_chat_turn=turn_id where operator_id=p_operator and inbound_id=r.inbound_id and kind=r.kind;
    end if;
  end loop;
  update public.assistant_reply_watch set cleared_at=stamp where operator_id=p_operator and cleared_at is null and checked_at<stamp;
  if cardinality(rows_text)>0 then
    insert into public.inbox_turns(id,thread_id,user_id,prompt,answer,status,origin,started_at,finished_at,sources)
      values(turn_id,thread,p_operator,'',array_to_string(rows_text,E'\n\n'),'done','bot',stamp,stamp,sources);
    update public.inbox_threads set last_turn_at=greatest(last_turn_at,stamp),updated_at=stamp where id=thread and user_id=p_operator;
    posted:=1;
  end if;
  insert into public.integration_config(key,value,updated_at) values('assistant_reply_watch_last',
      jsonb_build_object('at',stamp,'mode',mode,'eligible',eligible,'posted',posted)::text,stamp)
    on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
  return jsonb_build_object('mode',mode,'eligible',eligible,'posted',posted);
end $$;
revoke all on function public.assistant_reply_watch_sweep(uuid) from public,anon,authenticated;
grant execute on function public.assistant_reply_watch_sweep(uuid) to service_role;
commit;
