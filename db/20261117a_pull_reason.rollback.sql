BEGIN;
DROP FUNCTION IF EXISTS public.content_next_pull(uuid, timestamptz, text);
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
REVOKE ALL ON FUNCTION public.content_next_pull(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_next_pull(uuid, timestamptz) TO authenticated, service_role;
COMMIT;
