-- Rollback of 20261114_owner_keep.sql. Restores the two publisher functions byte for byte and removes the keep objects.
-- Any post that was going out on Ivan's Keep goes back to needing the automatic review (GIF posts hold again).
BEGIN;
-- Never roll back while one of Ivan's posts is mid-publish: a post claimed on a keep needs the keep-aware hold
-- (content_autonomy_hold_claim_ivan) until its upload check has finished. The publisher claims under this same lock.
DO $guard$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('content-plan:ivan', 0));
  IF EXISTS (SELECT 1 FROM public.scheduled_posts q LEFT JOIN public.carousel_drafts d ON d.id::text = q.clickup_task_id
              WHERE q.platform = 'linkedin' AND q.status = 'posting' AND (d.id IS NULL OR d.client_id IS NULL)) THEN
    RAISE EXCEPTION 'rollback refused: a post of Ivan''s is being published right now; run it again in a few minutes';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.content_autonomy_publish_snapshot_ivan(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE q public.scheduled_posts%ROWTYPE; d public.carousel_drafts%ROWTYPE; g jsonb; frozen jsonb; preserved boolean; payload jsonb; k text;
BEGIN
 IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
 SELECT * INTO q FROM public.scheduled_posts WHERE id=p_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('required',false,'eligible',false,'error','missing_queue_row'); END IF;
 SELECT * INTO d FROM public.carousel_drafts WHERE id::text=q.clickup_task_id;
 IF NOT FOUND OR d.client_id IS NOT NULL OR q.platform<>'linkedin' THEN RETURN jsonb_build_object('required',false,'eligible',true); END IF;
 SELECT value::jsonb INTO frozen FROM public.integration_config WHERE key='ivan_publisher_existing_slot_exemptions_20261017';
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(frozen->'slots') x WHERE frozen->>'client_id'='ivan'
  AND x->>'queue_id'=q.id::text AND x->>'draft_id'=q.clickup_task_id AND (x->>'scheduled_at')::timestamptz=q.scheduled_at) INTO preserved;
 IF preserved OR NOT (EXISTS(SELECT 1 FROM public.content_autopilot_picks ap WHERE ap.account='ivan' AND ap.draft_id=d.id) OR EXISTS(SELECT 1 FROM public.content_plan_slots ps WHERE ps.account='ivan' AND ps.placed_draft_id=d.id AND ps.placement_kind='autopilot'))
 THEN RETURN jsonb_build_object('required',false,'eligible',true); END IF;
 payload:=public.content_autonomy_queue_payload_ivan(d.id);
 FOREACH k IN ARRAY ARRAY['post_text','post_format','media_urls'] LOOP
  IF to_jsonb(q)->k IS DISTINCT FROM payload->k THEN RETURN jsonb_build_object('required',true,'eligible',false,'fails',jsonb_build_array('queue differs from reviewed final payload: '||k)); END IF;
 END LOOP;
 IF coalesce(q.is_repost,false) THEN RETURN jsonb_build_object('required',true,'eligible',false,'fails',jsonb_build_array('automatic pick cannot become a repost')); END IF;
 g:=public.content_autonomy_gate_ivan(d.id);
 IF NOT EXISTS(SELECT 1 FROM public.content_autopilot_picks ap WHERE ap.account='ivan' AND ap.draft_id=d.id
  AND ap.state='armed' AND ap.slot_at=q.scheduled_at AND d.status='scheduled' AND d.scheduled_at=q.scheduled_at AND d.published_at IS NULL AND ap.body_sha256=encode(sha256(convert_to(d.post_body,'UTF8')),'hex'))
 THEN RETURN jsonb_build_object('required',true,'eligible',false,'fails',jsonb_build_array('automatic pick is held or stale')); END IF;
 RETURN jsonb_build_object('required',true,'eligible',g->'eligible','fails',g->'fails',
  'manifest_sha256',g->'manifest_sha256','files',coalesce(d.qa->'autonomous_review'->'assets'->'files','[]'::jsonb),
  'expected',public.content_autonomy_manifest_ivan(d.id));
END $function$;

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
END $function$;

CREATE OR REPLACE FUNCTION public.content_autonomy_hold_claim_ivan(p_id uuid, p_expected jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '2s'
AS $function$
DECLARE q public.scheduled_posts%ROWTYPE; k text; snapshot jsonb;
BEGIN
 IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
 IF p_id IS NULL OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object' OR p_expected->>'id' IS DISTINCT FROM p_id::text THEN RETURN jsonb_build_object('held',false,'reason','invalid_snapshot'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('content-plan:ivan',0));
 SELECT * INTO q FROM public.scheduled_posts WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR q.status<>'posting' OR q.platform<>'linkedin' THEN RETURN jsonb_build_object('held',false,'reason','not_posting'); END IF;
 snapshot:=public.content_autonomy_publish_snapshot_ivan(p_id);
 IF snapshot->>'required' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('held',false,'reason','not_an_automatic_ivan_pick'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.content_autopilot_picks ap JOIN public.carousel_drafts d ON d.id=ap.draft_id
   WHERE ap.account='ivan' AND ap.draft_id::text=q.clickup_task_id AND d.client_id IS NULL AND ap.state='armed' AND ap.slot_at=q.scheduled_at)
 THEN RETURN jsonb_build_object('held',false,'reason','not_an_automatic_ivan_pick'); END IF;
 FOREACH k IN ARRAY ARRAY['id','status','scheduled_at','clickup_task_id','post_text','post_format','media_urls','platform','ig_caption','ig_dm_keyword','ig_dm_reply','is_repost','post_kind'] LOOP
  IF NOT p_expected ? k OR to_jsonb(q)->k IS DISTINCT FROM p_expected->k THEN RETURN jsonb_build_object('held',false,'reason','snapshot_changed'); END IF;
 END LOOP;
 UPDATE public.scheduled_posts SET status='blocked',error_message='Automatic content held: final asset bytes failed verification against the reviewed files.' WHERE id=q.id AND status='posting';
 RETURN jsonb_build_object('held',true,'reason','final_asset_verification_failed');
END $function$;

DROP FUNCTION IF EXISTS public.content_next_posts();
DROP FUNCTION IF EXISTS public.content_next_keep(uuid, timestamptz, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.content_autonomy_publish_state_ivan(uuid);
DROP FUNCTION IF EXISTS public.content_owner_keep_ivan(uuid);
DROP FUNCTION IF EXISTS public.content_owner_keep_urls(uuid);
-- The keep rows are kept for the record under a new name; nothing reads them after this.
DROP TRIGGER IF EXISTS zzzz_content_owner_keeps_void ON public.carousel_drafts;
DROP TRIGGER IF EXISTS zzzz_content_owner_keeps_void ON public.scheduled_posts;
DROP FUNCTION IF EXISTS public.content_owner_keeps_void();
DROP FUNCTION IF EXISTS public.content_owner_keep_token(uuid);
DROP FUNCTION IF EXISTS public.content_owner_ok_ivan();
DROP TABLE IF EXISTS public.content_owner_accounts;
DROP TRIGGER IF EXISTS content_owner_keeps_guard ON public.content_owner_keeps;
ALTER TABLE IF EXISTS public.content_owner_keeps RENAME TO content_owner_keeps_rolled_back_20261114;
DROP FUNCTION IF EXISTS public.content_owner_keeps_guard();
COMMIT;
