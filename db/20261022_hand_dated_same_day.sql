-- 2026-10-22 Ivan: "it should allow me to put 2 posts same day if i want too".
-- A date set by hand in the Inbox (operator_set_schedule_date) may share a Warsaw day with another post:
-- the weekday guard no longer walks it, the spacing guard lets it through, and the publisher claim skips the
-- 24h gap for exactly the stamped slot (taxonomy.hand_dated_at). Automatic placement keeps every rule.
-- Rollback: 20261022_hand_dated_same_day_rollback.sql

begin;
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
  -- 2026-10-09: a hand-set date; the weekday guard lets it land on a weekend (one a day still holds).
  perform set_config('app.schedule_manual', 'on', true);
  -- 2026-10-22 (Ivan: "it should allow me to put 2 posts same day if i want too"): the instant Ivan
  -- set by hand is stamped, so the publisher's 24h claim gap lets exactly this slot through.
  update carousel_drafts set scheduled_at = p_scheduled_at,
         taxonomy = case when p_scheduled_at is null then coalesce(taxonomy, '{}'::jsonb) - 'hand_dated_at'
                         else coalesce(taxonomy, '{}'::jsonb) || jsonb_build_object('hand_dated_at', p_scheduled_at) end,
         -- 2026-10-08: a RISE post on Mattan's board that Ivan dates is armed to publish. Since the
         -- 10-07 hardening only status=scheduled publishes, and nothing armed a dated review row,
         -- so both surfaces promised a post that never went out (f0435946, 10-09).
         status = case when d.client_id = 'risedtc' and d.board_visible is true and d.status = 'review'
                        and p_scheduled_at is not null then 'scheduled' else status end
   where id = p_draft_id
   returning scheduled_at into v_at;
  perform set_config('app.schedule_manual', '', true);
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
end; $function$
;

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
  v_manual boolean := false;
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
  -- 2026-10-09 (Ivan: "it should also allow to post in weekends as well"): a date Ivan sets by hand
  -- in the Inbox (operator_set_schedule_date marks the transaction) may be a Saturday or Sunday.
  -- Automatic scheduling stays weekday-only per the canon; the one-a-day cap applies to both.
  v_manual := coalesce(current_setting('app.schedule_manual', true), '') = 'on';

  -- 1) Weekend snap. Saturday or Sunday in Europe/Madrid moves to the next Monday
  --    at the same wall-clock time. Never raises: a weekend date becomes a Monday.
  if not v_manual and extract(isodow from v_local) in (6, 7) then
    v_local := v_local + make_interval(days => (8 - extract(isodow from v_local))::int);
    v_snapped := true;
  end if;

  -- 2) One Ivan post per calendar day (or whatever max_posts_per_day the canon says).
  --    If the day is already taken, walk forward to the next free weekday.
  -- 2026-10-22: a hand-set date may share its day with another post; only automatic paths walk.
  loop
    exit when v_manual;
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
    while not v_manual and extract(isodow from v_local) in (6, 7) loop
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
$function$
;

