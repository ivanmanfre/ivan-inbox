-- operator_set_schedule_date also dates Ivan's approved posts (review desk "Pick a day" was refused bad_status).
CREATE OR REPLACE FUNCTION public.operator_set_schedule_date(p_gate text, p_draft_id uuid, p_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  d carousel_drafts;
  v_at timestamptz;
  v_queued int := 0;
  v_sync bigint;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  select * into d from carousel_drafts where id = p_draft_id;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  -- 2026-10-08: Ivan's own approved posts take a day too ("Pick a day" on the review desk); his
  -- Bridge sends only status=scheduled, so a day on an approved row publishes nothing until he
  -- presses Schedule.
  if d.status not in ('review', 'scheduled')
     and not (d.status = 'approved' and coalesce(d.client_id, 'ivan') = 'ivan') then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', d.status);
  end if;
  -- 2026-10-08: a date in the past publishes on the next tick (both publishers poll every
  -- 10 min). Clearing the date (null) is always allowed.
  if p_scheduled_at is not null and p_scheduled_at < now() - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'error', 'past_date');
  end if;
  update carousel_drafts set scheduled_at = p_scheduled_at,
         -- 2026-10-08: a RISE post on Mattan's board that Ivan dates is armed to publish. Since the
         -- 10-07 hardening only status=scheduled publishes, and nothing armed a dated review row,
         -- so both surfaces promised a post that never went out (f0435946, 10-09).
         status = case when d.client_id = 'risedtc' and d.board_visible is true and d.status = 'review'
                        and p_scheduled_at is not null then 'scheduled' else status end
   where id = p_draft_id
   returning scheduled_at into v_at;
  if v_at is not null then
    update scheduled_posts set scheduled_at = v_at
     where clickup_task_id = p_draft_id::text
       and status = 'pending'
       and scheduled_at is distinct from v_at;
    get diagnostics v_queued = row_count;
  end if;
  -- Calendar 2026-10-01: the client board renders a cached queue; a date move on a row
  -- the client can see must rebuild it (same call operator_set_board_visible makes).
  if d.client_id is not null and d.board_visible is true then
    select net.http_post(
      url := 'https://n8n.ivanmanfredi.com/webhook/client-board-queue-sync?k=6098d6f092c50f5f1894fd61',
      body := jsonb_build_object('client_id', d.client_id),
      headers := '{"Content-Type":"application/json"}'::jsonb
    ) into v_sync;
  end if;
  return jsonb_build_object('ok', true, 'id', p_draft_id, 'scheduled_at', v_at,
    'requested_at', p_scheduled_at, 'queue_retimed', v_queued, 'status', d.status, 'sync_request_id', v_sync);
end; $function$;
