-- Rollback of 20261114f_content_stranger_read.sql: the two readers back to their definitions before it (byte for byte),
-- the cron job and the new functions removed. The reads table, the state row and the prompt row are kept for the record.
BEGIN;
CREATE OR REPLACE FUNCTION public.content_card_candidates(p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(draft_id uuid, created_at timestamp with time zone, poland boolean, lift numeric, poland_lane boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select d.id, d.created_at, public.content_card_poland(d.id),
         coalesce((select case when x.m[2]::numeric > 0 then replace(x.m[1], ',', '')::numeric / x.m[2]::numeric
                               else replace(x.m[1], ',', '')::numeric end
                     from regexp_match(coalesce(d.source_label, ''), '([0-9][0-9,]*) likes vs own median ([0-9]+(?:\.[0-9]+)?)', 'i') as x(m)), 0),
         coalesce(public.content_card_poland(d.id), false)
           or (jsonb_typeof(d.source_detail) = 'object' and public.content_card_jstrim(coalesce(d.source_detail ->> 'kind', '')) = 'x_tracked_outlier')
           or public.content_card_jstrim(coalesce(public.content_card_tax(d.taxonomy) ->> 'source', '')) = 'x_tracked_outlier'
    from public.carousel_drafts d
   where d.client_id is null
     and d.status = 'review'
     and d.scheduled_at is null
     and d.published_at is null
     and d.type in ('text', 'single_image', 'image')
     and d.qa ->> 'verdict' = 'PASS'
     and public.cb34_p2_review_block(d.qa, d.taxonomy) is null
     and d.created_at > p_now - interval '30 days'
     and nullif(btrim(coalesce(d.post_body, '')), '') is not null
     and not coalesce(public.content_card_tax(d.taxonomy) -> 'internal_test' = 'true'::jsonb, false)
     and left(ltrim(coalesce(d.title, '')), 16) <> '[new voice test]'
     and coalesce(public.content_card_tax(d.taxonomy) ->> 'deleted_by_operator', '') <> 'true'
     and not exists (select 1 from public.content_daily_cards c where c.draft_id = d.id)
     -- a brain draft: only once released and validated for Ivan's seat (cb34_p2_read_guard's member rule)
     and (not exists (select 1 from public.cb34_p2_members m where m.draft_id = d.id)
          or exists (select 1 from public.cb34_p2_members m where m.draft_id = d.id and m.state = 'released'
                       and m.validation ->> 'verdict' = 'PASS' and m.client_id = 'ivan'))
$function$;

CREATE OR REPLACE FUNCTION public.content_autopilot_candidates(p_account text, p_week date, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  e jsonb; out jsonb := '[]'::jsonb; f jsonb; why text[]; sc numeric; rd jsonb; v_pw date; v_slot uuid; age int;
BEGIN
  FOR e IN SELECT x FROM jsonb_array_elements(public.content_brain_eligibility(p_account, p_now)) x LOOP
    f := e -> 'fails'; why := '{}'; sc := 0; age := (e ->> 'age_days')::int;
    SELECT s.week_start, s.id INTO v_pw, v_slot FROM public.content_plan_slots s
     WHERE s.account = p_account AND ((s.idea_source = 'carousel_drafts' AND s.idea_ref = e ->> 'draft_id')
       OR (p_account='ivan' AND s.idea_source='lm_idea_candidates' AND EXISTS (
         SELECT 1 FROM public.lm_idea_candidates l WHERE l.id::text=s.idea_ref AND l.promoted_draft_id::text=e->>'draft_id')))
       AND s.status IN ('planned','proposal','requested') ORDER BY s.created_at DESC LIMIT 1;
    IF NOT FOUND THEN v_pw := NULL; v_slot := NULL; END IF;
    -- plan-relative: a draft the plan holds for another week stays there
    IF v_pw IS NOT NULL AND v_pw <> p_week THEN
      f := f || to_jsonb('planned for the week of ' || to_char(v_pw, 'FMDD Mon'));
    END IF;

    -- score (only explains the order; every pick already passed every check)
    IF e ->> 'status' = 'approved' OR (e ->> 'verdict' = 'keep' AND e ->> 'verdict_source' <> 'implicit') THEN sc := sc + 100; why := why || 'you approved it'::text; END IF;
    IF v_pw = p_week THEN sc := sc + 50; why := why || 'the planner put it in this week'::text; END IF;
    IF e ->> 'qa_outcome' = 'passed' THEN sc := sc + 10; why := why || 'QA passed first time'::text;
    ELSIF e ->> 'qa_outcome' = 'recovered' THEN sc := sc + 5; why := why || 'QA passed after one rewrite'::text; END IF;
    rd := e -> 'read';
    IF jsonb_typeof(rd) = 'object' AND rd ->> 'proven' = 'true' AND coalesce(rd ->> 'small', 'false') <> 'true'
       AND (rd ->> 'rate') ~ '^[0-9.]+$' AND (rd ->> 'base') ~ '^[0-9.]+$' AND (rd ->> 'rate')::numeric > (rd ->> 'base')::numeric THEN
      sc := sc + 15; why := why || ('its kind of post (' || coalesce(rd ->> 'dim', '?') || ' ' || coalesce(rd ->> 'val', '?') || ') is proven above your usual');
    END IF;
    sc := sc + greatest(0, 10 - age / 3.0);
    IF e ->> 'source_ref' LIKE 'outlier:%' THEN why := why || ('adapts a niche outlier by ' || coalesce(e ->> 'brief_author', e ->> 'author', 'an unnamed author')); END IF;
    IF e ->> 'must_carry' IN ('verifier','replay') THEN why := why || 'carries what made the winner work'::text; END IF;

    out := out || jsonb_build_array(jsonb_build_object(
      'draft_id', e -> 'draft_id', 'title', e -> 'title', 'status', e -> 'status', 'type', e -> 'type',
      'pillar', e -> 'pillar', 'founder', e -> 'founder', 'opener', e -> 'opener', 'source_ref', e -> 'source_ref', 'author', e -> 'author',
      'author_name', e -> 'author_name', 'created_at', e -> 'created_at', 'age_days', age,
      'must_carry', e -> 'must_carry', 'planned_week', v_pw, 'plan_slot_id', v_slot, 'body_sha256', e -> 'body_sha256',
      'eligible', jsonb_array_length(f) = 0, 'fails', f, 'warnings', e -> 'warnings',
      'score', round(sc, 1), 'why', to_jsonb(why)));
  END LOOP;
  RETURN out;
END $function$;

SELECT cron.unschedule('content-stranger-read') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-stranger-read');
DROP FUNCTION IF EXISTS public.content_stranger_block(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.content_stranger_tick();
DROP FUNCTION IF EXISTS public.content_stranger_save(uuid, text, text, text, jsonb, text, int, text);
DROP FUNCTION IF EXISTS public.content_stranger_due(int);
DROP FUNCTION IF EXISTS public.content_stranger_scope(uuid);
UPDATE public.content_prompts SET is_active = false WHERE slug = 'ivan-stranger-read';
COMMIT;
