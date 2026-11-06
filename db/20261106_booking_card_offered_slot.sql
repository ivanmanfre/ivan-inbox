-- BOOKING_CARD_OFFERED_SLOT_V1 (2026-11-06, report item #13). A prospect said yes to the time WE offered (RISE / Mattan's
-- HubSpot link, SwishDM / Jonathan's TidyCal). The drafter stages a HELD confirm ("just sent the invite ...") whose
-- draft_evidence.calendar_slots.hold_reason = 'calendar_booking_pending' (both senders refuse it) and one Ops card
-- (context.kind_detail = 'book_offered_slot'). Ivan's tap on Book calls the inbox-calendar edge function, which books
-- through the owner's scheduler and then calls inbox_booking_card_commit: it records the booking, releases the held
-- confirm (still approved_at NULL, Ivan approves it in the thread) and closes the card. Nothing here sends anything.

-- 1. The private booking ledger also serves SwishDM.
alter table public.inbox_calendar_bookings drop constraint if exists inbox_calendar_bookings_client_id_check;
alter table public.inbox_calendar_bookings add constraint inbox_calendar_bookings_client_id_check check (client_id in ('risedtc','arch','swishdm'));

create or replace function public.inbox_calendar_claim(p_prospect uuid,p_client text,p_request uuid,p_start timestamptz,p_email text,p_timezone text)
returns boolean language plpgsql set search_path=public as $$
declare p public.outreach_prospects; cid text; n integer;
begin
  select * into p from outreach_prospects where id=p_prospect for update;
  if not found or p.call_booked_at is not null or coalesce(p.blacklisted,false)
    or p.stage in ('archived','skipped','disqualified','unsubscribed','blacklisted') or p.skip_reason is not null then return false; end if;
  select client_id into cid from outreach_campaigns where id=p.campaign_id;
  if cid is distinct from p_client or cid not in ('risedtc','arch','swishdm') then return false; end if;
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

-- 2. One transaction after the provider returned a receipt (or after a failed write, p_event null = mark failed).
--    p_meeting/p_booked: the provider's own meeting id and creation time (HubSpot hs_createdate with ms, TidyCal
--    created_at). Without them (CRM search lag) the invite stays confirmed and the booking is recorded on the next tap.
create or replace function public.inbox_booking_card_commit(p_request uuid,p_card uuid,p_event text,p_meeting text,p_booked timestamptz)
returns jsonb language plpgsql set search_path=public as $$
declare b public.inbox_calendar_bookings; d public.ops_drafts; bk jsonb; pr public.outreach_prospects;
  rec jsonb := null; rec_err text := null; n_rel int := 0; draft_id uuid; receipt jsonb;
