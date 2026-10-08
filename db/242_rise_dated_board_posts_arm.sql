-- A RISE post on Mattan's board that a person dates (Ivan in the inbox, Mattan on his panel) is armed
-- to publish (status review -> scheduled). Engine-written dates stay unarmed, as the 10-07 hardening
-- intends. ARCH is unchanged: Davorin's panel approval is its gate. A panel date may no longer sit in
-- the past (was "up to a day ago": the publisher would send it on the next tick).
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
  if d.status not in ('review', 'scheduled') then
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

CREATE OR REPLACE FUNCTION public.client_board_set_schedule_v2(p_slug text, p_session text, p_draft_id uuid, p_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_hash text; v_email text; v_board public.client_boards%rowtype; v_old timestamptz; v_date text;
begin
  if coalesce(p_session, '') = '' then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  v_hash := encode(digest(p_session, 'sha256'), 'hex');
  select email into v_email from public.client_board_sessions
   where slug = p_slug and token_hash = v_hash and revoked_at is null and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  update public.client_board_sessions set last_seen_at = now() where slug = p_slug and token_hash = v_hash;
  select * into v_board from public.client_boards
   where slug = p_slug and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_scheduled_at is not null and (p_scheduled_at < now() - interval '5 minutes' or p_scheduled_at > now() + interval '365 days') then
    return jsonb_build_object('ok', false, 'error', 'bad_date'); end if;
  select scheduled_at into v_old from public.carousel_drafts
   where id = p_draft_id and client_id = v_board.client_id and status in ('review', 'scheduled');
  if not found then return jsonb_build_object('ok', false, 'error', 'draft_not_schedulable'); end if;
  -- 2026-10-08: the panel says a dated post "publishes". For RISE that needs status=scheduled since the
  -- 10-07 publisher hardening, so the client's own date arms a post that is on the board.
  update public.carousel_drafts set scheduled_at = p_scheduled_at, updated_at = now(),
         status = case when v_board.client_id = 'risedtc' and board_visible is true and status = 'review'
                        and p_scheduled_at is not null then 'scheduled' else status end
   where id = p_draft_id;
  v_date := case when p_scheduled_at is null then null else to_char(p_scheduled_at at time zone 'UTC', 'YYYY-MM-DD') end;
  update public.client_boards set board = jsonb_set(board, '{queue}', coalesce((
      select jsonb_agg(case when (q->>'id') = p_draft_id::text
        then case when v_date is null then (q - 'publish_date') else jsonb_set(q, '{publish_date}', to_jsonb(v_date)) end
        else q end)
      from jsonb_array_elements(board->'queue') q), board->'queue'))
    where slug = p_slug;
  insert into public.client_board_actions (board_slug, client_id, action, ref, payload)
  values (p_slug, v_board.client_id, 'set_schedule', p_draft_id::text,
          jsonb_build_object('applied', true, 'before', v_old, 'after', p_scheduled_at, 'by', v_email));
  return jsonb_build_object('ok', true, 'scheduled_at', p_scheduled_at);
end $function$;
