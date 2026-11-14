BEGIN;

-- 2026-11-14: Pull. Taking a scheduled post of Ivan's off the schedule, for real.
--
-- Why. The app's only unschedule verb (Calendar > Remove date, operator_set_schedule_date with a null date) cleared the
-- draft's date and nothing else: the draft stayed 'scheduled' and its scheduled_posts row stayed pending at the old
-- time. The publisher claims a hand-placed post from the queue row alone, so a post Ivan thought he had removed would
-- still go out. An autopilot post was refused instead and sat pending for ever. A LinkedIn post cannot be deleted.
-- A pull cancels the queued copy, returns the draft to Review with no date, releases the autopilot pick, and marks
-- the draft so the autopilot does not place it again on its own.

CREATE TABLE IF NOT EXISTS public.content_owner_pulls (
  draft_id uuid PRIMARY KEY REFERENCES public.carousel_drafts(id) ON DELETE CASCADE,
  was_at timestamptz,
  reason text,
  actor jsonb,
  pulled_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.content_owner_pulls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_owner_pulls FROM PUBLIC, anon, authenticated;

-- Internal: the one place a pull is done. Callers authorise first (content_next_pull: the owner login;
-- operator_set_schedule_date: the operator gate).
CREATE OR REPLACE FUNCTION public.content_owner_pull_ivan(p_draft uuid, p_expected_slot timestamptz, p_reason text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '3s'
AS $function$
DECLARE d public.carousel_drafts%ROWTYPE; v_was timestamptz; v_n int := 0;
BEGIN
  -- Same order as the publisher claim: account lock, then queue rows, then draft.
  PERFORM pg_advisory_xact_lock(hashtextextended('content-plan:ivan', 0));
  PERFORM 1 FROM public.scheduled_posts WHERE clickup_task_id = p_draft::text ORDER BY id FOR UPDATE;
  SELECT * INTO d FROM public.carousel_drafts WHERE id = p_draft AND client_id IS NULL FOR UPDATE;
  IF NOT FOUND OR d.status IS DISTINCT FROM 'scheduled' OR d.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'Not pulled: this post is no longer scheduled.' USING ERRCODE = 'P0001', HINT = 'next_gone'; END IF;
  IF p_expected_slot IS NOT NULL AND d.scheduled_at IS DISTINCT FROM p_expected_slot THEN
    RAISE EXCEPTION 'Not pulled: its time changed. Look at it again.' USING ERRCODE = 'P0001', HINT = 'next_changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.scheduled_posts WHERE clickup_task_id = p_draft::text AND status = 'posting') THEN
    RAISE EXCEPTION 'Not pulled: it is being published right now.' USING ERRCODE = 'P0001', HINT = 'next_busy'; END IF;
  v_was := d.scheduled_at;
  UPDATE public.scheduled_posts SET status = 'cancelled',
         error_message = left('pulled by Ivan ' || to_char(now() AT TIME ZONE 'Europe/Warsaw', 'YYYY-MM-DD HH24:MI') || ': ' || coalesce(p_reason, ''), 300)
   WHERE clickup_task_id = p_draft::text AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.content_autopilot_picks SET state = 'released' WHERE draft_id = p_draft AND state = 'armed';
  UPDATE public.carousel_drafts
     SET status = 'review', scheduled_at = NULL,
         taxonomy = CASE WHEN jsonb_typeof(taxonomy) = 'object' THEN taxonomy - 'hand_dated_at' ELSE taxonomy END
   WHERE id = p_draft;
  -- A guard trigger may not rewrite this: the post must really be off the schedule when we say so.
  IF EXISTS (SELECT 1 FROM public.carousel_drafts WHERE id = p_draft AND (status = 'scheduled' OR scheduled_at IS NOT NULL))
     OR EXISTS (SELECT 1 FROM public.scheduled_posts WHERE clickup_task_id = p_draft::text AND status IN ('pending', 'posting')) THEN
    RAISE EXCEPTION 'Not pulled: it could not be taken off the schedule.' USING ERRCODE = 'P0001', HINT = 'next_busy'; END IF;
  INSERT INTO public.content_owner_pulls (draft_id, was_at, reason, actor)
  VALUES (p_draft, v_was, p_reason, public.cb39_implicit_actor())
  ON CONFLICT (draft_id) DO UPDATE SET was_at = excluded.was_at, reason = excluded.reason, actor = excluded.actor, pulled_at = now();
  RETURN jsonb_build_object('ok', true, 'id', p_draft, 'pulled', true, 'was_at', v_was, 'queue_cancelled', v_n, 'status', 'review', 'scheduled_at', NULL);
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
  RAISE EXCEPTION 'Not pulled: it is being changed right now. Try again.' USING ERRCODE = 'P0001', HINT = 'next_busy';
END $function$;

-- Ivan's Pull on one upcoming post (the Next and Held rows). p_slot_at: the time the row showed him.
CREATE OR REPLACE FUNCTION public.content_next_pull(p_queue uuid, p_slot_at timestamptz) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '3s' SET statement_timeout TO '20s'
AS $function$
DECLARE v_draft uuid;
BEGIN
  IF NOT public.content_owner_ok_ivan() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_queue IS NULL OR p_slot_at IS NULL THEN RAISE EXCEPTION 'bad request' USING ERRCODE = '22023'; END IF;
  SELECT d.id INTO v_draft FROM public.scheduled_posts q JOIN public.carousel_drafts d ON d.id::text = q.clickup_task_id
   WHERE q.id = p_queue AND q.platform = 'linkedin' AND q.status = 'pending' AND coalesce(q.is_repost, false) = false
     AND d.client_id IS NULL AND q.scheduled_at = p_slot_at;
  IF v_draft IS NULL THEN
    RAISE EXCEPTION 'Not pulled: this post changed or is no longer waiting to go out. Look at it again.' USING ERRCODE = 'P0001', HINT = 'next_changed'; END IF;
  RETURN public.content_owner_pull_ivan(v_draft, p_slot_at, 'Pull on the Review row');
END $function$;

REVOKE ALL ON FUNCTION public.content_owner_pull_ivan(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_next_pull(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_owner_pull_ivan(uuid, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.content_next_pull(uuid, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.content_autonomy_base_ivan(p_draft uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.carousel_drafts%ROWTYPE; m public.cb34_p2_members%ROWTYPE;
 f text[]:='{}'; k text; sp jsonb; v jsonb;
BEGIN
 IF coalesce(public.content_autonomy_policy_ivan()->>'complete','false')<>'true' THEN f:=f||'canonical policy is missing required rows'::text; END IF;
 SELECT * INTO d FROM public.carousel_drafts WHERE id=p_draft;
 IF NOT FOUND OR d.client_id IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'fails',jsonb_build_array('not an Ivan draft')); END IF;
 IF d.status IS NULL OR d.status NOT IN ('review','approved','scheduled') OR d.published_at IS NOT NULL THEN f:=f||'draft is not publishable review supply'::text; END IF;
 IF coalesce(d.taxonomy->>'deleted_by_operator','')='true' OR coalesce(d.taxonomy->>'internal_test','')='true' THEN f:=f||'deleted or internal test'::text; END IF;
 IF nullif(btrim(d.post_body),'') IS NULL THEN f:=f||'empty post'::text; END IF;
 IF coalesce(d.qa->>'verdict','')<>'PASS' OR jsonb_typeof(d.qa)<>'object' THEN f:=f||'exact final QA PASS is required'::text; END IF;
 IF coalesce(d.taxonomy->>'qa_override','')='true' THEN f:=f||'manual QA override is not automatic approval'::text; END IF;
 IF coalesce(d.qa->>'prep_status','')='HOLD' THEN f:=f||'source preparation is held'::text; END IF;
 sp:=d.qa->'writer_source_pack';
 IF jsonb_typeof(sp) IS DISTINCT FROM 'object' OR sp->>'body' IS DISTINCT FROM d.post_body OR nullif(btrim(sp->>'text'),'') IS NULL THEN
  f:=f||'exact final source pack is missing or stale'::text;
 END IF;
 IF EXISTS(SELECT 1 FROM public.cb39_draft_verdicts WHERE draft_id=d.id AND verdict='drop') THEN f:=f||'Ivan dropped this draft'::text; END IF;
 -- 2026-11-14: a post Ivan pulled off the schedule is never placed again by a machine. His own new date is his call
 -- (the rule applies only while the draft has no date).
 IF d.scheduled_at IS NULL AND EXISTS(SELECT 1 FROM public.content_owner_pulls op WHERE op.draft_id=d.id) THEN f:=f||'you pulled it from the schedule'::text; END IF;
 IF d.post_body ~* '(https?://|www\.)[^\s]+' AND NOT (coalesce(d.taxonomy->>'paid_boost','')='true' AND coalesce(d.taxonomy->>'lead_magnet','')='true') THEN f:=f||'links require a paid lead magnet'::text; END IF;
 IF d.type NOT IN ('text','single_image','carousel','pdf','document','video') OR d.type IS NULL THEN f:=f||'unsupported final format'::text; END IF;
 IF d.type IN ('text','single_image') AND coalesce(cardinality(d.image_urls),0)>1 THEN f:=f||'automatic gallery is unsupported by the publisher'::text; END IF;
 IF d.type='single_image' AND coalesce(cardinality(d.image_urls),0)=0 THEN f:=f||'final image is missing'::text; END IF;
 IF d.type IN ('carousel','pdf','document') AND nullif(d.pdf_url,'') IS NULL THEN f:=f||'final document is missing'::text; END IF;
 IF d.type='video' AND nullif(d.video_url,'') IS NULL THEN f:=f||'final video is missing'::text; END IF;
 SELECT * INTO m FROM public.cb34_p2_members WHERE draft_id=d.id;
 IF FOUND THEN
  v:=m.validation;
  IF m.client_id IS DISTINCT FROM 'ivan' OR m.state IS DISTINCT FROM 'released' OR coalesce(v->>'verdict','')<>'PASS' THEN f:=f||'brain verifier has not released the draft'::text; END IF;
  IF v->>'input_body_sha256' IS DISTINCT FROM encode(sha256(convert_to(coalesce(d.post_body,''),'UTF8')),'hex') THEN f:=f||'brain verifier checked different text'::text; END IF;
  FOREACH k IN ARRAY ARRAY['qa','invention','lint','sameness','length'] LOOP
   IF coalesce(v->'checks'->k->>'pass','')<>'true' THEN f:=f||('brain check missing or failed: '||k); END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('eligible',cardinality(f)=0,'fails',to_jsonb(f));
END $function$;

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
  -- 2026-11-14: removing the date from a post of Ivan's that is already scheduled is a pull: the queued copy is
  -- cancelled and the draft returns to Review. Before this the queue row stayed pending and the post still went out.
  if p_scheduled_at is null and d.client_id is null and d.status = 'scheduled' then
    return public.content_owner_pull_ivan(d.id, null, 'date removed in the calendar')
      || jsonb_build_object('requested_at', null, 'queue_retimed', 0, 'sync_request_id', null);
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
     -- 2026-11-14: a null date changes the draft only if it is still in the status and lane read above.
     and (p_scheduled_at is not null or (status = d.status and client_id is not distinct from d.client_id))
   returning scheduled_at into v_at;
  if not found then
    perform set_config('app.schedule_manual', '', true);
    return jsonb_build_object('ok', false, 'error', 'changed', 'message', 'This post changed while you were editing. Try again.');
  end if;
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
end; $function$;

CREATE OR REPLACE FUNCTION public.scheduled_post_claim_if_unchanged(p_id uuid, p_expected jsonb, p_publisher_account text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '5s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE q public.scheduled_posts%rowtype; k text; own_ivan boolean; linked_client text; linked boolean; preserved_slot boolean:=false; hand_dated boolean:=false; frozen_policy jsonb; auto_gate jsonb; auto_files jsonb; auto_payload jsonb; owner_keep jsonb;
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
  -- 2026-11-14: a post Ivan pulled off the schedule goes out only once he has dated it again himself, at exactly this
  -- queue time. A queue row that comes back to pending any other way is never claimed.
  IF own_ivan AND linked AND EXISTS(SELECT 1 FROM public.content_owner_pulls op JOIN public.carousel_drafts d ON d.id=op.draft_id
       WHERE d.id::text=q.clickup_task_id)
     AND NOT EXISTS(SELECT 1 FROM public.carousel_drafts d WHERE d.id::text=q.clickup_task_id
       AND d.status='scheduled' AND d.scheduled_at=q.scheduled_at AND d.published_at IS NULL) THEN
    RETURN jsonb_build_object('claimed',false,'reason','owner_pulled'); END IF;
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
    -- 2026-11-14: Ivan's own Keep of exactly this queue row, slot, text and file bytes stands in for the automatic review.
    -- The publisher must present the keep's token and the file hashes it just re-computed.
    owner_keep:=public.content_owner_keep_ivan(q.id);
    IF owner_keep IS NOT NULL THEN
      IF p_expected->>'autonomy_manifest_sha256' IS DISTINCT FROM owner_keep->>'token' THEN RETURN jsonb_build_object('claimed',false,'reason','autonomy_manifest_stale'); END IF;
      IF p_expected->'autonomy_asset_files' IS DISTINCT FROM owner_keep->'files' THEN RETURN jsonb_build_object('claimed',false,'reason','autonomy_assets_unverified'); END IF;
    ELSE
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
END $function$;

COMMIT;
