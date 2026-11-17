BEGIN;

-- 2026-11-17: Pull takes one short optional reason. content_next_pull gains p_reason (default NULL) and hands it to
-- content_owner_pull_ivan, which already stores it in content_owner_pulls.reason (it was the fixed text
-- 'Pull on the Review row'; it stays the fallback when no reason is given). The old two-argument function is dropped so
-- a call without a reason is not ambiguous.

DROP FUNCTION IF EXISTS public.content_next_pull(uuid, timestamptz);

CREATE OR REPLACE FUNCTION public.content_next_pull(p_queue uuid, p_slot_at timestamptz, p_reason text DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '3s' SET statement_timeout TO '20s'
AS $function$
DECLARE v_draft uuid; v_reason text := nullif(left(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), 200), '');
BEGIN
  IF NOT public.content_owner_ok_ivan() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_queue IS NULL OR p_slot_at IS NULL THEN RAISE EXCEPTION 'bad request' USING ERRCODE = '22023'; END IF;
  SELECT d.id INTO v_draft FROM public.scheduled_posts q JOIN public.carousel_drafts d ON d.id::text = q.clickup_task_id
   WHERE q.id = p_queue AND q.platform = 'linkedin' AND q.status = 'pending' AND coalesce(q.is_repost, false) = false
     AND d.client_id IS NULL AND q.scheduled_at = p_slot_at;
  IF v_draft IS NULL THEN
    RAISE EXCEPTION 'Not pulled: this post changed or is no longer waiting to go out. Look at it again.' USING ERRCODE = 'P0001', HINT = 'next_changed'; END IF;
  RETURN public.content_owner_pull_ivan(v_draft, p_slot_at, coalesce(v_reason, 'Pull on the Review row'));
END $function$;

REVOKE ALL ON FUNCTION public.content_next_pull(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_next_pull(uuid, timestamptz, text) TO authenticated, service_role;

COMMIT;
