-- 205: a calendar move reaches the publisher, and reports where it really landed.
--
-- Ivan, 2026-09-22: "cant even reschedule stuff". Two defects in 032's body:
--
--  1. It wrote carousel_drafts.scheduled_at ONLY. The publisher fires from
--     scheduled_posts, and the calendar draws a pending post on the QUEUE's
--     clock, so a confirmed move snapped straight back to the old day with a
--     drift mark until the 5-min Bridge (yzXqLDIpuNzuhUQq) re-timed the queue.
--     The Bridge only reads status='scheduled', so a review draft holding a
--     pending queue row (the hand-queued drip posts) was never re-timed at all.
--  2. It returned p_scheduled_at, the REQUESTED instant. carousel_drafts_weekday_guard
--     rewrites the value (weekend -> Monday, taken day -> next free weekday), so
--     the "Moved to" banner named a day the post was not on. Live case: the
--     Warsaw post was moved to Oct 7 at 21:53Z, the guard put it on Oct 8
--     (slot_shifted_from 2026-10-07), the banner said Oct 7.
--
-- Now: the draft write, then the SAME stored instant onto that draft's pending
-- queue rows (the Bridge's own join, clickup_task_id = draft uuid, pending only;
-- posted/cancelled/blocked history is never touched), and the stored value comes
-- back with the requested one so the app can say when the guard moved it.
-- Rollback: db/205_schedule_move_reaches_queue_rollback.sql (032's body).

CREATE OR REPLACE FUNCTION public.operator_set_schedule_date(p_gate text, p_draft_id uuid, p_scheduled_at timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  d carousel_drafts;
  v_at timestamptz;
  v_queued int := 0;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  select * into d from carousel_drafts where id = p_draft_id;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if d.status not in ('review', 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', d.status);
  end if;
  update carousel_drafts set scheduled_at = p_scheduled_at
   where id = p_draft_id
   returning scheduled_at into v_at;
  if v_at is not null then
    update scheduled_posts set scheduled_at = v_at
     where clickup_task_id = p_draft_id::text
       and status = 'pending'
       and scheduled_at is distinct from v_at;
    get diagnostics v_queued = row_count;
  end if;
  return jsonb_build_object('ok', true, 'id', p_draft_id, 'scheduled_at', v_at,
    'requested_at', p_scheduled_at, 'queue_retimed', v_queued, 'status', d.status);
end; $function$;

REVOKE EXECUTE ON FUNCTION public.operator_set_schedule_date(text, uuid, timestamptz) FROM public, anon;
