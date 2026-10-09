-- Restores the 2026-10-09 pre-change definitions.
CREATE OR REPLACE FUNCTION public.carousel_drafts_weekday_guard_fn()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_zone constant text := 'Europe/Madrid';
  v_local timestamp;
  v_orig timestamptz;
  v_cfg jsonb;
  v_max_per_day int := 1;
  v_policy_note text := null;
  v_guard int := 0;
  v_taken boolean;
  v_snapped boolean := false;
  v_shifted boolean := false;
begin
  -- Ivan's own lane only. A client draft is scheduled by operator_schedule_draft
  -- and by the client board; this guard never touches one.
  if new.client_id is not null then
    return new;
  end if;
  if new.scheduled_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.scheduled_at is not distinct from new.scheduled_at then
    return new;
  end if;

  v_orig := new.scheduled_at;

  -- Caps come from the canon row, never from a hardcoded number here.
  begin
    select (variables[1])::jsonb into v_cfg
    from public.content_prompts
    where slug = 'format-mix-policy-2026' and is_active
    limit 1;
  exception when others then
    v_cfg := null;
  end;

  if v_cfg is null then
    v_policy_note := 'format-mix-policy-2026 unreadable at ' || now()::text || ' - fell open to weekday-only';
  else
    v_max_per_day := coalesce((v_cfg ->> 'max_posts_per_day')::int, 1);
    if coalesce((v_cfg ->> 'weekdays_only')::boolean, true) is false then
      -- The canon row itself turned weekday-only off. Respect it and stop here.
      return new;
    end if;
  end if;

  v_local := new.scheduled_at at time zone v_zone;

  -- 1) Weekend snap. Saturday or Sunday in Europe/Madrid moves to the next Monday
  --    at the same wall-clock time. Never raises: a weekend date becomes a Monday.
  if extract(isodow from v_local) in (6, 7) then
    v_local := v_local + make_interval(days => (8 - extract(isodow from v_local))::int);
    v_snapped := true;
  end if;

  -- 2) One Ivan post per calendar day (or whatever max_posts_per_day the canon says).
  --    If the day is already taken, walk forward to the next free weekday.
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 120;

    select count(*) >= v_max_per_day into v_taken
    from public.carousel_drafts d
    where d.client_id is null
      and d.id is distinct from new.id
      and d.scheduled_at is not null
      and d.status in ('review', 'approved', 'scheduled')
      and ((d.scheduled_at at time zone v_zone)::date) = v_local::date;

    exit when not v_taken;

    v_local := v_local + interval '1 day';
    v_shifted := true;
    while extract(isodow from v_local) in (6, 7) loop
      v_local := v_local + interval '1 day';
    end loop;
  end loop;

  new.scheduled_at := v_local at time zone v_zone;

  if v_snapped or v_shifted or v_policy_note is not null then
    new.taxonomy := coalesce(new.taxonomy, '{}'::jsonb);
    if v_snapped then
      new.taxonomy := new.taxonomy || jsonb_build_object('weekday_snapped_from', to_char(v_orig, 'YYYY-MM-DD"T"HH24:MI:SSOF'));
    end if;
    if v_shifted then
      new.taxonomy := new.taxonomy || jsonb_build_object('slot_shifted_from', to_char(v_orig, 'YYYY-MM-DD"T"HH24:MI:SSOF'));
    end if;
    if v_policy_note is not null then
      new.taxonomy := new.taxonomy || jsonb_build_object('weekday_guard_policy', v_policy_note);
    end if;
  end if;

  return new;
exception when others then
  -- Never block a write. A guard that raises is worse than a weekend post.
  return new;
end;
$function$;

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
