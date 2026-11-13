-- Rolled-back test of 20261114_owner_keep.sql against the live queue. Nothing is committed: the block always ends in an exception.
DO $t$
DECLARE res jsonb := '{}'::jsonb; before jsonb; after jsonb; s jsonb; r jsonb; x jsonb; files jsonb; sha text; tok text;
  UD text := '6fda2a13-441e-4a95-ac41-c392a48ea904';
  OWNER text := '{"sub":"6fda2a13-441e-4a95-ac41-c392a48ea904","role":"authenticated"}';
  qg uuid := 'ab3e40e3-7071-488a-9946-21277fde3532'; dg uuid;   -- 20 Nov, autopilot, GIF attached
  qp uuid := '64803ecd-3401-4587-942f-1f11298a681e'; dp uuid;   -- 13 Nov, autopilot, text only, slot passed
  qh uuid := 'c4ed92bf-52d8-461d-96bb-1de113a89d89';            -- 16 Nov, hand placed
  qrow public.scheduled_posts%ROWTYPE; msg text; hint text; sqlst text; orig text[]; fmt_g text; med_g jsonb;
BEGIN
  SELECT jsonb_object_agg(q.id, public.content_autonomy_publish_snapshot_ivan(q.id)) INTO before
    FROM public.scheduled_posts q WHERE q.platform = 'linkedin' AND q.status = 'pending';

  EXECUTE $mig$
-- 2026-11-14: Ivan's own look ("Keep") on a scheduled autopilot post.
--
-- Why. A post the autopilot placed must pass the automatic review at publish time. Three cases left such a post
-- scheduled and silently unpublishable, with no way for Ivan to clear it:
--   1. an animated GIF attachment (the sighted reviewer reads only its first frame, so the gate holds every GIF);
--   2. Ivan edits the text of the scheduled post (the writer source pack no longer matches, the base check fails);
--   3. Ivan re-dates it by hand (the autopilot pick stays armed at the old slot).
-- A keep is Ivan's approval of one exact publication: this queue row, this slot, this text, these file bytes.
-- It is written only by content_next_keep under his login. While it matches, the publisher accepts it in place of
-- the automatic review and still re-hashes every file at posting time. Any change to slot, text or files voids it.

