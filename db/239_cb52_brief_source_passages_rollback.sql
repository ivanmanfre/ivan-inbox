CREATE OR REPLACE FUNCTION public.cb51_draft_sources(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
AS $function$
DECLARE r jsonb;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN '[]'::jsonb; END IF;
  IF cardinality(p_ids) > 60 THEN RAISE EXCEPTION 'too many drafts' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(jsonb_agg(x.j), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object(
      'draft_id', d.id,
      'member_state', m.state,
      'slot', coalesce(m.brief ->> 'slot', d.taxonomy -> 'brain_brief' ->> 'slot'),
      'source_ref', s.ref,
      'source_text', m.source_text,
      'detail', CASE WHEN jsonb_typeof(d.source_detail) = 'object' THEN d.source_detail - 'voice_writer' - 'references' ELSE NULL END,
      'x', xp.j,
      'linkedin', lp.j) AS j
    FROM unnest(p_ids) AS i(id)
    JOIN public.carousel_drafts d ON d.id = i.id
    LEFT JOIN public.cb34_p2_members m ON m.draft_id = d.id
    CROSS JOIN LATERAL (SELECT coalesce(d.client_id, 'ivan') AS lane,
      coalesce(m.source_ref, d.taxonomy -> 'brain_brief' ->> 'source_ref') AS ref) s
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('author', nullif(btrim(p.author_name), ''), 'handle', p.author_handle, 'text', p.text, 'url', p.url,
               'published_at', p.created_at, 'likes', p.likes, 'views', p.views,
               'ratio', sc.ratio, 'baseline', sc.trailing_median, 'baseline_n', sc.trailing_n) AS j
        FROM public.x_competitor_posts p
        LEFT JOIN LATERAL (SELECT o.ratio, o.trailing_median, o.trailing_n FROM public.x_outlier_scores o
                            WHERE o.client_id = s.lane AND o.post_id = p.post_id ORDER BY o.created_at DESC LIMIT 1) sc ON true
       WHERE s.ref LIKE 'outlier:x:%' AND p.client_id = s.lane AND p.post_id = split_part(s.ref, ':', 3)
       LIMIT 1) xp ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('published_at', o.published_at, 'likes', o.likes, 'comments', o.comments,
               'ratio', o.ratio, 'baseline', o.trailing_median, 'baseline_n', o.trailing_n) AS j
        FROM public.outlier_post_scores o
       WHERE s.ref LIKE 'outlier:linkedin:%' AND o.client_id = s.lane AND o.post_ref = split_part(s.ref, ':', 3)
       ORDER BY o.created_at DESC LIMIT 1) lp ON true
    WHERE public.cb39_lane_ok(s.lane)
      AND coalesce((public.cb34_p2_read_guard(d.id) ->> 'visible')::boolean, false)
  ) x;
  RETURN r;
END $function$
