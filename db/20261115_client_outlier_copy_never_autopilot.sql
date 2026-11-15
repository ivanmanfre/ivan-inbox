-- 2026-11-15: a client-seat outlier copy is never an autopilot or content-plan candidate.
-- RISE copy mode went live 2026-11-14 (integration_config rise_outlier_copy = on, review_kind outlier_copy). Ivan's copies
-- are kept out of autopilot by content_autonomy_base_ivan. A client seat had no such rule: content_brain_eligibility let a
-- released copy through as soon as a must-carry result was on it. RISE autopilot is off today and its live step is not
-- built; this closes the door before either changes. One added check (11); everything else is the function as it was live
-- on 2026-11-15. Readers: content_autopilot_candidates, content_plan_apply, content_plan_brain_needs_ivan, content_plan_week
-- and what calls them (all database functions). Rollback: 20261115_client_outlier_copy_never_autopilot_rollback.sql.
CREATE OR REPLACE FUNCTION public.content_brain_eligibility(p_account text, p_now timestamp with time zone DEFAULT now(), p_ids uuid[] DEFAULT NULL::uuid[], p_pick_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
-- Every brain draft of the seat that could take a slot (Review or approved, undated, not deleted, not an internal test),
-- with every check it fails, in plain words. checks_failed = the checks that do not depend on the day; usable_until = the
-- last day it is fresh enough; fails = checks_failed plus 'older than N days' when judged at p_pick_at (default p_now).
-- eligible = fails is empty. The autopilot candidates and the content plan both read this; change a check only here.
DECLARE
  cfg public.content_autopilot_config%ROWTYPE;
  v_ids uuid[]; v_brain jsonb := '{}'::jsonb; b jsonb; r record; out jsonb := '[]'::jsonb;
  f text[]; wn text[]; inv jsonb; chk jsonb; mc jsonb; bv3 jsonb; v_carry text; v_until date; v_fails text[]; auto_gate jsonb; auto_fails text[];
BEGIN
  SELECT * INTO cfg FROM public.content_autopilot_config WHERE account = p_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'no autopilot config for %', p_account; END IF;

  SELECT array_agg(d.id) INTO v_ids
    FROM public.carousel_drafts d JOIN public.cb34_p2_members m ON m.draft_id = d.id
   WHERE m.client_id = p_account
     AND (CASE WHEN p_account = 'ivan' THEN d.client_id IS NULL ELSE d.client_id = p_account END)
     AND d.status IN ('review','approved') AND d.scheduled_at IS NULL AND d.published_at IS NULL
     AND NOT coalesce(jsonb_typeof(d.taxonomy) = 'object' AND d.taxonomy ->> 'deleted_by_operator' = 'true', false)
     AND NOT coalesce(jsonb_typeof(d.taxonomy) = 'object' AND d.taxonomy ->> 'internal_test' = 'true', false)
     AND (p_ids IS NULL OR d.id = ANY (p_ids));
  IF v_ids IS NULL THEN IF p_account<>'ivan' THEN RETURN out; ELSE v_ids:='{}'::uuid[]; END IF; END IF;
  BEGIN
    SELECT coalesce(jsonb_object_agg(x.draft_id::text, x.brain), '{}'::jsonb) INTO v_brain
      FROM public.content_plan_brain_items(p_account, v_ids, p_now) x;
  EXCEPTION WHEN others THEN v_brain := '{}'::jsonb;  -- fail closed below: no brain facts = 'fact check unreadable'
  END;

  FOR r IN
    SELECT d.id, d.status, d.type, coalesce(nullif(d.title,''), left(d.post_body, 80)) AS title, d.post_body, d.image_urls, d.slides, d.pdf_url,
           CASE WHEN jsonb_typeof(d.taxonomy) = 'object' THEN d.taxonomy ELSE '{}'::jsonb END AS tax, d.qa, d.created_at,
           m.state, m.validation AS val, m.source_ref, m.brief,
           public.cb35_source_author(p_account, m.source_ref, m.brief ->> 'source_author') AS author,
           encode(sha256(convert_to(coalesce(d.post_body, ''), 'UTF8')), 'hex') AS sha,
           (SELECT v.verdict FROM public.cb39_draft_verdicts v WHERE v.draft_id = d.id) AS verdict,
           (SELECT v.source FROM public.cb39_draft_verdicts v WHERE v.draft_id = d.id) AS verdict_source,
           mr.verdict AS mr_verdict, mr.carry_pass AS mr_carry, mr.length_pass AS mr_len, mr.body_sha256 AS mr_sha
      FROM public.carousel_drafts d
      JOIN public.cb34_p2_members m ON m.draft_id = d.id
      LEFT JOIN public.cb_must_carry_replay mr ON mr.draft_id = d.id
     WHERE d.id = ANY (v_ids)
  LOOP
    f := '{}'; wn := '{}';
    b := v_brain -> (r.id::text);
    chk := CASE WHEN jsonb_typeof(r.val -> 'checks') = 'object' THEN r.val -> 'checks' ELSE '{}'::jsonb END;

    -- 1. verifier released it
    IF r.state IS DISTINCT FROM 'released' OR coalesce(r.val ->> 'verdict', '') <> 'PASS' THEN
      f := f || ('the verifier did not release it (' || coalesce(r.state, '?') || ', ' || coalesce(r.val ->> 'verdict', 'no verdict') || ')');
    END IF;
    -- 2. Review QA gate (db/277)
    IF public.cb34_p2_review_block(r.qa, r.tax) IS NOT NULL THEN
      f := f || ('the QA gate holds it (' || public.cb34_p2_review_block(r.qa, r.tax) || ')');
    END IF;
    -- 3. invention
    inv := chk -> 'invention';
    IF jsonb_typeof(inv) <> 'object' OR coalesce(inv ->> 'pass', '') <> 'true' THEN
      f := f || 'the invention check did not pass'::text;
    ELSIF (jsonb_typeof(inv -> 'majority') = 'object' AND EXISTS (SELECT 1 FROM jsonb_each_text(inv -> 'majority') e WHERE e.value = 'true'))
       OR (jsonb_typeof(inv -> 'v32') = 'object' AND EXISTS (SELECT 1 FROM jsonb_each_text(inv -> 'v32') e WHERE e.value = 'true'))
       OR (jsonb_typeof(inv -> 'invented_elements') = 'array' AND jsonb_array_length(inv -> 'invented_elements') > 0) THEN
      f := f || 'an invention flag is raised'::text;
    END IF;
    IF b IS NULL THEN
      f := f || 'its fact check could not be read'::text;
    ELSIF coalesce(b -> 'flags' ->> 'fact_fail', '') = 'true' THEN
      f := f || 'the fact check failed'::text;
    END IF;
    -- 4. deterministic checks
    IF coalesce(chk -> 'lint' ->> 'pass', 'true') = 'false' THEN f := f || 'the copy lint failed'::text; END IF;
    IF coalesce(chk -> 'sameness' ->> 'pass', 'true') = 'false' THEN f := f || 'too close to the source post'::text; END IF;
    IF coalesce(chk -> 'length' ->> 'pass', 'true') = 'false' THEN f := f || 'the length check failed'::text; END IF;
    -- 5. must-carry
    mc := chk -> 'must_carry';
    bv3 := CASE WHEN r.brief ->> 'brief_version' = 'cb51-v3' AND jsonb_typeof(r.brief -> 'brief_v3') = 'object' THEN r.brief -> 'brief_v3' END;
    IF jsonb_typeof(mc) = 'object' THEN
      v_carry := CASE WHEN mc ->> 'pass' = 'true' THEN 'verifier' ELSE 'missed' END;
    ELSIF r.mr_verdict IS NOT NULL THEN
      v_carry := CASE WHEN r.mr_sha <> r.sha THEN 'replay_stale' WHEN r.mr_carry AND r.mr_len THEN 'replay' ELSE 'missed_replay' END;
    ELSIF bv3 IS NOT NULL AND bv3 ? 'carry_version' AND coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(bv3 -> 'must_carry') = 'array' THEN bv3 -> 'must_carry' END), 0) = 0 THEN
      v_carry := 'nothing_to_carry';
    ELSE
      v_carry := 'never';
    END IF;
    IF v_carry = 'missed' THEN f := f || 'it misses what the winner had to carry (verifier)'::text;
    ELSIF v_carry = 'missed_replay' THEN f := f || ('it misses what the winner had to carry (15 Oct replay' || CASE WHEN NOT r.mr_len THEN ', length too' ELSE '' END || ')');
    ELSIF v_carry = 'replay_stale' THEN f := f || 'the post changed after the must-carry replay'::text;
    ELSIF v_carry = 'never' THEN f := f || 'the must-carry check never ran on it'::text;
    END IF;
    -- 6. the text that was checked is the text that would post
    IF r.val ->> 'input_body_sha256' IS DISTINCT FROM r.sha THEN
      IF r.tax ->> 'human_edited' = 'true' THEN wn := wn || 'you edited it after the checks ran'::text;
      ELSE f := f || 'the post changed after the checks ran'::text; END IF;
    END IF;
    -- 7. Ivan's own word
    IF r.verdict = 'drop' THEN f := f || 'you dropped it'::text; END IF;
    -- 8. link rule (links only on a lead magnet boosted with paid ads)
    IF coalesce(r.post_body ~* '(https?://|www\.)[^\s]+', false) AND coalesce(r.tax ->> 'paid_boost', '') <> 'true' THEN
      f := f || 'it carries a link'::text;
    END IF;
    -- 9. picture the format needs
    IF r.type = 'single_image' AND coalesce(cardinality(r.image_urls), 0) = 0 THEN f := f || 'it needs a picture and has none'::text; END IF;
    IF r.type IN ('carousel','pdf','document') AND coalesce(cardinality(r.image_urls), 0) = 0 AND r.pdf_url IS NULL
       AND coalesce(jsonb_typeof(r.slides) = 'array' AND jsonb_array_length(r.slides) > 0, false) = false THEN
      f := f || 'its deck is not built'::text;
    END IF;
    IF coalesce(cardinality(r.image_urls), 0) = 0 AND r.type = 'text' THEN wn := wn || 'text only, no picture'::text; END IF;
    -- 11. outlier copy (2026-11-15): a near word-for-word copy of someone else's post waits for a person to edit and date
    --     it. On a client seat it is never a machine pick, whatever its checks say (the verifier releases a good copy with
    --     verdict PASS and five passing checks). Same markers the verifier uses (review_kind, the pick's copy intent), plus
    --     the stamp its release leaves. Ivan's seat is already closed to copies by content_autonomy_base_ivan (exact final
    --     QA PASS + source pack; a copy has qa REVIEW and no pack), so his path is left as it is.
    IF p_account <> 'ivan' AND (r.qa ->> 'review_kind' = 'outlier_copy'
       OR coalesce(r.brief #>> '{pick_note,outlier_copy}', '') NOT IN ('', 'false', 'null')
       OR r.val ->> 'outlier_copy' = 'true') THEN
      f := f || 'it is an outlier copy: a person edits and dates it'::text;
    END IF;
    -- 10. freshness: judged on the day it would be picked
    v_until := r.created_at::date + cfg.max_draft_age_days;
    v_fails := f;
    IF coalesce(p_pick_at, p_now)::date > v_until THEN v_fails := v_fails || ('older than ' || cfg.max_draft_age_days || ' days'); END IF;

    IF p_account='ivan' THEN
      auto_gate:=public.content_autonomy_gate_ivan(r.id);
      SELECT coalesce(array_agg(x),'{}'::text[]) INTO auto_fails FROM jsonb_array_elements_text(auto_gate->'fails') x;
      f:=f||auto_fails; v_fails:=v_fails||auto_fails;
    END IF;

    out := out || jsonb_build_array(jsonb_build_object(
      'draft_id', r.id, 'title', r.title, 'status', r.status, 'type', r.type,
      'pillar', r.tax ->> 'pillar', 'founder', coalesce(r.tax ->> 'pillar' = 'personal', false),
      'opener', b -> 'angle' ->> 'opener', 'source_ref', r.source_ref, 'author', r.author,
      'author_name', b -> 'brief' ->> 'author', 'created_at', r.created_at, 'age_days', (p_now::date - r.created_at::date),
      'usable_until', v_until, 'must_carry', v_carry, 'body_sha256', r.sha,
      'verdict', r.verdict, 'verdict_source', r.verdict_source, 'qa_outcome', b -> 'qa' ->> 'outcome', 'read', b -> 'read',
      'brief_author', b -> 'brief' ->> 'author',
      'checks_failed', to_jsonb(f), 'fails', to_jsonb(v_fails), 'eligible', cardinality(v_fails) = 0, 'warnings', to_jsonb(wn)));
  END LOOP;
  -- Ordinary source-backed drafts use final review without pretending to be brain adaptations.
  IF p_account='ivan' THEN
   FOR r IN SELECT d.*,encode(sha256(convert_to(coalesce(d.post_body,''),'UTF8')),'hex') sha
    FROM public.carousel_drafts d WHERE d.client_id IS NULL AND d.status IN ('review','approved')
     AND d.scheduled_at IS NULL AND d.published_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM public.cb34_p2_members m WHERE m.draft_id=d.id)
     AND coalesce(d.taxonomy->>'deleted_by_operator','')<>'true' AND coalesce(d.taxonomy->>'internal_test','')<>'true'
     AND (p_ids IS NULL OR d.id=ANY(p_ids))
   LOOP
    auto_gate:=public.content_autonomy_gate_ivan(r.id);
    f:='{}'; SELECT coalesce(array_agg(x),'{}'::text[]) INTO f FROM jsonb_array_elements_text(auto_gate->'fails') x;
    v_fails:=f; v_until:=r.created_at::date+cfg.max_draft_age_days;
    IF coalesce(p_pick_at,p_now)::date>v_until THEN v_fails:=v_fails||('older than '||cfg.max_draft_age_days||' days'); END IF;
    out:=out||jsonb_build_array(jsonb_build_object('draft_id',r.id,'title',r.title,'status',r.status,'type',r.type,
     'pillar',r.taxonomy->>'pillar','founder',coalesce(r.taxonomy->>'pillar'='personal',false),
     'opener',null,'source_ref',r.source_ref,'author',null,'author_name',null,
     'created_at',r.created_at,'age_days',p_now::date-r.created_at::date,'usable_until',v_until,
     'must_carry','not_an_adaptation','body_sha256',r.sha,'verdict',null,'verdict_source',null,
     'qa_outcome',CASE WHEN coalesce((auto_gate->>'eligible')::boolean,false) THEN 'passed' ELSE 'held' END,
     'read',null,'brief_author',null,'checks_failed',to_jsonb(f),'fails',to_jsonb(v_fails),
     'eligible',cardinality(v_fails)=0,'warnings','[]'::jsonb));
   END LOOP;
  END IF;
  RETURN out;
END $function$;