begin
  select * into b from inbox_calendar_bookings where request_id=p_request for update;
  if not found then raise exception 'Booking request not found'; end if;
  select * into d from ops_drafts where id=p_card and kind='task' for update;
  if not found or d.context->>'action' is distinct from 'book_link' or d.context->>'kind_detail' is distinct from 'book_offered_slot' then raise exception 'Booking card not found'; end if;
  bk := d.context->'booking';
  if (d.context->>'prospect_id')::uuid is distinct from b.prospect_id or d.context->>'client_id' is distinct from b.client_id
     or (bk->>'start')::timestamptz is distinct from b.start_at or lower(bk->>'invite_email') is distinct from lower(b.email) then
    raise exception 'Card and booking do not match';
  end if;
  if p_event is null then
    update inbox_calendar_bookings set status='failed',updated_at=now() where request_id=p_request and status='pending';
    return jsonb_build_object('ok',true,'status','failed');
  end if;
  if b.status not in ('pending','confirmed') then raise exception 'Booking is %', b.status; end if;
  if b.calendar_event_id is not null and b.calendar_event_id <> p_event then raise exception 'Calendar receipt changed'; end if;
  if b.meeting_id is not null and p_meeting is not null and b.meeting_id <> p_meeting then raise exception 'Meeting identity changed'; end if;
  update inbox_calendar_bookings set status='confirmed',calendar_event_id=p_event,updated_at=now() where request_id=p_request;
  select * into pr from outreach_prospects where id=b.prospect_id for update;

  -- record the booking once, with the provider's own id and creation time
  if p_meeting is not null and p_booked is not null and b.handoff_at is null then
    if b.client_id='risedtc' then
      if p_meeting !~ '^[0-9]+$' then raise exception 'A real HubSpot meeting id is required'; end if;
      begin
      rec := public.booking_ingest_event(jsonb_build_object('client_id','risedtc','source','hubspot_scheduler_api','event_id',p_meeting,
        'status','confirmed','start_at',b.start_at,'booked_at',p_booked,'prospect_id',b.prospect_id,
        'title','Intro Call w/ RISE DTC - '||split_part(coalesce(pr.name,''),' ',1)||' & Mattan',
        'attendees',jsonb_build_array(jsonb_build_object('email',b.email,'name',pr.name)),
        'raw_ref','hubspot calendarEventId '||p_event||', booked from the inbox card '||p_card));
      if not coalesce((rec->>'ok')::boolean,false) then rec_err := coalesce(rec->>'error','unknown'); rec := null; end if;
      -- a failed record never undoes the confirmed invite or the release; the card stays open and a second tap retries it
      exception when others then rec_err := sqlerrm; rec := null;
      end;
    elsif b.client_id='swishdm' then
      update outreach_prospects set call_booked_at=p_booked where id=b.prospect_id and call_booked_at is null;
      rec := jsonb_build_object('ok',true,'action','stamped','client_id','swishdm');
    end if;
    if rec is not null then
      update inbox_calendar_bookings set meeting_id=p_meeting,booked_at=p_booked,handoff_at=now(),updated_at=now() where request_id=p_request;
    end if;
  end if;

  -- release the held confirm: still unapproved; Ivan approves it in the thread
  receipt := jsonb_build_object('v','booking_card_offered_slot_v1','request_id',p_request,'calendar_event_id',p_event,'meeting_id',p_meeting,
    'booked_at',p_booked,'start',b.start_at,'invite_email',b.email,'released_at',now(),'card_id',p_card);
  draft_id := nullif(d.context->>'draft_message_id','')::uuid;
  -- Sol r1 #2/#4: release only the confirm this card staged, unsent, still the drafter's exact text and still naming
  -- this booking (client, start, invite email). An edited confirm keeps its hold (the card says reply by hand). An
  -- approval given before the booking is reset: Ivan approves the released confirm again in the thread.
  if draft_id is not null then
    update outreach_messages
       set draft_evidence = jsonb_set(draft_evidence #- '{calendar_slots,hold_reason}', '{calendar_slots,booking}', receipt),
           approved_at = null,
           send_blocked_at = case when b.client_id='swishdm' then now()
                                  when send_blocked_reason='lint_calendar_booking_pending' then null else send_blocked_at end,
           send_blocked_reason = case when b.client_id='swishdm' then 'awaiting_client_review'
                                      when send_blocked_reason='lint_calendar_booking_pending' then null else send_blocked_reason end
     where id=draft_id and prospect_id=b.prospect_id and direction='outbound' and sent_at is null
       and coalesce(send_blocked_reason,'') in ('', 'lint_calendar_booking_pending', 'awaiting_client_review')
       and draft_evidence->'calendar_slots'->>'hold_reason'='calendar_booking_pending'
       and draft_evidence->'calendar_slots'->>'client_id'=b.client_id
       and (draft_evidence->'calendar_slots'->'accepted_slot'->>'start')::timestamptz=b.start_at
       and (draft_evidence->'calendar_slots'->'accepted_slot'->>'end')::timestamptz=b.end_at
       and lower(draft_evidence->'calendar_slots'->>'invite_email')=lower(b.email)
       and message_text=coalesce(draft_evidence->>'generated_text',draft_evidence->>'original_text');
    get diagnostics n_rel=row_count;
  end if;
  -- the card closes once the booking is recorded; until then it stays open with the receipt (a second tap finishes it)
  if rec is not null or b.handoff_at is not null then
    update ops_drafts set approved_at=now(),sent_at=now(),
           context=context||jsonb_build_object('booked',coalesce(rec,'{}'::jsonb)||receipt,'booked_start_at',b.start_at,'confirm_released',coalesce((d.context->>'confirm_released')::boolean,false) or n_rel=1)
     where id=p_card and sent_at is null;
  else
    update ops_drafts set context=context||jsonb_build_object('invite_sent',receipt,'confirm_released',coalesce((d.context->>'confirm_released')::boolean,false) or n_rel=1)
     where id=p_card and sent_at is null;
  end if;
  return jsonb_build_object('ok',true,'status','confirmed','recorded',rec is not null or b.handoff_at is not null,'released',n_rel=1 or coalesce((d.context->>'confirm_released')::boolean,false),'record',rec,'record_error',rec_err);
end $$;
revoke all on function public.inbox_booking_card_commit(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.inbox_booking_card_commit(uuid,uuid,text,text,timestamptz) to service_role;
