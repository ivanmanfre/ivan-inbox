-- 20261116a: an automatic (autopilot) post of Ivan's that missed its time leaves the publisher's retry loop.
--
-- Found 2026-11-16: queue row 64803ecd (draft f92d9e05, "An agency founder said they're nervous about their largest
-- client...") was due Fri 13 Nov 12:00 UTC. Its automatic review no longer matched the draft, and a passed slot is never
-- reviewed again (content_autonomy_review_due_ivan admits a scheduled post only until 20 min before its slot, and
-- review_save refuses inside the last 10). So content_autonomy_publish_state_ivan says required=true, eligible=false
-- forever, the Scheduled Post Publisher (0Ym6bP7gEmskPJZn) refuses it every 5 minutes ("autonomy_review_stale") and
-- nothing tells Ivan. The publisher reads the oldest 5 due rows only (limit=5), so five such rows would starve every
-- real post behind them. The two loop-GIF posts (20 and 25 Nov) are on the same road.
--
-- The fix: once an automatic post is 15 minutes past its time and its publish state still says it may not go out,
--   * its queue row is cancelled with the reason (it leaves the loop; the calendar stops drawing it),
--   * its automatic pick is released and the draft goes back to Review with no date (status and date only: the text,
--     files and QA are not touched, and nothing is approved),
--   * a receipt row is written (content_missed_posts) and ONE alert goes to Ivan's inbox (dedupe key per queue row).
-- From Review the existing paths apply: the automatic reviewer reviews it fresh (status review, no date), and the
-- autopilot may give it a new slot (content_autopilot_schedule_ivan re-arms the pick); or Ivan schedules it himself.
-- This is not a pull: nothing goes into content_owner_pulls, so the autopilot is not told "you pulled it".
--
-- Never touched: posts Ivan placed himself (publish state required=false), any post whose state says it may go out
-- (a late but eligible post still publishes), client lanes, a draft with a sibling queue row being published right now.
-- Runs from pg_cron every 5 minutes as the owner; nobody else may call it.

CREATE TABLE IF NOT EXISTS public.content_missed_posts (
  queue_id uuid PRIMARY KEY REFERENCES public.scheduled_posts(id),
  draft_id uuid,
  slot_at timestamptz NOT NULL,
  fails jsonb NOT NULL DEFAULT '[]'::jsonb,
  draft_returned boolean NOT NULL DEFAULT false,
  parked_at timestamptz NOT NULL DEFAULT now(),
  notify jsonb
);
ALTER TABLE public.content_missed_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.content_missed_posts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.content_missed_posts TO service_role;
COMMENT ON TABLE public.content_missed_posts IS 'db/20261116a: one row per automatic Ivan post that missed its time and was taken out of the publish loop (queue row cancelled, draft back to Review, one alert).';

CREATE OR REPLACE FUNCTION public.content_autonomy_park_missed_ivan(p_now timestamptz DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE r record; q public.scheduled_posts%ROWTYPE; d public.carousel_drafts%ROWTYPE; s jsonb; fails jsonb;
  v_returned boolean; v_gif boolean; v_reason text; v_snip text; v_when text; v_body text; v_payload jsonb;
  v_url text; v_secret text; v_req bigint; v_notify jsonb; parked jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
BEGIN
  -- Same account lock as the publisher claim and the calendar functions. Busy: try again on the next tick.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('content-plan:ivan', 0)) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'calendar_busy');
  END IF;
  FOR r IN
    SELECT q0.id FROM public.scheduled_posts q0 JOIN public.carousel_drafts d0 ON d0.id::text = q0.clickup_task_id
     WHERE q0.platform = 'linkedin' AND q0.status = 'pending' AND coalesce(q0.is_repost, false) = false
       AND d0.client_id IS NULL AND q0.scheduled_at <= p_now - interval '15 minutes'
     ORDER BY q0.scheduled_at, q0.id
  LOOP
    BEGIN
      -- Lock order as the claim and the pull: account lock, queue row, draft.
      SELECT * INTO q FROM public.scheduled_posts WHERE id = r.id FOR UPDATE;
      IF q.status IS DISTINCT FROM 'pending' THEN CONTINUE; END IF;
      SELECT * INTO d FROM public.carousel_drafts WHERE id::text = q.clickup_task_id AND client_id IS NULL FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      s := public.content_autonomy_publish_state_ivan(q.id);
      -- Only automatic posts that may not go out. A late post that may go out still goes out.
      IF s->>'required' IS DISTINCT FROM 'true' OR s->>'eligible' = 'true' THEN CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM public.scheduled_posts x WHERE x.clickup_task_id = q.clickup_task_id AND x.id <> q.id AND x.status = 'posting') THEN
        skipped := skipped || jsonb_build_array(jsonb_build_object('queue_id', q.id, 'why', 'sibling_posting'));
        CONTINUE;
      END IF;
      fails := CASE WHEN jsonb_typeof(s->'fails') = 'array' THEN s->'fails' ELSE '[]'::jsonb END;

      UPDATE public.scheduled_posts
         SET status = 'cancelled',
             error_message = left('missed_slot: ' || coalesce((SELECT string_agg(f, '; ') FROM jsonb_array_elements_text(fails) f), 'not eligible')
                                  || '. Back in Review ' || to_char(p_now AT TIME ZONE 'Europe/Warsaw', 'YYYY-MM-DD HH24:MI') || ' Warsaw.', 300)
       WHERE id = q.id AND status = 'pending';
      UPDATE public.content_autopilot_picks SET state = 'released' WHERE draft_id = d.id AND state = 'armed';
      -- The draft goes back to Review only when it is still the scheduled post of exactly this slot and nothing else of it
      -- waits in the queue. Same writes as the owner pull, without the "you pulled it" mark.
      v_returned := false;
      IF d.status = 'scheduled' AND d.published_at IS NULL AND d.scheduled_at IS NOT DISTINCT FROM q.scheduled_at
         AND NOT EXISTS (SELECT 1 FROM public.scheduled_posts x WHERE x.clickup_task_id = q.clickup_task_id AND x.status IN ('pending', 'posting')) THEN
        UPDATE public.carousel_drafts
           SET status = 'review', scheduled_at = NULL,
               taxonomy = CASE WHEN jsonb_typeof(taxonomy) = 'object' THEN taxonomy - 'hand_dated_at' ELSE taxonomy END
         WHERE id = d.id;
        IF EXISTS (SELECT 1 FROM public.carousel_drafts WHERE id = d.id AND (status = 'scheduled' OR scheduled_at IS NOT NULL)) THEN
          RAISE EXCEPTION 'draft % did not leave the schedule', d.id;
        END IF;
        v_returned := true;
      END IF;
      IF EXISTS (SELECT 1 FROM public.scheduled_posts WHERE id = q.id AND status IN ('pending', 'posting')) THEN
        RAISE EXCEPTION 'queue row % did not leave the loop', q.id;
      END IF;

      -- One alert for this queue row: the row is no longer pending, so the sweep never sees it again.
      v_gif := EXISTS (SELECT 1 FROM jsonb_array_elements_text(fails) f WHERE f ILIKE '%GIF%');
      v_reason := coalesce((SELECT string_agg(CASE
          WHEN f = 'automatic review is missing or stale' THEN 'its automatic review no longer matched the post'
          WHEN f ILIKE '%GIF%' THEN 'its GIF needs your look, the automatic review cannot check every frame'
          WHEN f = 'automatic pick is held or stale' THEN 'its automatic pick no longer matched the slot'
          ELSE f END, '; ') FROM jsonb_array_elements_text(fails) f), 'it was not cleared to post');
      v_snip := btrim(split_part(coalesce(q.post_text, d.post_body, ''), E'\n', 1));
      v_snip := CASE WHEN length(v_snip) > 70 THEN rtrim(left(v_snip, 70)) || '...' ELSE v_snip END;
      v_when := to_char(q.scheduled_at AT TIME ZONE 'Europe/Warsaw', 'Dy DD Mon HH24:MI');
      v_body := '"' || v_snip || '" was due ' || v_when || ' and did not go out: ' || v_reason || '. '
        || CASE WHEN NOT v_returned THEN 'It no longer retries.'
                WHEN v_gif THEN 'It is back in Review with no date and waits for you there.'
                ELSE 'It is back in Review with no date. The automatic review checks it again and the autopilot can give it a new slot, or you can schedule it yourself.' END;
      v_payload := jsonb_build_object('family', 'content_plan', 'source', 'content-plan',
        'dedupe_key', 'missed-post:' || q.id::text, 'severity', 'attention',
        'title', 'A post missed its time', 'body', left(v_body, 1500),
        'url', './#exp/d/content/now?focus=' || d.id::text,
        'media', jsonb_build_object('kind', 'missed_post', 'queue_id', q.id, 'draft_id', d.id, 'slot_at', q.scheduled_at),
        'push', true);
      BEGIN
        SELECT value INTO v_url FROM public.integration_config WHERE key = 'inbox_notify_url';
        SELECT value INTO v_secret FROM public.integration_config WHERE key = 'inbox_push_secret';
        SELECT net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
                 body := v_payload, timeout_milliseconds := 30000) INTO v_req;
        v_notify := jsonb_build_object('request_id', v_req, 'dedupe_key', v_payload->>'dedupe_key', 'body', v_payload->>'body');
      EXCEPTION WHEN others THEN v_notify := jsonb_build_object('error', left(SQLERRM, 300), 'body', v_payload->>'body');
      END;
      INSERT INTO public.content_missed_posts (queue_id, draft_id, slot_at, fails, draft_returned, parked_at, notify)
      VALUES (q.id, d.id, q.scheduled_at, fails, v_returned, now(), v_notify)
      ON CONFLICT (queue_id) DO NOTHING;
      parked := parked || jsonb_build_array(jsonb_build_object('queue_id', q.id, 'draft_id', d.id, 'slot_at', q.scheduled_at,
        'fails', fails, 'draft_returned', v_returned));
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        skipped := skipped || jsonb_build_array(jsonb_build_object('queue_id', r.id, 'why', 'row_busy'));
      WHEN others THEN
        -- This row's writes are undone (the block is a savepoint); the next tick tries again, and the failure is visible
        -- once a day per row, not every 5 minutes.
        INSERT INTO public.silent_failures (source, detail)
        SELECT 'content-missed-post-park', jsonb_build_object('message', 'a missed automatic post could not be taken out of the publish loop',
          'queue_id', r.id, 'error', left(SQLERRM, 500))
         WHERE NOT EXISTS (SELECT 1 FROM public.silent_failures sf WHERE sf.source = 'content-missed-post-park'
                             AND sf.detail->>'queue_id' = r.id::text AND sf.created_at > now() - interval '24 hours');
        skipped := skipped || jsonb_build_array(jsonb_build_object('queue_id', r.id, 'why', 'error', 'error', left(SQLERRM, 200)));
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'parked', parked, 'skipped', skipped);
END $function$;
REVOKE ALL ON FUNCTION public.content_autonomy_park_missed_ivan(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule('content-missed-post-park', '*/5 * * * *', $cron$select public.content_autonomy_park_missed_ivan()$cron$);
