-- Restores cb39_monday_card as it was live before 253 (sha256 82bfeb29c8f5, includes thread B's brain line).
CREATE OR REPLACE FUNCTION public.cb39_monday_card(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  wk timestamptz := date_trunc('week', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  key text; n_total int; by_lane text; last_release timestamptz; v_title text; v_body text; existing public.inbox_notifications%ROWTYPE;
  n_keep int; n_edit int; n_drop int; results_line text; part text; c text; brain_line text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cb39-monday-card', 0)) THEN RETURN jsonb_build_object('sent', false, 'reason', 'busy'); END IF;
  IF p_now < wk + interval '16 hours' THEN RETURN jsonb_build_object('sent', false, 'reason', 'before_release_window'); END IF;
  key := 'cb39-judge:' || to_char(wk AT TIME ZONE 'UTC', 'YYYY-MM-DD');

  SELECT coalesce(sum(n), 0)::int, string_agg(lane_label || ' ' || n, ', ' ORDER BY ord), max(newest)
    INTO n_total, by_lane, last_release
    FROM (SELECT CASE m.client_id WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Rise' ELSE 'Arch' END AS lane_label,
                 CASE m.client_id WHEN 'ivan' THEN 1 WHEN 'risedtc' THEN 2 ELSE 3 END AS ord,
                 count(*) AS n, max(m.released_at) AS newest
            FROM public.cb34_p2_members m
            JOIN public.carousel_drafts d ON d.id = m.draft_id
           WHERE m.state = 'released' AND m.validation ->> 'verdict' = 'PASS'
             AND m.released_at >= wk AND m.released_at <= p_now
             AND ((m.client_id = 'ivan' AND d.client_id IS NULL) OR (m.client_id <> 'ivan' AND d.client_id = m.client_id))
             AND d.status IN ('review','error') AND d.published_at IS NULL
             AND NOT coalesce((d.taxonomy ->> 'deleted_by_operator') = 'true', false)
             AND NOT EXISTS (SELECT 1 FROM public.cb39_draft_verdicts v WHERE v.draft_id = m.draft_id)
           GROUP BY m.client_id) x;

  IF n_total = 0 THEN RETURN jsonb_build_object('sent', false, 'reason', 'nothing_to_judge', 'week', wk); END IF;
  IF p_now - last_release < interval '45 minutes' AND p_now < wk + interval '30 hours' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'settling', 'to_judge', n_total, 'last_release', last_release); END IF;

  -- Last week's verdicts (Monday to Monday, UTC).
  SELECT count(*) FILTER (WHERE verdict = 'keep'), count(*) FILTER (WHERE verdict = 'edited'), count(*) FILTER (WHERE verdict = 'drop')
    INTO n_keep, n_edit, n_drop
    FROM public.cb39_draft_verdicts WHERE decided_at >= wk - interval '7 days' AND decided_at < wk;

  -- Run 37's results line, only when there is a mature read: posts that reached 7 days last week, with impressions
  -- at 7 days and a known buyer-engager count. Any failure of the read leaves the line out.
  results_line := NULL;
  BEGIN
    FOREACH c IN ARRAY ARRAY['ivan','risedtc','arch'] LOOP
      SELECT CASE WHEN count(*) > 0 THEN
               CASE c WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Rise' ELSE 'Arch' END || ' ' || count(*) || ' post' ||
               CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ', ' || sum(r.buyer_engagers) || ' buyer engager' ||
               CASE WHEN sum(r.buyer_engagers) = 1 THEN '' ELSE 's' END END
        INTO part
        FROM public.cb37_results(c, ((wk - interval '14 days') AT TIME ZONE 'UTC')::date) r
       WHERE r.published_at >= wk - interval '14 days' AND r.published_at < wk - interval '7 days'
         AND r.imp_7d IS NOT NULL AND r.buyer_engagers IS NOT NULL;
      IF part IS NOT NULL THEN results_line := coalesce(results_line || '; ', '') || part; END IF;
    END LOOP;
  EXCEPTION WHEN others THEN results_line := NULL;
  END;

  -- Self-updating brain (11 Oct 2026): one feed line, what changed this month with Undo, default "nothing changed".
  BEGIN brain_line := public.brain_monday_line(p_now); EXCEPTION WHEN others THEN brain_line := NULL; END;

  v_title := n_total || ' new brain draft' || CASE WHEN n_total = 1 THEN '' ELSE 's' END || '. Tap to judge.';
  v_body := by_lane || '. Approve or Drop on each card in Review, about 2 minutes.'
    || E'\nLast week: ' || n_keep || ' kept, ' || n_edit || ' edited, ' || n_drop || ' dropped.'
    || CASE WHEN results_line IS NOT NULL THEN E'\nResults at 7 days: ' || results_line || '.' ELSE '' END
    || CASE WHEN brain_line IS NOT NULL THEN E'\n' || brain_line ELSE '' END;

  SELECT * INTO existing FROM public.inbox_notifications WHERE dedupe_key = key AND source = 'cb39-judge' ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    IF existing.read_at IS NULL AND existing.dismissed_at IS NULL AND (existing.title IS DISTINCT FROM v_title OR existing.body IS DISTINCT FROM v_body) THEN
      UPDATE public.inbox_notifications SET title = v_title, body = v_body, last_seen_at = p_now WHERE id = existing.id;
      RETURN jsonb_build_object('sent', false, 'reason', 'refreshed', 'id', existing.id, 'to_judge', n_total);
    END IF;
    RETURN jsonb_build_object('sent', false, 'reason', 'already_sent', 'id', existing.id);
  END IF;

  INSERT INTO public.inbox_notifications(family, source, dedupe_key, severity, title, body, url, tenant, group_key, push_result)
  VALUES ('brain_drafts_pending', 'cb39-judge', key, 'info', v_title, v_body, '#exp/d/content/now', NULL, key,
          jsonb_build_object('skipped', 'feed_only'))
  RETURNING * INTO existing;
  RETURN jsonb_build_object('sent', true, 'id', existing.id, 'to_judge', n_total, 'title', v_title, 'body', v_body);
END $function$;
