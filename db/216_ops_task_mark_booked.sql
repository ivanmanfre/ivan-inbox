-- 216: the "Booked" action on a book-their-link task card (2026-09-27).
-- The ARCH / RISE reply drafters no longer WhatsApp "book it by hand": they write an Ops task card
-- (kind='task', context.action='book_link', context.client_id, context.prospect_id, context.link).
-- Tapping Booked + entering the call time calls this, which writes the booking through the SAME path as the
-- booking-email branch and the calendar source (booking_ingest_event, db/214) as a HAND-ENTERED booking
-- (meeting_id 'manual-opscard-<card id>', never touched by a later sync), then marks the task done.
create or replace function public.ops_task_mark_booked(p_draft_id uuid, p_start_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d record; r jsonb;
begin
  select * into d from ops_drafts where id = p_draft_id and kind = 'task';
  if not found then return jsonb_build_object('ok', false, 'error', 'Task not found.'); end if;
  if coalesce(d.context->>'action', '') <> 'book_link' then return jsonb_build_object('ok', false, 'error', 'This task is not a booking task.'); end if;
  if d.sent_at is not null or d.send_blocked_reason is not null then return jsonb_build_object('ok', false, 'error', 'This task is already closed.'); end if;
  if p_start_at is null or p_start_at < now() - interval '2 days' or p_start_at > now() + interval '180 days' then
    return jsonb_build_object('ok', false, 'error', 'That call time looks wrong (more than 2 days ago or 6 months out).');
  end if;
  r := public.booking_ingest_event(jsonb_build_object(
    'client_id', d.context->>'client_id', 'source', 'ops_card', 'event_id', 'manual-opscard-' || d.id::text,
    'status', 'confirmed', 'start_at', p_start_at, 'booked_at', now(), 'prospect_id', d.context->>'prospect_id',
    'hand_entered', true, 'title', 'Booked by hand on ' || coalesce(d.context->>'prospect_name', 'the prospect') || '''s link',
    'raw_ref', coalesce(d.context->>'link', '')));
  if coalesce((r->>'ok')::boolean, false) then
    update ops_drafts set approved_at = now(), sent_at = now(),
           context = context || jsonb_build_object('booked', r, 'booked_start_at', p_start_at)
     where id = d.id and sent_at is null;
  end if;
  return r;
end $$;
revoke all on function public.ops_task_mark_booked(uuid, timestamptz) from public, anon;
grant execute on function public.ops_task_mark_booked(uuid, timestamptz) to authenticated, service_role;
