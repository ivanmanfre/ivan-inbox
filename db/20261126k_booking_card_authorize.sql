-- 2026-11-26 (Sol review r4): the last check before a Book card's invite is one database step, serialized with Remove.
-- inbox_booking_card_authorize locks the card and its staged reply, and re-checks: the card is still open and names the
-- same booking, the reply is unsent, not discarded and still held for this time and email, and no newer message came
-- from them. Remove (a DELETE of the card) waits on that lock, and while the booking is pending the guard refuses it.
-- inbox_calendar_release frees a pending claim by request id when the card is gone (the commit RPC needs the card).
-- Nothing is sent from here.
create or replace function public.inbox_booking_card_authorize(p_request uuid, p_card uuid)
returns jsonb language plpgsql set search_path=public as $$
declare b public.inbox_calendar_bookings; d public.ops_drafts; bk jsonb; m public.outreach_messages; src public.outreach_messages;
  v_draft uuid; v_source uuid; cs jsonb;
begin
  select * into b from inbox_calendar_bookings where request_id=p_request for update;
  if not found or b.status <> 'pending' or b.calendar_event_id is not null then return jsonb_build_object('ok',false,'reason','The booking claim is no longer pending. Nothing was booked.'); end if;
  select * into d from ops_drafts where id=p_card for update;
  if not found or d.kind <> 'task' or d.sent_at is not null or d.send_blocked_reason is not null
     or d.context->>'action' is distinct from 'book_link' or d.context->>'kind_detail' is distinct from 'book_offered_slot' then
    return jsonb_build_object('ok',false,'reason','This card was removed or closed. Nothing was booked.');
  end if;
  bk := d.context->'booking';
  if (d.context->>'prospect_id') is distinct from b.prospect_id::text or d.context->>'client_id' is distinct from b.client_id
     or (bk->>'start')::timestamptz is distinct from b.start_at or lower(btrim(bk->>'invite_email')) is distinct from lower(b.email) then
    return jsonb_build_object('ok',false,'reason','This card changed. Nothing was booked.');
  end if;
  begin v_draft := nullif(d.context->>'draft_message_id','')::uuid; v_source := nullif(d.context->>'source_message_id','')::uuid;
  exception when others then v_draft := null; v_source := null; end;
  if v_draft is null or v_source is null then return jsonb_build_object('ok',false,'reason','This card does not name the reply and message it goes with. Book by hand. Nothing was booked.'); end if;
  select * into m from outreach_messages where id=v_draft for update;
  cs := m.draft_evidence->'calendar_slots';
  if not found or m.prospect_id <> b.prospect_id or m.sent_at is not null
     or coalesce(m.send_blocked_reason,'') not in ('','lint_calendar_booking_pending','awaiting_client_review')
     or cs->>'hold_reason' is distinct from 'calendar_booking_pending'
     or (cs->'accepted_slot'->>'start')::timestamptz is distinct from b.start_at
     or lower(btrim(cs->>'invite_email')) is distinct from lower(b.email) then
    return jsonb_build_object('ok',false,'reason','The reply this card goes with was sent, discarded or changed. Nothing was booked.');
  end if;
  select * into src from outreach_messages where id=v_source;
  if not found or src.prospect_id <> b.prospect_id then return jsonb_build_object('ok',false,'reason','The message this card answers could not be checked. Nothing was booked.'); end if;
  if exists (select 1 from outreach_messages o where o.prospect_id=b.prospect_id and o.direction='inbound' and o.id <> v_source
               and coalesce(o.is_reaction,false) = false and coalesce(o.sent_at,o.created_at) > coalesce(src.sent_at,src.created_at)) then
    return jsonb_build_object('ok',false,'reason','They wrote again after this card was made. Read the thread before booking. Nothing was booked.');
  end if;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.inbox_booking_card_authorize(uuid,uuid) from public,anon,authenticated;
grant execute on function public.inbox_booking_card_authorize(uuid,uuid) to service_role;

create or replace function public.inbox_calendar_release(p_request uuid)
returns jsonb language plpgsql set search_path=public as $$
declare n int;
begin
  update inbox_calendar_bookings set status='failed', updated_at=now() where request_id=p_request and status='pending' and calendar_event_id is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok',true,'released',n);
end $$;
revoke all on function public.inbox_calendar_release(uuid) from public,anon,authenticated;
grant execute on function public.inbox_calendar_release(uuid) to service_role;

-- Remove (sets send_blocked_reason), Clear All and a delete wait for authorize's row lock. While that card's booking claim
-- is pending (in flight, at most 10 minutes) the card stays open: the discard is ignored for that one row (never an
-- error, so a Clear All batch still clears every other card). SECURITY DEFINER: the app's role cannot read the ledger.
create or replace function public.inbox_booking_card_inflight(c jsonb) returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce(c->>'action','') = 'book_link' and coalesce(c->>'kind_detail','') = 'book_offered_slot'
     and exists (select 1 from inbox_calendar_bookings b
                  where b.prospect_id::text = c->>'prospect_id' and b.client_id = c->>'client_id'
                    and b.status = 'pending' and b.start_at = (c->'booking'->>'start')::timestamptz
                    and b.updated_at > now() - interval '10 minutes')
$$;
revoke all on function public.inbox_booking_card_inflight(jsonb) from public,anon,authenticated;
create or replace function public.inbox_booking_card_discard_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'task' and inbox_booking_card_inflight(old.context) then return null; end if;   -- this row's delete is skipped
    return old;
  end if;
  if old.kind = 'task' and old.send_blocked_reason is null and new.send_blocked_reason is not null
     and old.sent_at is null and new.sent_at is null and inbox_booking_card_inflight(old.context) then
    new.send_blocked_reason := null;   -- kept open while the invite is in flight
  end if;
  return new;
end $$;
revoke all on function public.inbox_booking_card_discard_guard() from public,anon,authenticated;
create or replace trigger inbox_booking_card_discard_guard before update of send_blocked_reason or delete on public.ops_drafts
  for each row when (old.kind = 'task') execute function public.inbox_booking_card_discard_guard();
