-- Private, durable guard around calendar-provider writes. Only the owner-authenticated
-- edge endpoint uses this table. A pending/uncertain write is never automatically retried.
create table if not exists public.inbox_calendar_bookings (
  request_id uuid primary key,
  prospect_id uuid not null references public.outreach_prospects(id),
  campaign_id uuid not null references public.outreach_campaigns(id),
  client_id text not null check (client_id in ('risedtc','arch')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  email text not null,
  timezone text not null,
  status text not null default 'pending' check (status in ('pending','uncertain','confirmed','failed')),
  calendar_event_id text,
  meeting_id text,
  booked_at timestamptz,
  handoff_at timestamptz,
  pending_ops_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at = start_at + interval '30 minutes'),
  check (status <> 'confirmed' or nullif(calendar_event_id,'') is not null)
);
create unique index if not exists inbox_calendar_one_active_booking
  on public.inbox_calendar_bookings(prospect_id) where status <> 'failed';
alter table public.inbox_calendar_bookings enable row level security;
revoke all on public.inbox_calendar_bookings from public,anon,authenticated;
grant all on public.inbox_calendar_bookings to service_role;

create or replace function public.inbox_calendar_claim(p_prospect uuid,p_client text,p_request uuid,p_start timestamptz,p_email text,p_timezone text)
returns boolean language plpgsql set search_path=public as $$
declare p public.outreach_prospects; cid text; n integer;
begin
  select * into p from outreach_prospects where id=p_prospect for update;
  if not found or p.call_booked_at is not null or coalesce(p.blacklisted,false)
    or p.stage in ('archived','skipped','disqualified','unsubscribed','blacklisted') or p.skip_reason is not null then return false; end if;
  select client_id into cid from outreach_campaigns where id=p.campaign_id;
  if cid is distinct from p_client or cid not in ('risedtc','arch') then return false; end if;
  if p_start <= now()+interval '1 hour' or p_start > now()+interval '31 days'
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or not exists(select 1 from pg_timezone_names where name=p_timezone) then return false; end if;
  insert into inbox_calendar_bookings(request_id,prospect_id,campaign_id,client_id,start_at,end_at,email,timezone)
  values(p_request,p_prospect,p.campaign_id,p_client,p_start,p_start+interval '30 minutes',p_email,p_timezone)
  on conflict do nothing;
  get diagnostics n=row_count;
  return n=1;
end $$;
revoke all on function public.inbox_calendar_claim(uuid,text,uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.inbox_calendar_claim(uuid,text,uuid,timestamptz,text,text) to service_role;

-- Save the provider receipt and a private task together. This task has no Slack
-- destination and remains useful even while the CRM search index catches up.
create or replace function public.inbox_calendar_confirm(p_request uuid,p_event text)
returns void language plpgsql set search_path=public as $$
declare b public.inbox_calendar_bookings; p public.outreach_prospects; task_id uuid;
begin
  select * into b from inbox_calendar_bookings where request_id=p_request for update;
  if not found or b.status <> 'pending' or nullif(btrim(p_event),'') is null then raise exception 'A pending booking and calendar receipt are required'; end if;
  select * into p from outreach_prospects where id=b.prospect_id;
  task_id := gen_random_uuid();
  insert into ops_drafts(id,client_id,kind,slack_channel,body,context,approved_at,sent_at)
  values(task_id,case when b.client_id='risedtc' then 'rise' else b.client_id end,'task',null,
    'Calendar invite confirmed with '||p.name||' for '||to_char(b.start_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC. Prepare the pre-call brief. CRM booking details are pending; open Calendar in the conversation and refresh to finish the handoff.',
    jsonb_build_object('prospect_id',p.id,'prospect_name',p.name,'company',p.company,'when_iso',b.start_at,
      'calendar_event_id',p_event,'request_id',p_request,'source','inbox_calendar_pending_crm'),null,null);
  update inbox_calendar_bookings set status='confirmed',calendar_event_id=p_event,pending_ops_id=task_id,updated_at=now() where request_id=p_request;
end $$;
revoke all on function public.inbox_calendar_confirm(uuid,text) from public,anon,authenticated;
grant execute on function public.inbox_calendar_confirm(uuid,text) to service_role;

-- The scheduler returns a calendar event, but only CRM hs_createdate is a valid
-- call_booked_at stamp. Using now() would make the existing tracker infer a second booking.
create or replace function public.inbox_calendar_finish(p_request uuid,p_meeting text,p_booked timestamptz)
returns void language plpgsql set search_path=public as $$
declare b public.inbox_calendar_bookings; p public.outreach_prospects; ops_client text; body_text text;
begin
  select * into b from inbox_calendar_bookings where request_id=p_request for update;
  if not found or b.status <> 'confirmed' or nullif(b.calendar_event_id,'') is null then raise exception 'A confirmed invite is required'; end if;
  if p_meeting !~ '^[0-9]+$' or p_booked is null then raise exception 'A real CRM meeting and creation time are required'; end if;
  if b.meeting_id is not null and b.meeting_id <> p_meeting then raise exception 'Meeting identity changed'; end if;
  select * into p from outreach_prospects where id=b.prospect_id for update;
  if p.campaign_id is distinct from b.campaign_id or not exists(select 1 from outreach_campaigns where id=p.campaign_id and client_id=b.client_id) then raise exception 'Conversation ownership changed'; end if;
  update outreach_prospects set call_booked_at=p_booked where id=b.prospect_id and call_booked_at is null;
  if b.handoff_at is null then
    ops_client := case when b.client_id='risedtc' then 'rise' else b.client_id end;
    body_text := 'Call booked with '||p.name||coalesce(' ('||nullif(p.company,'')||')','')||' for '||to_char(b.start_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC. Calendar invite confirmed. Prepare the pre-call brief.';
    if b.client_id='arch' and b.pending_ops_id is not null then
      update ops_drafts set body=body_text, context=context||jsonb_build_object('meeting_id',p_meeting,'source','inbox_calendar')
        where id=b.pending_ops_id and approved_at is null and sent_at is null and send_blocked_reason is null;
    else
    insert into ops_drafts(client_id,kind,slack_channel,body,context,approved_at,sent_at)
    values(ops_client,case when b.client_id='risedtc' then 'booking' else 'task' end,
      case when b.client_id='risedtc' then 'C0BJ72F58BY' else null end,body_text,
      jsonb_build_object('meeting_id',p_meeting,'prospect_id',p.id,'prospect_name',p.name,'company',p.company,
        'when_iso',b.start_at,'calendar_event_id',b.calendar_event_id,'source','inbox_calendar','matched_prospect',true,'stamped',true),null,null)
    on conflict do nothing;
    -- Complete only our own private placeholder after the real booking card exists.
    update ops_drafts set approved_at=now(),sent_at=now(),context=context||jsonb_build_object('meeting_id',p_meeting,'source','inbox_calendar_reconciled')
      where id=b.pending_ops_id and kind='task' and approved_at is null and sent_at is null and send_blocked_reason is null;
    end if;
  end if;
  update inbox_calendar_bookings set meeting_id=p_meeting,booked_at=p_booked,handoff_at=coalesce(handoff_at,now()),updated_at=now() where request_id=p_request;
end $$;
revoke all on function public.inbox_calendar_finish(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.inbox_calendar_finish(uuid,text,timestamptz) to service_role;