CREATE OR REPLACE FUNCTION public.content_plan_ivan_spacing_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF NEW.client_id IS NOT NULL OR NEW.scheduled_at IS NULL OR NEW.status NOT IN ('review','approved','scheduled') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.scheduled_at IS NOT DISTINCT FROM NEW.scheduled_at THEN RETURN NEW; END IF;
 -- 2026-10-22 (Ivan): a date he sets by hand may share a day with another post. Automatic placement keeps the gap.
 IF coalesce(current_setting('app.schedule_manual',true),'')='on' THEN RETURN NEW; END IF;
 -- UI UPDATE already owns its row; fail retryably rather than invert the RPC's advisory-before-row lock order.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('content-plan:ivan',0)) THEN
  RAISE EXCEPTION 'Ivan plan is busy; retry this date change' USING ERRCODE='40001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.carousel_drafts d WHERE d.client_id IS NULL AND d.id<>NEW.id
   AND d.status IN ('review','approved','scheduled','published') AND coalesce(d.taxonomy->>'deleted_by_operator','')<>'true'
   AND (abs(extract(epoch FROM coalesce(d.published_at,d.scheduled_at)-NEW.scheduled_at))<86400
      OR (coalesce(d.published_at,d.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date=(NEW.scheduled_at AT TIME ZONE 'Europe/Warsaw')::date))
 OR EXISTS(SELECT 1 FROM public.scheduled_posts q WHERE q.platform='linkedin' AND q.status IN ('pending','posting','posted')
   AND coalesce(q.is_repost,false)=false AND q.clickup_task_id IS DISTINCT FROM NEW.id::text
   AND NOT EXISTS(SELECT 1 FROM public.carousel_drafts d WHERE d.id::text=q.clickup_task_id)
   AND (abs(extract(epoch FROM coalesce(q.posted_at,q.scheduled_at)-NEW.scheduled_at))<86400
      OR (coalesce(q.posted_at,q.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date=(NEW.scheduled_at AT TIME ZONE 'Europe/Warsaw')::date))
 THEN RAISE EXCEPTION 'Ivan schedule needs at least 24 hours and one post per Warsaw day' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.scheduled_post_claim_if_unchanged(p_id uuid, p_expected jsonb, p_publisher_account text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '5s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE q public.scheduled_posts%rowtype; k text; own_ivan boolean; linked_client text; linked boolean; preserved_slot boolean:=false; hand_dated boolean:=false; frozen_policy jsonb; auto_gate jsonb; auto_files jsonb; auto_payload jsonb;
BEGIN
  IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object' OR p_expected->>'id' IS DISTINCT FROM p_id::text THEN
    RETURN jsonb_build_object('claimed',false,'reason','invalid_snapshot'); END IF;
  -- Same order as calendar RPCs: account advisory lock BEFORE the queue row lock.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('content-plan:ivan',0)) THEN
    RETURN jsonb_build_object('claimed',false,'reason','calendar_busy'); END IF;
  SELECT * INTO q FROM public.scheduled_posts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','missing_queue_row'); END IF;
  IF q.status IS DISTINCT FROM 'pending' THEN RETURN jsonb_build_object('claimed',false,'reason','not_pending'); END IF;
  IF q.scheduled_at IS DISTINCT FROM (p_expected->>'scheduled_at')::timestamptz THEN
    RETURN jsonb_build_object('claimed',false,'reason','stale_scheduled_at'); END IF;
  IF q.scheduled_at IS NULL OR q.scheduled_at>now() THEN RETURN jsonb_build_object('claimed',false,'reason','not_due'); END IF;
  FOREACH k IN ARRAY ARRAY['clickup_task_id','post_text','post_format','media_urls','platform','ig_caption','ig_dm_keyword','ig_dm_reply','is_repost','post_kind'] LOOP
    IF NOT p_expected ? k OR to_jsonb(q)->k IS DISTINCT FROM p_expected->k THEN
      RETURN jsonb_build_object('claimed',false,'reason','stale_payload'); END IF;
  END LOOP;
  SELECT d.client_id INTO linked_client FROM public.carousel_drafts d WHERE d.id::text=q.clickup_task_id;
  linked:=FOUND; own_ivan:=false;
  IF q.platform='linkedin' AND (NOT linked OR linked_client IS NULL) THEN
    -- Unlinked/legacy queue rows are classified by the explicitly configured publishing account, never by missing linkage.
    IF p_publisher_account IS NULL OR NOT EXISTS(SELECT 1 FROM public.integration_config
      WHERE key='ivan_unipile_account_id' AND value=p_publisher_account) THEN
      RETURN jsonb_build_object('claimed',false,'reason','unknown_queue_scope'); END IF;
    own_ivan:=true;
  END IF;
  -- In-flight exclusion always applies, including to frozen approved slots.
  IF own_ivan AND EXISTS(SELECT 1 FROM public.scheduled_posts x LEFT JOIN public.carousel_drafts d ON d.id::text=x.clickup_task_id
    WHERE x.id<>q.id AND x.platform='linkedin' AND coalesce(x.is_repost,false)=false
    AND (d.id IS NULL OR d.client_id IS NULL) AND x.status='posting') THEN
    RETURN jsonb_build_object('claimed',false,'reason','ivan_publish_in_flight'); END IF;
  -- Frozen compatibility exception: account + queue + original draft identity + exact original slot.
  -- Only the cadence rule is exempted. All preceding checks and the final pending CAS remain required.
  IF own_ivan THEN
    SELECT value::jsonb INTO frozen_policy FROM public.integration_config
      WHERE key='ivan_publisher_existing_slot_exemptions_20261017';
    SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(frozen_policy->'slots') slot
      WHERE frozen_policy->>'client_id'='ivan'
      AND frozen_policy->>'publisher_account'=p_publisher_account
      AND slot->>'queue_id'=q.id::text
      AND (slot->>'scheduled_at')::timestamptz=q.scheduled_at
      AND slot->>'draft_id' IS NOT DISTINCT FROM q.clickup_task_id)
    INTO preserved_slot;
  END IF;
  -- Only automatic picks require the new receipt. Existing frozen approved slots retain their booked identity.
  IF own_ivan AND NOT preserved_slot AND (EXISTS(SELECT 1 FROM public.content_autopilot_picks ap WHERE ap.account='ivan' AND ap.draft_id::text=q.clickup_task_id) OR EXISTS(SELECT 1 FROM public.content_plan_slots ps WHERE ps.account='ivan' AND ps.placed_draft_id::text=q.clickup_task_id AND ps.placement_kind='autopilot')) THEN
    PERFORM 1 FROM public.carousel_drafts WHERE id::text=q.clickup_task_id FOR SHARE;
    IF NOT EXISTS(SELECT 1 FROM public.content_autopilot_picks ap JOIN public.carousel_drafts d ON d.id=ap.draft_id
      WHERE ap.account='ivan' AND ap.draft_id::text=q.clickup_task_id AND ap.state='armed' AND ap.slot_at=q.scheduled_at
      AND d.status='scheduled' AND d.scheduled_at=q.scheduled_at AND d.published_at IS NULL
      AND ap.body_sha256=encode(sha256(convert_to(d.post_body,'UTF8')),'hex')) THEN RETURN jsonb_build_object('claimed',false,'reason','autonomy_pick_stale'); END IF;
    auto_payload:=public.content_autonomy_queue_payload_ivan(q.clickup_task_id::uuid);
    FOREACH k IN ARRAY ARRAY['post_text','post_format','media_urls'] LOOP
      IF to_jsonb(q)->k IS DISTINCT FROM auto_payload->k THEN RETURN jsonb_build_object('claimed',false,'reason','autonomy_queue_payload_mismatch','field',k); END IF;
    END LOOP;
    IF coalesce(q.is_repost,false) THEN RETURN jsonb_build_object('claimed',false,'reason','autonomy_repost_mismatch'); END IF;
    auto_gate:=public.content_autonomy_gate_ivan(q.clickup_task_id::uuid);
    IF NOT coalesce((auto_gate->>'eligible')::boolean,false) THEN RETURN jsonb_build_object('claimed',false,'reason','autonomy_review_stale','fails',auto_gate->'fails'); END IF;
    IF p_expected->>'autonomy_manifest_sha256' IS DISTINCT FROM auto_gate->>'manifest_sha256' THEN RETURN jsonb_build_object('claimed',false,'reason','autonomy_manifest_stale'); END IF;
    SELECT coalesce(d.qa->'autonomous_review'->'assets'->'files','[]'::jsonb) INTO auto_files FROM public.carousel_drafts d WHERE d.id::text=q.clickup_task_id;
    IF p_expected->'autonomy_asset_files' IS DISTINCT FROM auto_files THEN RETURN jsonb_build_object('claimed',false,'reason','autonomy_assets_unverified'); END IF;
  END IF;
  -- 2026-10-22 (Ivan: two posts on one day when he picks it): the slot he dated by hand, at exactly
  -- the stamped instant, skips only the 24h gap. A later automatic retime breaks the match.
  IF own_ivan AND linked THEN
    BEGIN
      SELECT (d.taxonomy->>'hand_dated_at')::timestamptz = q.scheduled_at INTO hand_dated
        FROM public.carousel_drafts d WHERE d.id::text=q.clickup_task_id AND d.client_id IS NULL;
    EXCEPTION WHEN others THEN hand_dated:=false;
    END;
    hand_dated:=coalesce(hand_dated,false);
  END IF;
  IF own_ivan AND NOT preserved_slot AND NOT hand_dated AND (
    EXISTS(SELECT 1 FROM public.scheduled_posts x LEFT JOIN public.carousel_drafts d ON d.id::text=x.clickup_task_id
      WHERE x.id<>q.id AND x.platform='linkedin' AND coalesce(x.is_repost,false)=false
      AND (d.id IS NULL OR d.client_id IS NULL)
      AND (x.status='posted' AND x.posted_at IS NOT NULL AND
        (x.posted_at>now()-interval '24 hours' OR (x.posted_at AT TIME ZONE 'Europe/Warsaw')::date=(now() AT TIME ZONE 'Europe/Warsaw')::date)))
    OR EXISTS(SELECT 1 FROM public.own_posts o WHERE o.linkedin_url LIKE 'https://%' AND o.posted_at<=now()
      AND (o.posted_at>now()-interval '24 hours' OR (o.posted_at AT TIME ZONE 'Europe/Warsaw')::date=(now() AT TIME ZONE 'Europe/Warsaw')::date))
    OR EXISTS(SELECT 1 FROM public.client_post_metrics m WHERE m.client_id='ivan' AND m.published_at<=now()
      AND (m.published_at>now()-interval '24 hours' OR (m.published_at AT TIME ZONE 'Europe/Warsaw')::date=(now() AT TIME ZONE 'Europe/Warsaw')::date))
  ) THEN RETURN jsonb_build_object('claimed',false,'reason','ivan_gap_24h'); END IF;
  UPDATE public.scheduled_posts SET status='posting' WHERE id=q.id AND status='pending'
    AND scheduled_at=q.scheduled_at AND scheduled_at<=now() RETURNING * INTO q;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','claim_lost'); END IF;
  RETURN jsonb_build_object('claimed',true,'post',to_jsonb(q));
END $function$
;
commit;