CREATE TABLE IF NOT EXISTS public.content_owner_keeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.carousel_drafts(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL,
  slot_at timestamptz NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  post_format text NOT NULL,
  media_urls jsonb NOT NULL CHECK (jsonb_typeof(media_urls) = 'array'),   -- the queued attachments, in posting order
  files jsonb NOT NULL CHECK (jsonb_typeof(files) = 'array'),
  actor_uid uuid NOT NULL,
  kept_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS content_owner_keeps_live ON public.content_owner_keeps (draft_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS content_owner_keeps_queue ON public.content_owner_keeps (queue_id);
ALTER TABLE public.content_owner_keeps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_owner_keeps FROM PUBLIC, anon, authenticated;

-- The one login that may approve a publication on an account. A read entitlement on the lane is not enough.
CREATE TABLE IF NOT EXISTS public.content_owner_accounts (
  account text PRIMARY KEY,
  owner_uid uuid NOT NULL
);
ALTER TABLE public.content_owner_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_owner_accounts FROM PUBLIC, anon, authenticated;
INSERT INTO public.content_owner_accounts (account, owner_uid) VALUES ('ivan', '6fda2a13-441e-4a95-ac41-c392a48ea904')
  ON CONFLICT (account) DO NOTHING;

CREATE OR REPLACE FUNCTION public.content_owner_ok_ivan() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(auth.uid() IS NOT NULL AND coalesce(auth.role(), '') = 'authenticated'
    AND EXISTS (SELECT 1 FROM public.content_owner_accounts o WHERE o.account = 'ivan' AND o.owner_uid = auth.uid())
    AND public.cb34_p2_operator_lane_allowed('ivan'), false)
$function$;

-- A keep row can only be created inside Ivan's own signed-in request, and its content never changes afterwards
-- (only revoked_at may be set). A machine holding the service key cannot mint one by accident.
CREATE OR REPLACE FUNCTION public.content_owner_keeps_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL OR NEW.actor_uid IS DISTINCT FROM auth.uid() OR NOT public.content_owner_ok_ivan() THEN
      RAISE EXCEPTION 'a keep is written only by the owner' USING ERRCODE = '42501';
    END IF;
    IF NEW.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'a keep starts live' USING ERRCODE = '22023'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at')
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'a keep is immutable; revoke it and write a new one' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS content_owner_keeps_guard ON public.content_owner_keeps;
CREATE TRIGGER content_owner_keeps_guard BEFORE INSERT OR UPDATE ON public.content_owner_keeps
  FOR EACH ROW EXECUTE FUNCTION public.content_owner_keeps_guard();

-- The final URLs the publisher hashes for a draft (same set and order as ivanAssetUrls in the publisher and the gate).
CREATE OR REPLACE FUNCTION public.content_owner_keep_urls(p_draft uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT coalesce((SELECT jsonb_agg(x ORDER BY x) FROM (
   SELECT DISTINCT u AS x FROM unnest(coalesce(d.image_urls, '{}'::text[]) || ARRAY[d.pdf_url, d.video_url]) u WHERE nullif(u, '') IS NOT NULL) a), '[]'::jsonb)
 FROM public.carousel_drafts d WHERE d.id = p_draft AND d.client_id IS NULL;
$function$;

-- The keep's token: what the publisher must present at the claim and at the post-claim hold. Computed from the row alone,
-- so a keep revoked after the claim still identifies the publication that was claimed on it.
CREATE OR REPLACE FUNCTION public.content_owner_keep_token(p_keep uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT encode(sha256(convert_to(k.id::text || '|' || k.draft_id::text || '|' || k.queue_id::text || '|'
    || extract(epoch FROM k.slot_at)::text || '|' || k.body_sha256 || '|' || k.post_format || '|' || k.media_urls::text || '|' || k.files::text, 'UTF8')), 'hex')
    FROM public.content_owner_keeps k WHERE k.id = p_keep
$function$;

-- The live keep for a queue row, or NULL. NULL means "no owner approval of exactly what is queued now".
CREATE OR REPLACE FUNCTION public.content_owner_keep_ivan(p_queue uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE q public.scheduled_posts%ROWTYPE; d public.carousel_drafts%ROWTYPE; k public.content_owner_keeps%ROWTYPE;
  payload jsonb; urls jsonb; kurls jsonb; fld text;
BEGIN
  SELECT * INTO q FROM public.scheduled_posts WHERE id = p_queue;
  IF NOT FOUND OR q.platform IS DISTINCT FROM 'linkedin' OR q.status IS DISTINCT FROM 'pending'
     OR coalesce(q.is_repost, false) OR q.scheduled_at IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO d FROM public.carousel_drafts WHERE id::text = q.clickup_task_id AND client_id IS NULL;
  IF NOT FOUND OR d.status IS DISTINCT FROM 'scheduled' OR d.published_at IS NOT NULL
     OR d.scheduled_at IS DISTINCT FROM q.scheduled_at OR nullif(btrim(d.post_body), '') IS NULL
     OR coalesce(d.taxonomy ->> 'deleted_by_operator', '') = 'true' OR coalesce(d.taxonomy ->> 'internal_test', '') = 'true'
     OR EXISTS (SELECT 1 FROM public.cb39_draft_verdicts v WHERE v.draft_id = d.id AND v.verdict = 'drop') THEN RETURN NULL; END IF;
  payload := public.content_autonomy_queue_payload_ivan(d.id);
  FOREACH fld IN ARRAY ARRAY['post_text', 'post_format', 'media_urls'] LOOP
    IF to_jsonb(q) -> fld IS DISTINCT FROM payload -> fld THEN RETURN NULL; END IF;
  END LOOP;
  SELECT * INTO k FROM public.content_owner_keeps WHERE draft_id = d.id AND revoked_at IS NULL;
  IF NOT FOUND OR k.queue_id <> q.id OR k.slot_at <> q.scheduled_at
     OR k.body_sha256 <> encode(sha256(convert_to(d.post_body, 'UTF8')), 'hex')
     OR k.post_format IS DISTINCT FROM payload ->> 'post_format' OR k.media_urls IS DISTINCT FROM payload -> 'media_urls' THEN RETURN NULL; END IF;
  urls := public.content_owner_keep_urls(d.id);
  SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) INTO kurls FROM (
    SELECT DISTINCT z ->> 'url' AS x FROM jsonb_array_elements(k.files) z
     WHERE jsonb_typeof(z) = 'object' AND z ->> 'sha256' ~ '^[0-9a-f]{64}$' AND coalesce((z ->> 'bytes') ~ '^[1-9][0-9]*$', false)) a;
  IF kurls IS DISTINCT FROM urls OR jsonb_array_length(k.files) <> jsonb_array_length(urls) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('keep_id', k.id, 'kept_at', k.kept_at, 'files', k.files, 'token', public.content_owner_keep_token(k.id));
END $function$;

-- Any committed change to what would be posted ends the keep for good: moving a post away and back, or swapping
-- the attachments and swapping them back, never brings an old approval back to life.
CREATE OR REPLACE FUNCTION public.content_owner_keeps_void() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'carousel_drafts' THEN
    UPDATE public.content_owner_keeps SET revoked_at = now() WHERE draft_id = NEW.id AND revoked_at IS NULL;
  ELSE
    UPDATE public.content_owner_keeps SET revoked_at = now() WHERE queue_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS zzzz_content_owner_keeps_void ON public.carousel_drafts;
CREATE TRIGGER zzzz_content_owner_keeps_void
  AFTER UPDATE OF scheduled_at, post_body, type, image_urls, pdf_url, video_url, status, taxonomy ON public.carousel_drafts
  FOR EACH ROW WHEN (NEW.client_id IS NULL AND (
       OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at OR OLD.post_body IS DISTINCT FROM NEW.post_body
    OR OLD.type IS DISTINCT FROM NEW.type OR OLD.image_urls IS DISTINCT FROM NEW.image_urls
    OR OLD.pdf_url IS DISTINCT FROM NEW.pdf_url OR OLD.video_url IS DISTINCT FROM NEW.video_url
    OR (OLD.status = 'scheduled' AND NEW.status IS DISTINCT FROM 'scheduled')
    OR (OLD.taxonomy ->> 'deleted_by_operator') IS DISTINCT FROM (NEW.taxonomy ->> 'deleted_by_operator')
    OR (OLD.taxonomy ->> 'internal_test') IS DISTINCT FROM (NEW.taxonomy ->> 'internal_test')))
  EXECUTE FUNCTION public.content_owner_keeps_void();
DROP TRIGGER IF EXISTS zzzz_content_owner_keeps_void ON public.scheduled_posts;
CREATE TRIGGER zzzz_content_owner_keeps_void
  AFTER UPDATE OF scheduled_at, post_text, post_format, media_urls, clickup_task_id, platform, is_repost ON public.scheduled_posts
  FOR EACH ROW WHEN (OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at OR OLD.post_text IS DISTINCT FROM NEW.post_text
    OR OLD.post_format IS DISTINCT FROM NEW.post_format OR OLD.media_urls IS DISTINCT FROM NEW.media_urls
    OR OLD.clickup_task_id IS DISTINCT FROM NEW.clickup_task_id OR OLD.platform IS DISTINCT FROM NEW.platform
    OR OLD.is_repost IS DISTINCT FROM NEW.is_repost)
  EXECUTE FUNCTION public.content_owner_keeps_void();

REVOKE ALL ON FUNCTION public.content_owner_keeps_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_owner_keep_urls(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_owner_keep_ivan(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_owner_keep_token(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_owner_keeps_void() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_owner_ok_ivan() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_owner_keep_token(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.content_owner_ok_ivan() TO service_role;
GRANT EXECUTE ON FUNCTION public.content_owner_keep_urls(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.content_owner_keep_ivan(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.content_autonomy_publish_state_ivan(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE q public.scheduled_posts%ROWTYPE; d public.carousel_drafts%ROWTYPE; g jsonb; frozen jsonb; preserved boolean; payload jsonb; k text; keep jsonb;
BEGIN
 SELECT * INTO q FROM public.scheduled_posts WHERE id=p_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('required',false,'eligible',false,'error','missing_queue_row'); END IF;
 SELECT * INTO d FROM public.carousel_drafts WHERE id::text=q.clickup_task_id;
 IF NOT FOUND OR d.client_id IS NOT NULL OR q.platform<>'linkedin' THEN RETURN jsonb_build_object('required',false,'eligible',true); END IF;
 SELECT value::jsonb INTO frozen FROM public.integration_config WHERE key='ivan_publisher_existing_slot_exemptions_20261017';
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(frozen->'slots') x WHERE frozen->>'client_id'='ivan'
  AND x->>'queue_id'=q.id::text AND x->>'draft_id'=q.clickup_task_id AND (x->>'scheduled_at')::timestamptz=q.scheduled_at) INTO preserved;
 IF preserved OR NOT (EXISTS(SELECT 1 FROM public.content_autopilot_picks ap WHERE ap.account='ivan' AND ap.draft_id=d.id) OR EXISTS(SELECT 1 FROM public.content_plan_slots ps WHERE ps.account='ivan' AND ps.placed_draft_id=d.id AND ps.placement_kind='autopilot'))
 THEN RETURN jsonb_build_object('required',false,'eligible',true); END IF;
 -- 2026-11-14: Ivan's own Keep of exactly this queue row, slot, text and file bytes stands in for the automatic review.
 -- The publisher still re-hashes every file against keep.files before it posts.
 keep:=public.content_owner_keep_ivan(q.id);
 IF keep IS NOT NULL THEN RETURN jsonb_build_object('required',true,'eligible',true,'fails','[]'::jsonb,'owner_keep',true,
  'manifest_sha256',keep->>'token','files',keep->'files','expected',public.content_autonomy_manifest_ivan(d.id)); END IF;
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


REVOKE ALL ON FUNCTION public.content_autonomy_publish_state_ivan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_autonomy_publish_state_ivan(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.content_autonomy_publish_snapshot_ivan(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
 RETURN public.content_autonomy_publish_state_ivan(p_id);
END $function$;

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

CREATE OR REPLACE FUNCTION public.content_autonomy_hold_claim_ivan(p_id uuid, p_expected jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '2s'
AS $function$
DECLARE q public.scheduled_posts%ROWTYPE; k text; snapshot jsonb; owner_claim boolean;
BEGIN
 IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
 IF p_id IS NULL OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object' OR p_expected->>'id' IS DISTINCT FROM p_id::text THEN RETURN jsonb_build_object('held',false,'reason','invalid_snapshot'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('content-plan:ivan',0));
 SELECT * INTO q FROM public.scheduled_posts WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR q.status<>'posting' OR q.platform<>'linkedin' THEN RETURN jsonb_build_object('held',false,'reason','not_posting'); END IF;
 -- 2026-11-14: a row claimed on Ivan's Keep is identified by the keep token the claim carried, read from the keep row itself
 -- (live or since revoked), so a byte mismatch after the claim always parks it, whatever the draft or its pick say now.
 owner_claim:=coalesce(p_expected->>'autonomy_manifest_sha256','') ~ '^[0-9a-f]{64}$' AND EXISTS(SELECT 1 FROM public.content_owner_keeps ok
   WHERE ok.queue_id=q.id AND public.content_owner_keep_token(ok.id)=p_expected->>'autonomy_manifest_sha256');
 IF NOT owner_claim THEN
 snapshot:=public.content_autonomy_publish_snapshot_ivan(p_id);
 IF snapshot->>'required' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('held',false,'reason','not_an_automatic_ivan_pick'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.content_autopilot_picks ap JOIN public.carousel_drafts d ON d.id=ap.draft_id
   WHERE ap.account='ivan' AND ap.draft_id::text=q.clickup_task_id AND d.client_id IS NULL AND ap.state='armed' AND ap.slot_at=q.scheduled_at)
 THEN RETURN jsonb_build_object('held',false,'reason','not_an_automatic_ivan_pick'); END IF;
 END IF;
 FOREACH k IN ARRAY ARRAY['id','status','scheduled_at','clickup_task_id','post_text','post_format','media_urls','platform','ig_caption','ig_dm_keyword','ig_dm_reply','is_repost','post_kind'] LOOP
  IF NOT p_expected ? k OR to_jsonb(q)->k IS DISTINCT FROM p_expected->k THEN RETURN jsonb_build_object('held',false,'reason','snapshot_changed'); END IF;
 END LOOP;
 UPDATE public.scheduled_posts SET status='blocked',error_message='Automatic content held: final asset bytes failed verification against the reviewed files.' WHERE id=q.id AND status='posting';
 RETURN jsonb_build_object('held',true,'reason','final_asset_verification_failed');
END $function$;

-- Ivan's Keep on one upcoming post. p_slot_at, p_post_format, p_media_urls: the time, the format and the attachments
-- in posting order, exactly as the row showed them (content_next_posts). p_files: what his browser actually fetched and showed, hashed there:
-- [{url, sha256, bytes}] for every final URL of the draft (empty array for a text-only post).
CREATE OR REPLACE FUNCTION public.content_next_keep(p_queue uuid, p_slot_at timestamptz, p_body_sha text, p_post_format text, p_media_urls jsonb, p_files jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '3s' SET statement_timeout TO '20s'
AS $function$
DECLARE q public.scheduled_posts%ROWTYPE; d public.carousel_drafts%ROWTYPE; payload jsonb; urls jsonb; furls jsonb;
  files jsonb; total numeric; fld text; kid uuid;
BEGIN
  IF NOT public.content_owner_ok_ivan() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_post_format IS NULL OR jsonb_typeof(p_media_urls) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'bad request' USING ERRCODE = '22023'; END IF;
  IF p_queue IS NULL OR p_slot_at IS NULL OR p_body_sha IS NULL OR p_body_sha !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_files) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'bad request' USING ERRCODE = '22023'; END IF;
  BEGIN
    -- Same order as the calendar functions and the publisher claim: account lock, then queue row, then draft.
    PERFORM pg_advisory_xact_lock(hashtextextended('content-plan:ivan', 0));
    SELECT * INTO q FROM public.scheduled_posts WHERE id = p_queue FOR UPDATE;
    IF NOT FOUND OR q.platform IS DISTINCT FROM 'linkedin' OR q.status IS DISTINCT FROM 'pending' OR coalesce(q.is_repost, false) THEN
      RAISE EXCEPTION 'Not kept: this post is no longer waiting to go out.' USING ERRCODE = 'P0001', HINT = 'next_gone'; END IF;
    SELECT * INTO d FROM public.carousel_drafts WHERE id::text = q.clickup_task_id AND client_id IS NULL FOR UPDATE;
    IF NOT FOUND OR d.status IS DISTINCT FROM 'scheduled' OR d.published_at IS NOT NULL OR d.scheduled_at IS DISTINCT FROM q.scheduled_at
       OR nullif(btrim(d.post_body), '') IS NULL
       OR coalesce(d.taxonomy ->> 'deleted_by_operator', '') = 'true' OR coalesce(d.taxonomy ->> 'internal_test', '') = 'true'
       OR EXISTS (SELECT 1 FROM public.cb39_draft_verdicts v WHERE v.draft_id = d.id AND v.verdict = 'drop') THEN
      RAISE EXCEPTION 'Not kept: this post is no longer waiting to go out.' USING ERRCODE = 'P0001', HINT = 'next_gone'; END IF;
    IF q.scheduled_at IS NULL OR q.scheduled_at <= now() THEN
      RAISE EXCEPTION 'Not kept: its time has passed. Give it a new time first.' USING ERRCODE = 'P0001', HINT = 'next_past'; END IF;
    IF q.scheduled_at IS DISTINCT FROM p_slot_at THEN
      RAISE EXCEPTION 'Not kept: its time changed. Look at it again.' USING ERRCODE = 'P0001', HINT = 'next_changed'; END IF;
    payload := public.content_autonomy_queue_payload_ivan(d.id);
    FOREACH fld IN ARRAY ARRAY['post_text', 'post_format', 'media_urls'] LOOP
      IF to_jsonb(q) -> fld IS DISTINCT FROM payload -> fld THEN
        RAISE EXCEPTION 'Not kept: the queued copy is still catching up with the draft. Try again in a minute.' USING ERRCODE = 'P0001', HINT = 'next_changed'; END IF;
    END LOOP;
    -- What he was shown: the same format and the same attachments in the same order as what is queued now.
    IF payload ->> 'post_format' IS DISTINCT FROM p_post_format OR payload -> 'media_urls' IS DISTINCT FROM p_media_urls THEN
      RAISE EXCEPTION 'Not kept: the attachment changed. Look at it again.' USING ERRCODE = 'P0001', HINT = 'next_changed'; END IF;
    IF encode(sha256(convert_to(d.post_body, 'UTF8')), 'hex') <> p_body_sha THEN
      RAISE EXCEPTION 'Not kept: the text changed. Read it again.' USING ERRCODE = 'P0001', HINT = 'next_changed'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_files) z WHERE jsonb_typeof(z) IS DISTINCT FROM 'object'
        OR jsonb_typeof(z -> 'url') IS DISTINCT FROM 'string' OR coalesce(z ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
        OR jsonb_typeof(z -> 'bytes') IS DISTINCT FROM 'number' OR coalesce(z ->> 'bytes', '') !~ '^[1-9][0-9]*$') THEN
      RAISE EXCEPTION 'bad request' USING ERRCODE = '22023'; END IF;
    urls := public.content_owner_keep_urls(d.id);
    SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) INTO furls FROM (SELECT DISTINCT z ->> 'url' AS x FROM jsonb_array_elements(p_files) z) a;
    IF furls IS DISTINCT FROM urls OR jsonb_array_length(p_files) <> jsonb_array_length(urls) THEN
      RAISE EXCEPTION 'Not kept: the attachment changed. Look at it again.' USING ERRCODE = 'P0001', HINT = 'next_changed'; END IF;
    -- The publisher re-hashes every file before posting and can do that only inside these limits (ivanInspectAssetFiles).
    SELECT coalesce(sum((z ->> 'bytes')::numeric), 0) INTO total FROM jsonb_array_elements(p_files) z;
    IF jsonb_array_length(p_files) > 16 OR total > 13 * 1024 * 1024
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_files) z
                   WHERE NOT starts_with(z ->> 'url', 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/')) THEN
      RAISE EXCEPTION 'Not kept: this attachment is too large to verify at posting time.' USING ERRCODE = 'P0001', HINT = 'next_unverifiable'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('url', z ->> 'url', 'sha256', z ->> 'sha256', 'bytes', (z ->> 'bytes')::bigint) ORDER BY z ->> 'url'), '[]'::jsonb)
      INTO files FROM jsonb_array_elements(p_files) z;
    UPDATE public.content_owner_keeps SET revoked_at = now() WHERE draft_id = d.id AND revoked_at IS NULL;
    INSERT INTO public.content_owner_keeps (draft_id, queue_id, slot_at, body_sha256, post_format, media_urls, files, actor_uid)
    VALUES (d.id, q.id, p_slot_at, p_body_sha, p_post_format, p_media_urls, files, auth.uid()) RETURNING id INTO kid;
  EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
    RAISE EXCEPTION 'Not kept: it is being changed right now. Try again.' USING ERRCODE = 'P0001', HINT = 'next_busy';
  END;
  RETURN jsonb_build_object('ok', true, 'keep_id', kid, 'slot_at', q.scheduled_at);
END $function$;

-- Ivan's upcoming posts with what the publisher would decide for each right now.
-- state: ready (will go out) | checking (the automatic check is re-running, nothing to do) | held (will NOT go out as it stands).
CREATE OR REPLACE FUNCTION public.content_next_posts() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
DECLARE out jsonb := '[]'::jsonb; r record; s jsonb; fails jsonb; st text;
BEGIN
  IF NOT public.content_owner_ok_ivan() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  FOR r IN
    SELECT q.id AS queue_id, d.id AS draft_id, q.scheduled_at, q.post_text, q.post_format, d.post_body, to_jsonb(q.media_urls) AS media_urls
      FROM public.scheduled_posts q JOIN public.carousel_drafts d ON d.id::text = q.clickup_task_id
     WHERE q.platform = 'linkedin' AND q.status = 'pending' AND coalesce(q.is_repost, false) = false AND d.client_id IS NULL
       AND q.scheduled_at > now() AND q.scheduled_at < now() + interval '21 days'
     ORDER BY q.scheduled_at, q.id LIMIT 20
  LOOP
    s := public.content_autonomy_publish_state_ivan(r.queue_id);
    fails := CASE WHEN jsonb_typeof(s -> 'fails') = 'array' THEN s -> 'fails' ELSE '[]'::jsonb END;
    st := CASE
      WHEN coalesce((s ->> 'eligible')::boolean, false) THEN 'ready'
      WHEN fails = '["automatic review is missing or stale"]'::jsonb AND r.scheduled_at > now() + interval '20 minutes' THEN 'checking'
      ELSE 'held' END;
    out := out || jsonb_build_array(jsonb_build_object(
      'queue_id', r.queue_id, 'draft_id', r.draft_id, 'slot_at', r.scheduled_at, 'state', st,
      'origin', CASE WHEN coalesce((s ->> 'required')::boolean, false) THEN 'autopilot' ELSE 'own' END,
      'kept', coalesce((s ->> 'owner_keep')::boolean, false),
      'fails', CASE WHEN st = 'ready' THEN '[]'::jsonb ELSE fails END,
      'post_text', r.post_text, 'post_format', r.post_format, 'media_urls', coalesce(r.media_urls, '[]'::jsonb),
      'in_sync', r.post_text IS NOT DISTINCT FROM r.post_body,
      'body_sha256', encode(sha256(convert_to(coalesce(r.post_body, ''), 'UTF8')), 'hex'),
      'urls', public.content_owner_keep_urls(r.draft_id)));
  END LOOP;
  RETURN out;
END $function$;

REVOKE ALL ON FUNCTION public.content_next_keep(uuid, timestamptz, text, text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.content_next_posts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_next_keep(uuid, timestamptz, text, text, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.content_next_posts() TO authenticated, service_role;

  $mig$;

  -- 1. No keep exists: every pending row decides exactly as before.
  SELECT jsonb_object_agg(q.id, public.content_autonomy_publish_snapshot_ivan(q.id)) INTO after
    FROM public.scheduled_posts q WHERE q.platform = 'linkedin' AND q.status = 'pending';
  res := res || jsonb_build_object('t01_no_keep_same_as_before', before = after, 't01_rows', (SELECT count(*) FROM jsonb_object_keys(before)));

  SELECT d.id, encode(sha256(convert_to(d.post_body, 'UTF8')), 'hex') INTO dg, sha
    FROM public.scheduled_posts q JOIN public.carousel_drafts d ON d.id::text = q.clickup_task_id WHERE q.id = qg;
  SELECT coalesce(jsonb_agg(jsonb_build_object('url', z ->> 'url', 'sha256', z ->> 'sha256', 'bytes', (z ->> 'bytes')::bigint)), '[]'::jsonb) INTO files
    FROM public.carousel_drafts d, jsonb_array_elements(d.qa -> 'autonomous_review' -> 'assets' -> 'files') z WHERE d.id = dg;
  SELECT q.post_format, to_jsonb(q.media_urls) INTO fmt_g, med_g FROM public.scheduled_posts q WHERE q.id = qg;
  res := res || jsonb_build_object('t02_gif_files', jsonb_array_length(files), 't02_shown', jsonb_build_object('format', fmt_g, 'media', jsonb_array_length(med_g)));

  -- 2. Not signed in: refused.
  BEGIN PERFORM public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, fmt_g, med_g, files); res := res || jsonb_build_object('t03_anon_keep', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('t03_anon_keep', sqlst); END;
  BEGIN PERFORM public.content_next_posts(); res := res || jsonb_build_object('t04_anon_read', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('t04_anon_read', sqlst); END;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  BEGIN PERFORM public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, fmt_g, med_g, files); res := res || jsonb_build_object('t05_stranger_keep', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('t05_stranger_keep', sqlst); END;

  -- 3. Owner reads the upcoming list before any keep.
  PERFORM set_config('request.jwt.claims', OWNER, true);
  x := public.content_next_posts();
  res := res || jsonb_build_object('t06_list_before', (SELECT jsonb_agg(jsonb_build_object('q', left(e ->> 'queue_id', 8), 'state', e ->> 'state', 'origin', e ->> 'origin', 'kept', e -> 'kept', 'fails', e -> 'fails', 'n_urls', jsonb_array_length(e -> 'urls'), 'in_sync', e -> 'in_sync')) FROM jsonb_array_elements(x) e));

  -- 4. Owner keep, wrong inputs.
  BEGIN PERFORM public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), repeat('0', 64), fmt_g, med_g, files); res := res || jsonb_build_object('t07_wrong_text', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT; res := res || jsonb_build_object('t07_wrong_text', hint); END;
  BEGIN PERFORM public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, fmt_g, med_g, '[]'::jsonb); res := res || jsonb_build_object('t08_no_files', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT; res := res || jsonb_build_object('t08_no_files', hint); END;
  BEGIN PERFORM public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, fmt_g, med_g, files || jsonb_build_array(jsonb_build_object('url', 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/x/extra.png', 'sha256', repeat('a', 64), 'bytes', 5)));
    res := res || jsonb_build_object('t09_extra_file', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT; res := res || jsonb_build_object('t09_extra_file', hint); END;
  BEGIN PERFORM public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, fmt_g, med_g, jsonb_build_array((files -> 0) || jsonb_build_object('sha256', 'nothex')));
    res := res || jsonb_build_object('t10_bad_hash', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('t10_bad_hash', sqlst); END;
  BEGIN PERFORM public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, fmt_g, med_g, jsonb_build_array((files -> 0) || jsonb_build_object('bytes', 14 * 1024 * 1024)));
    res := res || jsonb_build_object('t11_too_large', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT; res := res || jsonb_build_object('t11_too_large', hint); END;
  BEGIN PERFORM public.content_next_keep(qp, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qp), (SELECT encode(sha256(convert_to(q.post_text, 'UTF8')), 'hex') FROM public.scheduled_posts q WHERE q.id = qp), 'text', '[]'::jsonb, '[]'::jsonb);
    res := res || jsonb_build_object('t12_past_slot', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT; res := res || jsonb_build_object('t12_past_slot', hint); END;

  BEGIN PERFORM public.content_next_keep(qg, (SELECT scheduled_at + interval '1 hour' FROM public.scheduled_posts WHERE id = qg), sha, fmt_g, med_g, files);
    res := res || jsonb_build_object('t12b_wrong_slot_shown', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT; res := res || jsonb_build_object('t12b_wrong_slot_shown', hint); END;
  BEGIN PERFORM public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, 'single_image', med_g, files);
    res := res || jsonb_build_object('t12d_other_format_shown', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT; res := res || jsonb_build_object('t12d_other_format_shown', hint); END;
  BEGIN
    -- He was shown [A, B]; before he taps, another session makes it [B, A] in the draft and the queue.
    -- Text, slot and both file hashes are unchanged, yet the keep of the order he saw is refused.
    SELECT image_urls INTO orig FROM public.carousel_drafts WHERE id = dg;
    UPDATE public.carousel_drafts SET image_urls = ARRAY['https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/x/b.png', orig[1]], type = 'text' WHERE id = dg;
    PERFORM public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, fmt_g,
      jsonb_build_array(orig[1], 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/x/b.png'),
      files || jsonb_build_array(jsonb_build_object('url', 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/x/b.png', 'sha256', repeat('b', 64), 'bytes', 10)));
    RAISE EXCEPTION 'undo' USING DETAIL = 'ALLOWED';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT, msg = PG_EXCEPTION_DETAIL, sqlst = MESSAGE_TEXT;
    res := res || jsonb_build_object('t12e_order_changed_since_shown', coalesce(nullif(msg, ''), nullif(hint, ''), sqlst)); END;
  BEGIN
    -- the same two attachments in the order he WAS shown are accepted (the control for t12e)
    SELECT image_urls INTO orig FROM public.carousel_drafts WHERE id = dg;
    UPDATE public.carousel_drafts SET image_urls = ARRAY['https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/x/b.png', orig[1]], type = 'text' WHERE id = dg;
    r := public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, fmt_g,
      jsonb_build_array('https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/x/b.png', orig[1]),
      files || jsonb_build_array(jsonb_build_object('url', 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/x/b.png', 'sha256', repeat('b', 64), 'bytes', 10)));
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('keep', r -> 'ok', 'queue_media', (SELECT to_jsonb(media_urls) FROM public.scheduled_posts WHERE id = qg) = jsonb_build_array('https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/x/b.png', orig[1]))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT, msg = PG_EXCEPTION_DETAIL, sqlst = MESSAGE_TEXT;
    res := res || jsonb_build_object('t12f_same_order_as_shown', coalesce(nullif(msg, ''), nullif(hint, ''), sqlst)); END;
  BEGIN
    -- the owner login is the one named in content_owner_accounts: a lane entitlement alone is not enough
    UPDATE public.content_owner_accounts SET owner_uid = '00000000-0000-4000-8000-000000000002' WHERE account = 'ivan';
    PERFORM public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, fmt_g, med_g, files);
    RAISE EXCEPTION 'undo' USING DETAIL = 'ALLOWED';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('t12c_entitled_but_not_owner', coalesce(nullif(hint, ''), sqlst)); END;

  -- 5. Owner keep, right inputs: the GIF post becomes publishable, and only on the keep.
  r := public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, fmt_g, med_g, files);
  res := res || jsonb_build_object('t13_keep_ok', r -> 'ok');
  x := public.content_next_posts();
  res := res || jsonb_build_object('t14_list_after', (SELECT jsonb_build_object('state', e ->> 'state', 'kept', e -> 'kept', 'fails', e -> 'fails') FROM jsonb_array_elements(x) e WHERE e ->> 'queue_id' = qg::text));
  PERFORM set_config('request.jwt.claims', '', true);
  s := public.content_autonomy_publish_snapshot_ivan(qg);
  tok := s ->> 'manifest_sha256';
  res := res || jsonb_build_object('t15_snapshot', jsonb_build_object('required', s -> 'required', 'eligible', s -> 'eligible', 'owner_keep', s -> 'owner_keep',
    'token_ok', tok ~ '^[0-9a-f]{64}$', 'files_same', s -> 'files' = files, 'has_expected', s ? 'expected'));
  -- the claim refuses only because the slot is in the future (it never reaches the keep branch)
  SELECT * INTO qrow FROM public.scheduled_posts WHERE id = qg;
  r := public.scheduled_post_claim_if_unchanged(qg, to_jsonb(qrow) || jsonb_build_object('autonomy_manifest_sha256', tok, 'autonomy_asset_files', files), 'rm-WNhwaS1m7VcZoYLRrJA');
  res := res || jsonb_build_object('t16_claim_future', r);
  -- every other pending row still decides as before
  SELECT jsonb_object_agg(q.id, public.content_autonomy_publish_snapshot_ivan(q.id)) INTO after
    FROM public.scheduled_posts q WHERE q.platform = 'linkedin' AND q.status = 'pending' AND q.id <> qg;
  res := res || jsonb_build_object('t17_others_unchanged', (before - qg::text) = after);

  -- 6. A second keep replaces the first (one live row).
  PERFORM set_config('request.jwt.claims', OWNER, true);
  r := public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), sha, fmt_g, med_g, files);
  res := res || jsonb_build_object('t18_live_rows', (SELECT count(*) FROM public.content_owner_keeps WHERE draft_id = dg AND revoked_at IS NULL),
    't18_all_rows', (SELECT count(*) FROM public.content_owner_keeps WHERE draft_id = dg));
  PERFORM set_config('request.jwt.claims', '', true);
  res := res || jsonb_build_object('t19_token_changes_with_new_keep', (public.content_autonomy_publish_snapshot_ivan(qg) ->> 'manifest_sha256') <> tok);

  -- 7. A machine cannot mint or alter a keep.
  BEGIN INSERT INTO public.content_owner_keeps (draft_id, queue_id, slot_at, body_sha256, post_format, media_urls, files, actor_uid)
        SELECT d.id, qp, q.scheduled_at, encode(sha256(convert_to(d.post_body, 'UTF8')), 'hex'), 'text', '[]'::jsonb, '[]'::jsonb, UD::uuid
          FROM public.scheduled_posts q JOIN public.carousel_drafts d ON d.id::text = q.clickup_task_id WHERE q.id = qp;
    res := res || jsonb_build_object('t20_machine_insert', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('t20_machine_insert', sqlst); END;
  BEGIN UPDATE public.content_owner_keeps SET files = '[]'::jsonb WHERE draft_id = dg AND revoked_at IS NULL;
    res := res || jsonb_build_object('t21_machine_alter', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('t21_machine_alter', sqlst); END;

  -- 8. Anything that changes what would be posted voids the keep (each change undone by its own savepoint).
  BEGIN
    UPDATE public.scheduled_posts SET media_urls = media_urls || ARRAY['https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/x/new.png'] WHERE id = qg;
    s := public.content_autonomy_publish_snapshot_ivan(qg);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('eligible', s -> 'eligible', 'owner_keep', s -> 'owner_keep', 'fails', s -> 'fails')::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('t22_queue_media_changed', coalesce(nullif(hint, ''), msg)); END;
  BEGIN
    UPDATE public.carousel_drafts SET image_urls = image_urls || ARRAY['https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/x/new.png'] WHERE id = dg;
    s := public.content_autonomy_publish_snapshot_ivan(qg);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('eligible', s -> 'eligible', 'owner_keep', s -> 'owner_keep', 'fails', s -> 'fails')::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('t23_draft_media_changed', coalesce(nullif(hint, ''), msg)); END;
  BEGIN
    UPDATE public.scheduled_posts SET scheduled_at = scheduled_at + interval '1 hour' WHERE id = qg;
    s := public.content_autonomy_publish_snapshot_ivan(qg);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('eligible', s -> 'eligible', 'owner_keep', s -> 'owner_keep', 'fails', s -> 'fails')::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('t24_queue_slot_changed', coalesce(nullif(hint, ''), msg)); END;
  BEGIN
    UPDATE public.scheduled_posts SET post_text = post_text || ' x' WHERE id = qg;
    s := public.content_autonomy_publish_snapshot_ivan(qg);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('eligible', s -> 'eligible', 'owner_keep', s -> 'owner_keep', 'fails', s -> 'fails')::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('t25_queue_text_changed', coalesce(nullif(hint, ''), msg)); END;
  BEGIN
    -- Ivan's own edit of the scheduled text (his login): the old keep no longer covers it.
    PERFORM set_config('request.jwt.claims', OWNER, true);
    UPDATE public.carousel_drafts SET post_body = post_body || E'\n\nOne more line.' WHERE id = dg;
    PERFORM set_config('request.jwt.claims', '', true);
    s := public.content_autonomy_publish_snapshot_ivan(qg);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('eligible', s -> 'eligible', 'owner_keep', s -> 'owner_keep', 'fails', s -> 'fails',
      'draft_status', (SELECT status FROM public.carousel_drafts WHERE id = dg), 'queue_synced', (SELECT q.post_text = d.post_body FROM public.scheduled_posts q, public.carousel_drafts d WHERE q.id = qg AND d.id = dg),
      'pick', (SELECT state FROM public.content_autopilot_picks WHERE draft_id = dg))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('t26_owner_edit_voids_old_keep', coalesce(nullif(hint, ''), msg)); END;
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    -- ...and a fresh keep of the edited text makes it publishable again.
    PERFORM set_config('request.jwt.claims', OWNER, true);
    UPDATE public.carousel_drafts SET post_body = post_body || E'\n\nOne more line.' WHERE id = dg;
    r := public.content_next_keep(qg, (SELECT scheduled_at FROM public.scheduled_posts WHERE id = qg), (SELECT encode(sha256(convert_to(post_body, 'UTF8')), 'hex') FROM public.carousel_drafts WHERE id = dg), fmt_g, med_g, files);
    PERFORM set_config('request.jwt.claims', '', true);
    s := public.content_autonomy_publish_snapshot_ivan(qg);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('keep', r -> 'ok', 'eligible', s -> 'eligible', 'owner_keep', s -> 'owner_keep')::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('t27_owner_edit_then_keep', coalesce(nullif(hint, ''), msg)); END;
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    -- moved away and back to the very same slot: the old keep stays dead
    UPDATE public.scheduled_posts SET scheduled_at = scheduled_at + interval '1 hour' WHERE id = qg;
    UPDATE public.scheduled_posts SET scheduled_at = scheduled_at - interval '1 hour' WHERE id = qg;
    s := public.content_autonomy_publish_snapshot_ivan(qg);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('eligible', s -> 'eligible', 'owner_keep', s -> 'owner_keep',
      'live_keeps', (SELECT count(*) FROM public.content_owner_keeps WHERE draft_id = dg AND revoked_at IS NULL))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('t27b_away_and_back', coalesce(nullif(hint, ''), msg)); END;
  BEGIN
    -- attachment list swapped for another and swapped back: same
    SELECT image_urls INTO orig FROM public.carousel_drafts WHERE id = dg;
    UPDATE public.carousel_drafts SET image_urls = ARRAY['https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/x/other.gif'] WHERE id = dg;
    UPDATE public.carousel_drafts SET image_urls = orig WHERE id = dg;
    s := public.content_autonomy_publish_snapshot_ivan(qg);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('eligible', s -> 'eligible', 'owner_keep', s -> 'owner_keep',
      'queue_synced', (SELECT to_jsonb(q.media_urls) = to_jsonb(d.image_urls) FROM public.scheduled_posts q, public.carousel_drafts d WHERE q.id = qg AND d.id = dg))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('t27c_media_away_and_back', coalesce(nullif(hint, ''), msg)); END;
  BEGIN
    UPDATE public.content_owner_keeps SET revoked_at = now() WHERE draft_id = dg AND revoked_at IS NULL;
    s := public.content_autonomy_publish_snapshot_ivan(qg);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('eligible', s -> 'eligible', 'owner_keep', s -> 'owner_keep', 'fails', s -> 'fails')::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('t28_revoked', coalesce(nullif(hint, ''), msg)); END;

  -- 9. The publisher claim on a due row. The 13 Nov text post is past its slot, so a keep row is planted for it
  --    under the owner login (the RPC rightly refuses a passed slot) to exercise the claim's keep branch.
  SELECT d.id INTO dp FROM public.scheduled_posts q JOIN public.carousel_drafts d ON d.id::text = q.clickup_task_id WHERE q.id = qp;
  SELECT * INTO qrow FROM public.scheduled_posts WHERE id = qp;
  r := public.scheduled_post_claim_if_unchanged(qp, to_jsonb(qrow), 'rm-WNhwaS1m7VcZoYLRrJA');
  res := res || jsonb_build_object('t29_due_no_keep_claim', r - 'post');
  PERFORM set_config('request.jwt.claims', OWNER, true);
  INSERT INTO public.content_owner_keeps (draft_id, queue_id, slot_at, body_sha256, post_format, media_urls, files, actor_uid)
    SELECT dp, qp, qrow.scheduled_at, encode(sha256(convert_to(d.post_body, 'UTF8')), 'hex'),
           public.content_autonomy_queue_payload_ivan(dp) ->> 'post_format', public.content_autonomy_queue_payload_ivan(dp) -> 'media_urls', '[]'::jsonb, UD::uuid
      FROM public.carousel_drafts d WHERE d.id = dp;
  PERFORM set_config('request.jwt.claims', '', true);
  s := public.content_autonomy_publish_snapshot_ivan(qp);
  res := res || jsonb_build_object('t30_due_keep_snapshot', jsonb_build_object('eligible', s -> 'eligible', 'owner_keep', s -> 'owner_keep', 'files', s -> 'files'));
  r := public.scheduled_post_claim_if_unchanged(qp, to_jsonb(qrow), 'rm-WNhwaS1m7VcZoYLRrJA');
  res := res || jsonb_build_object('t31_due_keep_claim_without_token', r - 'post');
  r := public.scheduled_post_claim_if_unchanged(qp, to_jsonb(qrow) || jsonb_build_object('autonomy_manifest_sha256', repeat('0', 64), 'autonomy_asset_files', '[]'::jsonb), 'rm-WNhwaS1m7VcZoYLRrJA');
  res := res || jsonb_build_object('t32_due_keep_claim_wrong_token', r - 'post');
  r := public.scheduled_post_claim_if_unchanged(qp, to_jsonb(qrow) || jsonb_build_object('autonomy_manifest_sha256', s ->> 'manifest_sha256', 'autonomy_asset_files', jsonb_build_array(jsonb_build_object('url', 'x'))), 'rm-WNhwaS1m7VcZoYLRrJA');
  res := res || jsonb_build_object('t33_due_keep_claim_wrong_files', r - 'post');
  r := public.scheduled_post_claim_if_unchanged(qp, to_jsonb(qrow) || jsonb_build_object('autonomy_manifest_sha256', s ->> 'manifest_sha256', 'autonomy_asset_files', s -> 'files'), 'rm-WNhwaS1m7VcZoYLRrJA');
  res := res || jsonb_build_object('t34_due_keep_claim_right', (r - 'post') || jsonb_build_object('post_status', r -> 'post' -> 'status'));

  -- 9b. The row is now 'posting'. A byte mismatch found after the claim must still park it, even when the
  --     autopilot pick is no longer armed at this slot (otherwise the row would sit in 'posting' and block every later post).
  SELECT * INTO qrow FROM public.scheduled_posts WHERE id = qp;
  UPDATE public.content_autopilot_picks SET state = 'released' WHERE draft_id = dp;
  UPDATE public.content_owner_keeps SET revoked_at = now() WHERE draft_id = dp AND revoked_at IS NULL;
  -- a claim that carries no keep token, or a wrong one, is not treated as a kept claim
  r := public.content_autonomy_hold_claim_ivan(qp, to_jsonb(qrow), 'x');
  res := res || jsonb_build_object('t36a_hold_without_token', r);
  r := public.content_autonomy_hold_claim_ivan(qp, to_jsonb(qrow) || jsonb_build_object('autonomy_manifest_sha256', repeat('0', 64)), 'x');
  res := res || jsonb_build_object('t36b_hold_wrong_token', r);
  r := public.content_autonomy_hold_claim_ivan(qp, to_jsonb(qrow) || jsonb_build_object('autonomy_manifest_sha256', s ->> 'manifest_sha256', 'autonomy_asset_files', s -> 'files'), 'autonomy_upload_bytes_changed');
  res := res || jsonb_build_object('t36_hold_after_claim_on_keep', r || jsonb_build_object('queue_status', (SELECT status FROM public.scheduled_posts WHERE id = qp)));

  -- 10. A hand-placed post is untouched by all of this.
  s := public.content_autonomy_publish_snapshot_ivan(qh);
  res := res || jsonb_build_object('t35_hand_placed', s);

  RAISE EXCEPTION 'ROLLBACK_RESULT %', res::text;
END $t$;
