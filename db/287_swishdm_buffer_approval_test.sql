-- Rollback-only live smoke. Run as SQL owner in ONE transaction:
-- BEGIN; <migration without its BEGIN/COMMIT>; <this file>; ROLLBACK;
-- This synthetic fixture never copies real content, emails or private research.
DO $fixture$
DECLARE v_uid uuid; v_email text;
BEGIN
  SELECT e.operator_uid,u.email INTO v_uid,v_email
    FROM public.cb34_p2_operator_entitlements e JOIN auth.users u ON u.id=e.operator_uid
    WHERE e.client_id='ivan' AND e.grant_scope='cb34_p2_member_read'
      AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false) LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No entitled Ivan operator for authenticated rollback smoke'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'role','authenticated','email',v_email)::text,true);
  INSERT INTO public.carousel_drafts(id,title,type,post_body,client_id,status,board_visible,qa,taxonomy)
    VALUES('28700000-0000-4000-8000-000000000001','Rollback-only buffer test','video','Synthetic reviewed copy.',
      'swishdm','review',false,'{"verdict":"PASS"}','{}');
  UPDATE public.carousel_drafts SET video_url='https://example.com/rollback-only.mp4'
    WHERE id='28700000-0000-4000-8000-000000000001';
END $fixture$;
SET LOCAL ROLE authenticated;
DO $authenticated_smoke$
DECLARE r jsonb; v_at timestamptz;
BEGIN
  SELECT updated_at INTO v_at FROM public.carousel_drafts WHERE id='28700000-0000-4000-8000-000000000001';
  r:=public.swishdm_set_buffer_visibility('28700000-0000-4000-8000-000000000001',v_at-interval '1 second',true);
  IF r->>'error' IS DISTINCT FROM 'stale_draft' THEN RAISE EXCEPTION 'stale guard failed: %',r; END IF;
  r:=public.swishdm_set_buffer_visibility('28700000-0000-4000-8000-000000000001',v_at,true);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'authenticated approval failed: %',r; END IF;
END $authenticated_smoke$;
RESET ROLE;
DO $assert$
DECLARE d public.carousel_drafts%ROWTYPE; b jsonb; n integer;
BEGIN
  SELECT * INTO d FROM public.carousel_drafts WHERE id='28700000-0000-4000-8000-000000000001';
  IF d.status<>'review' OR d.board_visible IS DISTINCT FROM true OR d.scheduled_at IS NOT NULL OR d.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'approval armed or changed draft lifecycle'; END IF;
  SELECT board INTO b FROM public.client_boards WHERE id='bc1dae85-6218-496d-9278-e68dcc9cf61b';
  SELECT count(*) INTO n FROM jsonb_array_elements(b->'queue') q WHERE q->>'id'=d.id::text
    AND q->>'kind'='post' AND q->>'style'='video' AND q->>'video_url'='https://example.com/rollback-only.mp4';
  IF n<>1 THEN RAISE EXCEPTION 'video missing, unrenderable or duplicated'; END IF;
  SELECT count(*) INTO n FROM public.client_board_actions WHERE ref=d.id::text AND action='operator_buffer_approve'
    AND payload->>'client_approved'='false';
  IF n<>1 THEN RAISE EXCEPTION 'operator audit missing'; END IF;
  -- Repeating current reviewed bytes is a no-op, not a second approval audit.
  PERFORM public.swishdm_set_buffer_visibility(d.id,d.updated_at,true);
  SELECT count(*) INTO n FROM public.client_board_actions WHERE ref=d.id::text AND action='operator_buffer_approve';
  IF n<>1 THEN RAISE EXCEPTION 'duplicate approval audit'; END IF;
  PERFORM public.swishdm_set_buffer_visibility(d.id,d.updated_at,false);
  IF EXISTS(SELECT 1 FROM public.client_boards cb,jsonb_array_elements(cb.board->'queue') q
    WHERE cb.id='bc1dae85-6218-496d-9278-e68dcc9cf61b' AND q->>'id'=d.id::text) THEN
    RAISE EXCEPTION 'buffer removal did not remove item'; END IF;
END $assert$;
-- Caller MUST issue ROLLBACK and separately verify fixture absence afterward.
