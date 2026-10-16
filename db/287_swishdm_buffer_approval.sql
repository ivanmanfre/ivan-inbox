-- SwishDM only: operator acceptance exposes a finished draft for Jonathan's review.
-- No cb39 entitlement, generation, client approval, date or publisher changes.
BEGIN;
CREATE OR REPLACE FUNCTION public.swishdm_set_buffer_visibility(
  p_draft_id uuid, p_expected_updated_at timestamptz, p_visible boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
SET statement_timeout TO '20s'
SET lock_timeout TO '2s'
AS $function$
DECLARE
  b public.client_boards%ROWTYPE;
  d public.carousel_drafts%ROWTYPE;
  v_queue jsonb; v_next jsonb; v_item jsonb; v_old jsonb; v_source jsonb;
  v_block text; v_at timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR NOT public.cb34_p2_operator_lane_allowed('ivan') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  IF p_visible IS NULL THEN RETURN jsonb_build_object('ok',false,'error','bad_visibility'); END IF;
  -- Same board-before-draft order as provenance reconciliation and client actions.
  SELECT * INTO b FROM public.client_boards
   WHERE id='bc1dae85-6218-496d-9278-e68dcc9cf61b'::uuid
     AND slug='swishdm-live' AND client_id='swishdm' FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.client_registry WHERE client_id='swishdm' AND is_active) THEN
    RETURN jsonb_build_object('ok',false,'error','board_not_found');
  END IF;
  IF jsonb_typeof(b.board) IS DISTINCT FROM 'object'
    OR (b.board ? 'queue' AND jsonb_typeof(b.board->'queue') IS DISTINCT FROM 'array') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_board');
  END IF;
  SELECT * INTO d FROM public.carousel_drafts WHERE id=p_draft_id AND client_id='swishdm' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','draft_not_found'); END IF;
  IF p_expected_updated_at IS NULL OR d.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok',false,'error','stale_draft');
  END IF;
  IF d.published_at IS NOT NULL OR (p_visible AND d.status IS DISTINCT FROM 'review') THEN
    RETURN jsonb_build_object('ok',false,'error','not_in_review');
  END IF;
  v_queue := coalesce(b.board->'queue','[]'::jsonb);
  IF p_visible THEN
    IF nullif(btrim(d.post_body),'') IS NULL THEN RETURN jsonb_build_object('ok',false,'error','empty_body'); END IF;
    v_block := public.cb34_p2_review_block(d.qa,d.taxonomy);
    IF v_block IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','qa_blocked','reason',v_block); END IF;
    IF d.type NOT IN ('text','single_image','image','carousel','video') OR d.type IS NULL THEN
      RETURN jsonb_build_object('ok',false,'error','unsupported_format');
    END IF;
    IF (d.type='video' AND coalesce(d.video_url,'') !~ '^https://')
       OR (d.type IN ('single_image','image','carousel') AND (
         coalesce(cardinality(d.image_urls),0)=0 OR EXISTS (
           SELECT 1 FROM unnest(d.image_urls) u WHERE u IS NULL OR u !~ '^https://[^/[:space:]]+(/[^[:space:]]*)?$'))) THEN
      RETURN jsonb_build_object('ok',false,'error','awaiting_media');
    END IF;
    -- Never copy raw source_detail: it can contain private research/transcript context.
    SELECT coalesce(jsonb_object_agg(key,to_jsonb(left(value #>> '{}',1000))),'{}'::jsonb) INTO v_source
      FROM jsonb_each(CASE WHEN jsonb_typeof(d.source_detail)='object' THEN d.source_detail ELSE '{}'::jsonb END)
      WHERE key IN ('kind','source','label','source_title','source_date','source_url','url') AND jsonb_typeof(value)='string'
        AND (key NOT IN ('source_url','url') OR value #>> '{}' ~ '^https://');
    v_source := v_source || jsonb_build_object('supporting_urls',coalesce((
      SELECT jsonb_agg(to_jsonb(left(value #>> '{}',1000))) FROM (
        SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.source_detail->'supporting_urls')='array'
          THEN d.source_detail->'supporting_urls' ELSE '[]'::jsonb END)
        WHERE jsonb_typeof(value)='string' AND value #>> '{}' ~ '^https://' LIMIT 12) links),'[]'::jsonb));
    SELECT value INTO v_old FROM jsonb_array_elements(v_queue) WHERE value->>'id'=p_draft_id::text LIMIT 1;
    v_item := (coalesce(v_old,'{}'::jsonb) - 'source_ref') || jsonb_build_object(
      'id',d.id,'kind','post','style',d.type,'title',d.title,'topic',d.topic,'type',d.type,'format',d.type,
      'generating',false,'image',d.image_urls[1],'media_url',CASE WHEN d.type='video' THEN d.video_url ELSE d.image_urls[1] END,
      'topic_label',coalesce(d.taxonomy->>'topic_label',d.topic),'creative_style',d.taxonomy->>'creative_style',
      'pillar',d.taxonomy->>'pillar','funnel_stage',d.funnel_stage,'funnel_source',d.funnel_source,'source',coalesce(v_source->>'source',d.taxonomy->>'source'),
      'body',d.post_body,'post_body',d.post_body,'hook',split_part(d.post_body,E'\n',1),
      'image_urls',coalesce(to_jsonb(d.image_urls),'[]'::jsonb),'video_url',d.video_url,
      'pdf_url',d.pdf_url,'authored_html',d.authored_html,'stage',d.status,
      'scheduled_at',d.scheduled_at,'published_at',d.published_at,
      'source_label',left(d.source_label,1000),'source_detail',v_source);
    -- Replace the first match in place; discard any duplicate IDs; append only if absent.
    SELECT coalesce(jsonb_agg(item ORDER BY ord),'[]'::jsonb) INTO v_next FROM (
      SELECT CASE WHEN value->>'id'=p_draft_id::text THEN v_item ELSE value END item,ord
      FROM jsonb_array_elements(v_queue) WITH ORDINALITY q(value,ord)
      WHERE value->>'id' IS DISTINCT FROM p_draft_id::text OR ord=(
        SELECT min(n) FROM jsonb_array_elements(v_queue) WITH ORDINALITY t(x,n) WHERE x->>'id'=p_draft_id::text)) items;
    IF v_old IS NULL THEN v_next := v_next || jsonb_build_array(v_item); END IF;
  ELSE
    SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]'::jsonb) INTO v_next
      FROM jsonb_array_elements(v_queue) WITH ORDINALITY q(value,ord)
      WHERE value->>'id' IS DISTINCT FROM p_draft_id::text;
  END IF;
  IF d.board_visible IS NOT DISTINCT FROM p_visible AND v_next=v_queue THEN
    RETURN jsonb_build_object('ok',true,'id',d.id,'client_id','swishdm','board_visible',p_visible,'updated_at',d.updated_at,'unchanged',true);
  END IF;
  UPDATE public.carousel_drafts SET board_visible=p_visible,updated_at=v_at WHERE id=d.id RETURNING updated_at INTO v_at;
  UPDATE public.client_boards SET board=jsonb_set(b.board,'{queue}',v_next),updated_at=v_at WHERE id=b.id;
  INSERT INTO public.client_board_actions(board_slug,client_id,action,ref,payload)
    VALUES('swishdm-live','swishdm',CASE WHEN p_visible THEN 'operator_buffer_approve' ELSE 'operator_buffer_remove' END,d.id::text,
      jsonb_build_object('by',CASE WHEN auth.jwt()->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN auth.jwt()->>'email' ELSE 'system' END,
        'actor_label',coalesce(nullif(auth.jwt()->>'email',''),'Ivan operator'),
        'operator_uid',auth.uid(),'applied',true,'client_approved',false,
        'before',jsonb_build_object('board_visible',d.board_visible,'status',d.status),
        'after',jsonb_build_object('board_visible',p_visible,'status',d.status)));
  RETURN jsonb_build_object('ok',true,'id',d.id,'client_id','swishdm','board_visible',p_visible,'updated_at',v_at);
END $function$;
REVOKE ALL ON FUNCTION public.swishdm_set_buffer_visibility(uuid,timestamptz,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.swishdm_set_buffer_visibility(uuid,timestamptz,boolean) TO authenticated;
COMMIT;
