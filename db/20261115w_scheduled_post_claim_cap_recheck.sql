BEGIN;

-- 2026-11-15: daily post cap rechecked inside the claim (Scheduled Post Publisher 0Ym6bP7gEmskPJZn, card 9b368b99).
--
-- Why. The publisher's cap check called linkedin_check_and_increment before the claim, and its gate ignored the answer
-- (the RPC returns a bare boolean; the gate read $json.allowed ?? true). The RPC also counted every refused 5-minute
-- retry, so a working gate would have stopped real posts. The publisher now does a read-only first look before the claim
-- and this function rechecks the same count under its existing advisory lock, right before pending -> posting, so two
-- overlapping runs cannot both pass (Sol round 2). Only that one block is added; every existing check is unchanged.
-- Base: the LIVE definition read with pg_get_functiondef on 2026-11-15 (identical to 20261114c's).

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
  -- 2026-11-15 daily post cap, rechecked HERE under the account lock taken above, right before the claim, for both
  -- platforms. The publisher's own read-only check before the claim is only a first look: two overlapping runs can
  -- both pass it. Counts the queue's other rows on the same platform that are in flight or went out since 00:00 UTC
  -- (the limits linkedin_check_and_increment used: 2 LinkedIn, 10 Instagram). A refusal returns before any write.
  IF (SELECT count(*) FROM public.scheduled_posts x
      WHERE x.id<>q.id AND x.platform IS NOT DISTINCT FROM q.platform
        AND (x.status='posting'
          OR (x.status='posted' AND x.posted_at>=(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))))
     >= (CASE WHEN q.platform='instagram' THEN 10 ELSE 2 END) THEN
    RETURN jsonb_build_object('claimed',false,'reason','daily_post_cap_reached'); END IF;
  UPDATE public.scheduled_posts SET status='posting' WHERE id=q.id AND status='pending'
    AND scheduled_at=q.scheduled_at AND scheduled_at<=now() RETURNING * INTO q;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','claim_lost'); END IF;
  RETURN jsonb_build_object('claimed',true,'post',to_jsonb(q));
END $function$;

COMMIT;
