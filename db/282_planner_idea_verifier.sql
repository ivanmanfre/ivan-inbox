-- db/282: Ivan planner ideas enter the existing writer + CB51 verifier.
-- Registration is held, never a fabricated validation. Only active Ivan plan slots,
-- own workspace, non-campaign evergreen post ideas; no client-lane writes.
-- Original ideas have no borrowed winner: carry_version records that provenance.
-- Existing QA, lint, sameness, length, invention, CAS release, weekly cap, eligibility,
-- body hash, human edit and scheduling gates remain in force. Nothing is dated here.
BEGIN;
CREATE OR REPLACE FUNCTION public.content_plan_register_ivan_idea(p_candidate uuid, p_draft uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' SET statement_timeout TO '20s' AS $function$
DECLARE c public.lm_idea_candidates%rowtype; d public.carousel_drafts%rowtype;
  s public.content_plan_slots%rowtype; ev jsonb; owned jsonb; facts text;
  notes text; brief jsonb; payload jsonb; snapshot jsonb; candidate_hash text;
BEGIN
  IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
  SELECT * INTO s FROM public.content_plan_slots WHERE account='ivan' AND idea_source='lm_idea_candidates'
    AND idea_ref=p_candidate::text AND status IN ('planned','requested','proposal')
    AND week_start >= date_trunc('week',now() AT TIME ZONE 'Europe/Warsaw')::date ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('registered',false,'reason','no_active_ivan_slot'); END IF;
  SELECT * INTO c FROM public.lm_idea_candidates WHERE id=p_candidate FOR SHARE;
  IF NOT FOUND OR c.content_type IS DISTINCT FROM 'post'
    OR coalesce(nullif(btrim(lower(c.workspace_type)),''),'own')<>'own' OR c.campaign_id IS NOT NULL
    OR coalesce(c.source,'') IN ('x_viral','x_search','newsjack','breaking_news')
    OR c.lane='content_brain' THEN RETURN jsonb_build_object('registered',false,'reason','not_original_ivan_plan_idea'); END IF;
  SELECT * INTO d FROM public.carousel_drafts WHERE id=p_draft FOR UPDATE;
  IF NOT FOUND OR d.client_id IS NOT NULL OR d.status NOT IN ('generating','planned','review','error','rejected')
    OR d.scheduled_at IS NOT NULL OR d.published_at IS NOT NULL OR coalesce(d.board_visible,false)
    OR coalesce(d.taxonomy->>'human_edited','')='true'
    OR coalesce(d.taxonomy->>'deleted_by_operator','')='true' OR coalesce(d.taxonomy->>'internal_test','')='true'
    OR d.taxonomy->>'source_candidate_id' IS DISTINCT FROM p_candidate::text
    OR (c.promoted_draft_id IS NOT NULL AND c.promoted_draft_id<>p_draft)
    THEN RETURN jsonb_build_object('registered',false,'reason','draft_scope_or_state'); END IF;
  IF EXISTS(SELECT 1 FROM public.cb34_p2_members WHERE draft_id=p_draft) THEN
    RETURN jsonb_build_object('registered',false,'reason','already_registered'); END IF;
  ev:=CASE WHEN jsonb_typeof(c.evidence)='array' THEN c.evidence
           WHEN jsonb_typeof(c.evidence)='object' THEN jsonb_build_array(c.evidence) ELSE '[]'::jsonb END;
  SELECT coalesce(jsonb_agg(e),'[]'::jsonb) INTO owned FROM jsonb_array_elements(ev) e
    WHERE e->>'who' IN ('Ivan','Ivan Manfredi') AND e->>'tier'='FACT' AND coalesce(e->>'quote','')<>'';
  SELECT body INTO facts FROM public.content_prompts WHERE slug='ivan-company-facts';
  snapshot:=jsonb_build_object('candidate_id',c.id,'source',c.source,'source_ref',c.source_ref,'raw_topic',c.raw_topic,
    'post_angle',c.post_angle,'raw_context',c.raw_context,'evidence',c.evidence);
  candidate_hash:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
  notes:=concat_ws(E'\n\n',nullif(c.post_angle,''),
    'IDEA EVIDENCE (who/tier ownership is binding; UNKNOWN is not an author fact): '||ev::text,
    'Use the source briefing in the draft description. Hedges and attribution are facts; do not invent completed events.');
  payload:=jsonb_build_object('draft_id',d.id,'topic',d.topic,'title',d.title,'author','Ivan',
    'source',coalesce(d.taxonomy->>'source',c.source),'post_format',CASE d.type WHEN 'carousel' THEN 'Carousel' WHEN 'single_image' THEN 'Single Image' ELSE 'Text Post' END,
    'post_format_details','auto-promoted from LM Curator','editorial_notes',notes,
    'include_image',CASE WHEN d.type='single_image' THEN 'Yes' ELSE 'No' END,'image_style',d.taxonomy->>'image_style');
  brief:=jsonb_build_object('brief_version','cb51-v3','source_kind','planner_original_idea','plan_slot',s.id,
    'source_ref','idea:lm_idea_candidates:'||c.id,'why_this_post',s.why_now,
    'candidate_snapshot',snapshot,'candidate_sha256',candidate_hash,
    'brief_v3',jsonb_build_object('carry_version','original-idea-v1','must_carry','[]'::jsonb,
      'carry_reason','Original idea: no winner hook or device is borrowed.',
      'length_target',jsonb_build_object('min',130,'max',260,'fail_below',40,'fail_above',420,
        'rule','Original idea: author-voice working range, short takes legal, hard limit 420; no winner length target.')),
    'check_source','IDEA EVIDENCE. Each item keeps its who and tier; only Ivan FACT is author-owned. Other speakers remain other people. Raw topic, angle and context are editorial proposals, not proof of events.'||E'\n'||ev::text
      ||E'\nIVAN COMPANY FACTS:\n'||coalesce(facts,'(none)'),
    'notes',notes,'author','Ivan','webhook','https://n8n.ivanmanfredi.com/webhook/post-gen-v2','payload',payload);
  INSERT INTO public.cb34_p2_members(draft_id,client_id,run_id,week_start,candidate_id,source_ref,source_text,owned_source,brief,state,hold_reason)
  VALUES(d.id,'ivan','cb35-plan-'||s.id,s.week_start,c.id,'idea:lm_idea_candidates:'||c.id,
    'Original planner idea; source evidence is checked for facts and attribution, not a borrowed peer post.',
    CASE WHEN owned='[]'::jsonb THEN 'No attached author-owned FACT quotes. Do not invent author experiences.' ELSE owned::text END,brief,'held',CASE WHEN coalesce(d.type,'') NOT IN ('text','single_image','carousel','pdf','document') THEN 'final: planner format needs its own asset verifier' WHEN c.source='competitor' OR coalesce(c.raw_context,'') ~* '(WINNER POST|WHAT WE BORROW)' THEN 'final: planner source requires a borrowed-winner brief' END)
  ON CONFLICT(draft_id) DO NOTHING;
  RETURN jsonb_build_object('registered',FOUND,'draft_id',d.id,'slot_id',s.id,'candidate_sha256',candidate_hash);
END $function$;
REVOKE ALL ON FUNCTION public.content_plan_register_ivan_idea(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.content_plan_register_ivan_idea(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.content_plan_register_ivan_idea_tg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  -- Browser writes retain their existing behavior; only trusted generation paths register members.
  IF NOT public.content_plan_service_ok() THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='carousel_drafts' THEN
    IF NEW.client_id IS NULL AND coalesce(NEW.taxonomy->>'source_candidate_id','') ~ '^[0-9a-fA-F-]{36}$' THEN
      PERFORM public.content_plan_register_ivan_idea((NEW.taxonomy->>'source_candidate_id')::uuid,NEW.id);
    END IF;
  ELSIF NEW.promoted_draft_id IS NOT NULL AND NEW.promoted_draft_table='carousel_drafts' THEN
    PERFORM public.content_plan_register_ivan_idea(NEW.id,NEW.promoted_draft_id);
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.content_plan_register_ivan_idea_tg() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER content_plan_register_ivan_draft AFTER INSERT ON public.carousel_drafts
FOR EACH ROW EXECUTE FUNCTION public.content_plan_register_ivan_idea_tg();
CREATE TRIGGER content_plan_register_ivan_candidate AFTER UPDATE OF promoted_draft_id ON public.lm_idea_candidates
FOR EACH ROW EXECUTE FUNCTION public.content_plan_register_ivan_idea_tg();

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
END $function$
;
CREATE OR REPLACE FUNCTION public.content_plan_week(p_account text, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
AS $function$
declare
  cfg public.content_plan_config%rowtype;
  v_today date := (p_now at time zone 'Europe/Warsaw')::date;
  w0 date; target int; lm_target int; pol jsonb;
  weeks jsonb := '[]'::jsonb; wk date; i int; posts jsonb; planned jsonb; n_posts int; n_planned int; target_week date := null;
  done jsonb; supply jsonb; warnings jsonb := '[]'::jsonb; last_run jsonb; n int; open_target int := 0;
  founder_n int; photos int; fresh_proof int; r record;
  -- db/259: brain data
  v_done_ids uuid[]; v_ids uuid[]; v_brain jsonb; v_blank jsonb; v_med numeric; v_items jsonb; v_xdays jsonb := '[]'::jsonb; v_strip jsonb;
  b_weeks jsonb; b_supply jsonb; b_warn jsonb; b_done jsonb; v_rule record; v_max int; v_min int; v_err text;
  v_tz text := case when p_account = 'risedtc' then 'America/Los_Angeles' else 'Europe/Warsaw' end;
  -- db/281: the autopilot's own eligibility rule, on seats where the autopilot is on
  v_gate boolean := false; v_elig jsonb := '{}'::jsonb; blocked jsonb; v_blocked_all jsonb := '[]'::jsonb; v_supply_ok int;
begin
  if not public.cb39_lane_ok(p_account) then raise exception 'unknown seat'; end if;
  select * into cfg from public.content_plan_config where account = p_account;
  if not found then raise exception 'no plan config for %', p_account; end if;
  w0 := v_today - (extract(isodow from v_today)::int - 1);
  if p_account = 'ivan' then
    select (variables[1])::jsonb into pol from public.content_prompts where slug = 'format-mix-policy-2026' and is_active order by updated_at desc limit 1;
  end if;
  target := coalesce(cfg.posts_per_week, (pol->>'max_posts_per_week')::int);
  lm_target := coalesce(cfg.lm_per_week, (pol->>'lm_carousel_per_week')::int, 0);
  if target is null then raise exception 'no cadence for %', p_account; end if;

  -- db/281: on a seat where the autopilot is on, a written draft is planned only when it passes the autopilot's own checks
  -- (content_brain_eligibility, the one rule both read). Unreadable checks = no written draft can be planned (fail closed).
  v_gate := exists (select 1 from public.content_autopilot_config a where a.account = p_account and a.mode <> 'off');
  if v_gate then
    begin
      select coalesce(jsonb_object_agg(e->>'draft_id', e), '{}'::jsonb) into v_elig
        from jsonb_array_elements(public.content_brain_eligibility(p_account, p_now)) e;
    exception when others then v_elig := null;
    end;
  end if;

  for i in 0..2 loop
    wk := w0 + 7*i;
    -- Posts already holding a slot: dated drafts on the Warsaw week, plus Ivan's publish-queue rows with no draft.
    select coalesce(jsonb_agg(x.j order by x.at), '[]'::jsonb), count(*) into posts, n_posts from (
      select coalesce(d.published_at, d.scheduled_at) at, jsonb_build_object(
        'kind','post','draft_id', d.id, 'title', coalesce(nullif(d.title,''), left(d.post_body, 80)),
        'day', (coalesce(d.published_at, d.scheduled_at) at time zone 'Europe/Warsaw')::date,
        'at', coalesce(d.published_at, d.scheduled_at), 'status', d.status,
        'format', d.type, 'lead_magnet', d.taxonomy ?| array['lead_magnet','lead_magnet_slug','gate_keyword'] or exists (select 1 from public.scheduled_posts q0
            where q0.clickup_task_id = d.id::text and (q0.post_kind = 'capture' or q0.lead_magnet_slug is not null)),
        'founder', d.taxonomy->>'pillar' = 'personal',
        'picture', case when d.type in ('carousel','pdf') then 'carousel deck' when d.type = 'video' then 'video'
                        when coalesce(array_length(d.image_urls,1),0) > 0 then 'picture' else 'no picture' end,
        'board_visible', d.board_visible,
        'evidence', public.content_plan_post_evidence(d.id)) j
      from public.carousel_drafts d
      where (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end)
        and d.status in ('review','approved','scheduled','published')
        and not coalesce((d.taxonomy->>'deleted_by_operator') = 'true', false)
        and coalesce(d.published_at, d.scheduled_at) >= (wk::timestamp at time zone 'Europe/Warsaw')
        and coalesce(d.published_at, d.scheduled_at) < ((wk + 7)::timestamp at time zone 'Europe/Warsaw')
      union all
      select q.scheduled_at, jsonb_build_object('kind','post','queue_id', q.id, 'title', left(q.post_text, 80),
        'day', (q.scheduled_at at time zone 'Europe/Warsaw')::date, 'at', q.scheduled_at, 'status', q.status,
        'format', q.post_format, 'lead_magnet', q.post_kind = 'capture' or q.lead_magnet_slug is not null, 'founder', false,
        'picture', case when q.post_format in ('carousel','pdf') then 'carousel deck' when q.post_format = 'video' then 'video'
                        when coalesce(array_length(q.media_urls,1),0) > 0 then 'picture' else 'no picture' end,
        'evidence', jsonb_build_array(jsonb_build_object('type','queue','label','In the publish queue')))
      from public.scheduled_posts q
      where p_account = 'ivan' and q.platform = 'linkedin' and q.status in ('pending','posted') and coalesce(q.is_repost,false) = false
        and q.scheduled_at >= (wk::timestamp at time zone 'Europe/Warsaw') and q.scheduled_at < ((wk + 7)::timestamp at time zone 'Europe/Warsaw')
        and not exists (select 1 from public.carousel_drafts d2 where d2.client_id is null and d2.status in ('review','approved','scheduled','published')
                          and (d2.scheduled_at = q.scheduled_at or d2.published_at = q.posted_at))
    ) x;

    -- Planned slots of this week that have not become a dated post yet.
    select coalesce(jsonb_agg(y.j order by y.created_at) filter (where y.reason is null), '[]'::jsonb), count(*) filter (where y.reason is null),
           coalesce(jsonb_agg(jsonb_build_object('slot_id', y.j->'slot_id', 'draft_id', y.j->'draft_id', 'topic', y.j->'topic', 'reason', y.reason)
                              order by y.created_at) filter (where y.reason is not null), '[]'::jsonb)
      into planned, n_planned, blocked from (
      select s.created_at, bl.reason, jsonb_build_object('kind','planned','slot_id', s.id, 'topic', s.topic, 'why_now', s.why_now,
        'evidence', s.evidence, 'format', s.format, 'picture', s.picture, 'idea_source', s.idea_source, 'idea_ref', s.idea_ref,
        'proposal', cfg.proposals_only and st.status = 'proposal', 'status', st.status, 'status_label', st.label, 'draft_id', st.draft_id) j
      from public.content_plan_slots s
      cross join lateral (
        select case
          when s.idea_source = 'carousel_drafts' then (select case when d.status = 'review' then 'waiting_review' else 'dropped' end from public.carousel_drafts d where d.id::text = s.idea_ref and d.scheduled_at is null)
          when s.idea_source = 'lm_idea_candidates' then (select case when l.status in ('reviewing','pending') then case when s.status = 'requested' then 'requested' else 'planned' end
                                                                       when l.status in ('promoted','approved') then coalesce((select case
                when cd.status in ('review','approved') then case when mb.state='held' and coalesce(mb.hold_reason,'') !~ '^final:' then 'drafting' else 'waiting_review' end
                when cd.status in ('error','rejected','archived') then 'waiting_review' else 'drafting' end
                from public.carousel_drafts cd left join public.cb34_p2_members mb on mb.draft_id=cd.id
                where cd.id=l.promoted_draft_id and cd.client_id is null),'drafting') else 'dropped' end from public.lm_idea_candidates l where l.id::text = s.idea_ref)
          else (select case when ci.status = 'staged' then 'proposal'
                            when ci.status in ('approved','live') then
                              case when exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id)
                                        and not exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status not in ('error','archived')) then 'failed'
                                   when exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status = 'review') then 'waiting_review'
                                   else 'drafting' end
                            else 'dropped' end from public.client_ideas ci where ci.id::text = s.idea_ref)
        end as status0,
        (select coalesce(case when s.idea_source = 'carousel_drafts' then s.idea_ref::uuid end,
                         (select l.promoted_draft_id from public.lm_idea_candidates l where s.idea_source = 'lm_idea_candidates' and l.id::text = s.idea_ref),
                         (select d.id from public.carousel_drafts d where s.idea_source = 'client_ideas' and d.client_idea_id::text = s.idea_ref order by d.created_at desc limit 1))) as draft_id
      ) st0
      cross join lateral (
        select coalesce(st0.status0, 'dropped') as status, st0.draft_id,
          case coalesce(st0.status0,'dropped') when 'waiting_review' then 'Draft waiting in Review' when 'planned' then 'Planned, draft not written yet'
            when 'requested' then 'Draft requested' when 'drafting' then 'Draft being written or waiting in Review'
            when 'proposal' then case when cfg.auto_generate then 'Draft is requested at the next planner run' else 'Waiting for you to generate the draft' end
            else 'Dropped' end as label
      ) st
      -- db/281: a written draft that cannot go out (judged on the day the autopilot fills that week) is not planned
      cross join lateral (
        select case when v_gate and st.status = 'waiting_review' and (s.idea_source = 'carousel_drafts' or (p_account='ivan' and s.idea_source='lm_idea_candidates')) then
          case when v_elig is null then 'its checks could not be read'
               else public.content_brain_block_reason(v_elig -> st.draft_id::text, greatest(wk - 2, v_today)) end end as reason
      ) bl
      where s.account = p_account and s.week_start = wk and s.status in ('planned','proposal','requested')
        and coalesce(st.status,'dropped') not in ('dropped','failed')
        and not exists (select 1 from public.carousel_drafts d where d.id = st.draft_id and d.scheduled_at is not null)
    ) y;

    -- Each planned slot shows the day it is meant for: the first free weekday of its week, in slot order.
    -- A day with a dated post is taken; days before today are gone. No free weekday left = no day (warned below).
    if n_planned > 0 then
      select coalesce(jsonb_agg(e.j || jsonb_build_object('day', free.gd) order by e.ord), '[]'::jsonb) into planned
        from jsonb_array_elements(planned) with ordinality as e(j, ord)
        left join lateral (
          select f.gd from (
            select g::date as gd, row_number() over (order by g) as rn from generate_series(wk::timestamp, (wk + 4)::timestamp, interval '1 day') g
             where g::date >= v_today
               and not exists (select 1 from jsonb_array_elements(posts) pp where (pp->>'day')::date = g::date)
          ) f where f.rn = e.ord
        ) free on true;
    end if;

    if jsonb_array_length(blocked) > 0 then v_blocked_all := v_blocked_all || jsonb_build_array(jsonb_build_object('week', wk, 'items', blocked)); end if;
    if i >= 1 and target_week is null and n_posts + n_planned < target then target_week := wk; open_target := target - n_posts - n_planned; end if;
    weeks := weeks || jsonb_build_array(jsonb_build_object('start', wk, 'which', case i when 0 then 'this' when 1 then 'next' else 'after' end,
      'target', target, 'posts', posts, 'planned', planned, 'filled', n_posts + n_planned, 'dated', n_posts,
      'no_day', (select count(*) from jsonb_array_elements(planned) pl where pl->>'day' is null),
      'open', greatest(target - n_posts - n_planned, 0),
      'lead_magnets', (select count(*) from jsonb_array_elements(posts) p where (p->>'lead_magnet')::boolean),
      'founder', (select count(*) from jsonb_array_elements(posts) p where (p->>'founder')::boolean),
      'cannot_go_out', blocked));
  end loop;

  -- Topics already done: published in the last 8 weeks, with their results (db/259).
  select array_agg(d.id) into v_done_ids from (select d.id from public.carousel_drafts d where (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end)
            and d.status = 'published' and d.published_at >= p_now - interval '56 days' order by d.published_at desc limit 40) d;
  select coalesce(jsonb_agg(jsonb_build_object('title', coalesce(nullif(d.title,''), left(d.post_body,80)), 'day', (d.published_at at time zone 'Europe/Warsaw')::date,
           'format', d.type, 'pillar', d.taxonomy->>'pillar',
           'draft_id', d.id, 'impressions', null, 'reactions', null, 'comments', null) order by d.published_at desc), '[]'::jsonb) into done
    from public.carousel_drafts d
   where d.id = any(coalesce(v_done_ids, '{}'::uuid[]));

  -- Written drafts waiting in Review with no date: the first supply for an open slot.
  select coalesce(jsonb_agg(jsonb_build_object('draft_id', d.id, 'title', coalesce(nullif(d.title,''), left(d.post_body,80)), 'format', d.type,
           'created_at', d.created_at, 'brain', exists(select 1 from public.cb34_p2_members m where m.draft_id = d.id and m.state = 'released'),
           'evidence', public.content_plan_post_evidence(d.id)) order by d.created_at desc), '[]'::jsonb) into supply
    from (select * from public.carousel_drafts d where (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end)
            and d.status = 'review' and d.scheduled_at is null and d.created_at >= p_now - interval '30 days'
            and not coalesce((d.taxonomy->>'deleted_by_operator') = 'true', false)
            and not exists (select 1 from public.cb39_draft_verdicts v where v.draft_id = d.id and v.verdict = 'drop')
            -- db/278: a Review draft that failed its QA gate (db/277 cb34_p2_review_block) is not offered as supply
            and public.cb34_p2_review_block(d.qa, d.taxonomy) is null
            -- db/281: autopilot seat = only drafts that pass the autopilot's checks on the day it fills the week being planned
            and (not v_gate or public.content_brain_block_reason(v_elig -> d.id::text, greatest(coalesce(target_week, w0 + 7) - 2, v_today)) is null)
          order by d.created_at desc limit 25) d;

  -- db/262: last_run ships only the run reason, never the planner's candidate list.
  select to_jsonb(r0) into last_run from (select cr.ran_at, cr.target_week, cr.open_before, cr.picked, jsonb_build_object('reason', cr.outcome->'reason') as outcome from public.content_plan_runs cr where cr.account = p_account order by cr.ran_at desc limit 1) r0;

  -- Warnings only. Each names a real gap and stays silent otherwise. Plain words (spec R4).
  if target_week is not null and last_run is not null and coalesce((last_run->>'picked')::int,0) < coalesce((last_run->>'open_before')::int,0)
     and (last_run->>'target_week')::date = target_week and coalesce(last_run->'outcome'->>'reason','') = 'no_candidates' then
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','empty_topic_area','text','Not enough ideas to fill the week of ' || to_char(target_week,'FMDD Mon')));
  end if;
  for r in select (x->>'start')::date as ws, (x->>'no_day')::int as nd from jsonb_array_elements(weeks) x where (x->>'no_day')::int > 0 loop
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','no_day','text',
      r.nd || ' planned post' || case when r.nd = 1 then '' else 's' end || ' in the week of ' || to_char(r.ws,'FMDD Mon') || ' ha' || case when r.nd = 1 then 's' else 've' end || ' no free weekday'));
  end loop;
  -- db/281: say plainly when a planned written draft cannot go out (its slot is open again) and when none can fill a slot
  for r in select (x->>'week')::date as ws, x->'items' as it from jsonb_array_elements(v_blocked_all) x loop
    n := jsonb_array_length(r.it);
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','cannot_go_out','week', r.ws, 'items', r.it, 'text',
      n || ' planned draft' || case when n = 1 then '' else 's' end || ' for the week of ' || to_char(r.ws,'FMDD Mon') || ' cannot go out, so '
      || case when n = 1 then 'its slot is' else 'their slots are' end || ' open again: '
      || (select string_agg(distinct x->>'reason', '; ') from jsonb_array_elements(r.it) x)));
  end loop;
  if v_gate and target_week is not null then
    select count(*) into v_supply_ok from jsonb_array_elements(supply);
    if v_supply_ok = 0 then
      warnings := warnings || jsonb_build_array(jsonb_build_object('code','no_draft_can_go_out','text',
        'No written draft passes every check right now, so the open slots in the week of ' || to_char(target_week,'FMDD Mon') || ' have no post that could go out'));
    end if;
  end if;
  if target_week is not null then
    select count(*) into n from public.content_plan_slots s
      join public.client_ideas ci on s.idea_source = 'client_ideas' and ci.id::text = s.idea_ref
     where s.account = p_account and s.status in ('planned','proposal','requested') and s.week_start >= w0
       and ci.status in ('approved','live')
       and exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status = 'error')
       and not exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status not in ('error','archived'));
    if n > 0 then
      warnings := warnings || jsonb_build_array(jsonb_build_object('code','draft_failed','text',
        n || ' planned draft' || case when n = 1 then '' else 's' end || ' failed the quality check. The planner is picking a new topic.'));
    end if;
  end if;
  if p_account <> 'ivan' then
    for r in
      select d.taxonomy->>'pillar' pillar, count(*) n from public.carousel_drafts d
       where d.client_id = p_account and d.status = 'published' and d.published_at >= p_now - interval '56 days' and d.taxonomy->>'pillar' is not null
         -- db/271: only topic types the idea bank uses; 'demand'/'reach' are funnel tags no idea carries, so they warned forever.
         and exists (select 1 from public.client_ideas ci2 where ci2.client_id = p_account and ci2.pillar = d.taxonomy->>'pillar')
       group by 1 having count(*) >= 2
    loop
      select count(*) into n from public.client_ideas ci where ci.client_id = p_account and ci.status = 'staged' and ci.pillar = r.pillar
        and (ci.eligible_at is null or ci.eligible_at <= p_now);
      if n = 0 then
        warnings := warnings || jsonb_build_array(jsonb_build_object('code','empty_topic_area','topic', r.pillar, 'text','Out of ideas for '
          || case r.pillar when 'demand' then 'sales posts' when 'reach' then 'posts that bring new followers' when 'case_study' then 'case studies'
               when 'teardown' then 'teardowns' when 'personal' then 'founder stories' when 'how_to' then 'how-to posts' when 'opinion' then 'opinion posts'
               when 'trust' then 'trust posts' when 'authority' then 'expert posts' else replace(r.pillar,'_',' ') || ' posts' end
          || ' (' || r.n || ' used in 8 weeks)'));
      end if;
    end loop;
    select count(*) into fresh_proof from public.client_ideas ci where ci.client_id = p_account
      and (ci.lane in ('sales_call','fireflies_call') or ci.source_ref ~ '^(fc|ffc|ffr)-') and ci.created_at >= p_now - interval '21 days';
  else
    select count(*) into fresh_proof from public.lm_idea_candidates l where l.source in ('ivan_call','calls','kyle_call','claude_sessions')
      and l.status in ('reviewing','pending') and l.created_at >= p_now - interval '21 days';
  end if;
  if fresh_proof = 0 then
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','no_fresh_proof',
      'text', case when p_account = 'ivan' then 'No new ideas from calls or your own work in 3 weeks' else 'No new ideas from a client call in 3 weeks' end));
  end if;
  if p_account = 'ivan' then
    select count(*) into photos from public.ivan_photo_candidates_v1();
    if photos < target then
      warnings := warnings || jsonb_build_array(jsonb_build_object('code','no_photos','text', 'Only ' || photos || ' fitting photo' || case when photos = 1 then '' else 's' end || ' left in your library'));
    end if;
  end if;
  if lm_target > 0 then
    for i in 1..2 loop
      if coalesce((weeks->i->>'lead_magnets')::int,0) < lm_target then
        warnings := warnings || jsonb_build_array(jsonb_build_object('code','lm_due','text','No lead magnet in the week of ' || to_char((weeks->i->>'start')::date,'FMDD Mon')));
      end if;
    end loop;
  end if;
  founder_n := coalesce((weeks->1->>'founder')::int,0);
  if founder_n > cfg.founder_story_max then
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','founder_cap','text', founder_n || ' founder stories next week. Your limit is ' || cfg.founder_story_max));
  end if;

  -- db/259: the content brain data. Fail-safe: a brain error never breaks the plan read (content_plan_apply reads it too).
  begin
    select array_agg(distinct (x->>'draft_id')::uuid) into v_ids from (
      select p as x from jsonb_array_elements(weeks) w, jsonb_array_elements(w->'posts') p
      union all select p from jsonb_array_elements(weeks) w, jsonb_array_elements(w->'planned') p
      union all select s from jsonb_array_elements(supply) s) t
     where x->>'draft_id' ~ '^[0-9a-fA-F-]{36}$';
    select coalesce(jsonb_object_agg(b.draft_id::text, b.brain), '{}'::jsonb) into v_brain
      from public.content_plan_brain_items(p_account, coalesce(v_ids, '{}'::uuid[]), p_now) b;

    v_blank := jsonb_build_object('draft_id', null, 'words', null, 'edited', false, 'thumb', null, 'body_head', null, 'first_line', null, 'has_link', false,
      'flags', jsonb_build_object('lm', false, 'boosted', false, 'founder', false, 'carousel', false, 'weekend', false, 'failed', false, 'low_score', false, 'fact_fail', false),
      'qa', null, 'facts', null, 'angle', null, 'trait', null, 'read', null, 'brief', null, 'quote', null, 'quote_pending', false,
      'photo', null, 'replaced', null, 'result', null, 'time_set_by', null);

    select coalesce(jsonb_agg(w.j || jsonb_build_object(
        'posts', (select coalesce(jsonb_agg(p.j || jsonb_build_object('brain',
                    case when v_brain ? (p.j->>'draft_id') then
                           (v_brain->(p.j->>'draft_id')) || jsonb_build_object('flags', (v_brain->(p.j->>'draft_id'))->'flags'
                             || jsonb_build_object('weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false)))
                         else v_blank || jsonb_build_object('flags', (v_blank->'flags') || jsonb_build_object(
                             'lm', coalesce((p.j->>'lead_magnet')::boolean, false), 'founder', coalesce((p.j->>'founder')::boolean, false),
                             'carousel', coalesce(p.j->>'format' in ('carousel','pdf','document'), false),
                             'weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false))) end) order by p.o), '[]'::jsonb)
                  from jsonb_array_elements(w.j->'posts') with ordinality p(j, o)),
        'planned', (select coalesce(jsonb_agg(p.j || jsonb_build_object('brain',
                    case when v_brain ? (p.j->>'draft_id') then
                           (v_brain->(p.j->>'draft_id')) || jsonb_build_object('flags', (v_brain->(p.j->>'draft_id'))->'flags'
                             || jsonb_build_object('weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false)))
                         else v_blank || jsonb_build_object('read', nd.rd, 'quote', nd.quote, 'quote_pending', coalesce(nd.src is not null and nd.quote is null, false),
                             'replaced', nd.rp,
                             'flags', (v_blank->'flags') || jsonb_build_object('weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false))) end) order by p.o), '[]'::jsonb)
                  from jsonb_array_elements(w.j->'planned') with ordinality p(j, o)
                  left join lateral (
                    -- db/261: the read stored on the slot at pick time; the live read only when the slot has none.
                    select case when p.j->>'idea_source' = 'client_ideas' then coalesce(
                             (select ps.pick_snapshot->'read' from public.content_plan_slots ps
                               where ps.id = (p.j->>'slot_id')::uuid and jsonb_typeof(ps.pick_snapshot->'read') = 'object'),
                             public.content_plan_read_shape(public.cb33_idea_read(p_account, p.j->>'idea_ref'))) end as rd,
                           qs.src,
                           case when qs.src is not null and ci.quote_en_src = qs.src then nullif(btrim(ci.quote_en), '') end as quote,
                           (select jsonb_build_object('title', coalesce(nullif(od.title, ''), left(od.post_body, 80), os.topic), 'on', (rr.requested_at at time zone 'Europe/Warsaw')::date)
                              from public.content_plan_slots ns
                              join public.content_plan_replans rr on rr.account = p_account and rr.requested_at <= ns.created_at and ns.created_at < rr.requested_at + interval '12 hours'
                              join public.content_plan_slots os on os.id = rr.slot_id and os.week_start = ns.week_start and os.id <> ns.id
                              left join public.carousel_drafts od on od.id = rr.draft_id
                             where ns.id::text = p.j->>'slot_id' order by rr.requested_at desc limit 1) as rp
                      from (select 1) one
                      left join public.client_ideas ci on p.j->>'idea_source' = 'client_ideas' and ci.id = case when p.j->>'idea_ref' ~ '^[0-9a-fA-F-]{36}$' then (p.j->>'idea_ref')::uuid end
                      left join lateral (select public.content_plan_source_quote(ci.id) as src where ci.id is not null) qs on true
                     where not (v_brain ? coalesce(p.j->>'draft_id', ''))
                  ) nd on true)
      ) order by w.o), '[]'::jsonb) into b_weeks
      from jsonb_array_elements(weeks) with ordinality w(j, o);

    select coalesce(jsonb_agg(s.j || jsonb_build_object('brain_draft', s.j->'brain', 'brain', coalesce(v_brain->(s.j->>'draft_id'), v_blank)) order by s.o), '[]'::jsonb)
      into b_supply from jsonb_array_elements(supply) with ordinality s(j, o);

    -- Rule breaks become warnings (spec R3.2), only for rules in force.
    b_warn := warnings;
    select b.rule_id, b.effect_pct into v_rule from public.brain_rules b where b.rule_id = 'R08-frequency-' || p_account and b.status = 'live';
    if found then
      v_max := coalesce((pol->>'max_posts_per_week')::int, target); v_min := (pol->>'min_posts_per_week')::int;
      for r in select (x->>'start')::date as ws, (x->>'filled')::int as f from jsonb_array_elements(b_weeks) x where (x->>'filled')::int > v_max order by 1 loop
        b_warn := b_warn || jsonb_build_array(jsonb_build_object('code','over_rule','text',
          'Week of ' || to_char(r.ws,'FMDD Mon') || ' has ' || r.f || ' posts. Your rule is '
          || case when v_min is not null then v_min || ' to ' || v_max else 'at most ' || v_max end || '.'
          || case when v_rule.effect_pct is not null then ' Each extra post costs ' || round(abs(v_rule.effect_pct)) || '% of views.' else '' end));
      end loop;
    end if;
    if exists (select 1 from public.brain_rules b where b.rule_id = 'R11-weekend-' || p_account and b.status = 'live') then
      for r in select distinct z.dd
                 from jsonb_array_elements(b_weeks) w,
                 lateral (select coalesce(((x->>'at')::timestamptz at time zone v_tz)::date, (x->>'day')::date) as dd
                            from (select x from jsonb_array_elements(w->'posts') x union all select x from jsonb_array_elements(w->'planned') x) xx(x)) z
                where z.dd is not null and z.dd >= v_today and extract(isodow from z.dd) >= 6 order by 1 loop
        b_warn := b_warn || jsonb_build_array(jsonb_build_object('code','weekend_post','text', to_char(r.dd,'Dy FMDD Mon') || ': a post on a weekend. Your rule is weekdays only.'));
      end loop;
    end if;

    select percentile_cont(0.5) within group (order by m.impressions) into v_med
      from public.client_post_metrics m where m.client_id = p_account and m.published_at >= p_now - interval '90 days' and m.impressions is not null;
    if p_account = 'ivan' then
      select coalesce(jsonb_agg(distinct ((a->>'at')::timestamptz at time zone 'Europe/Warsaw')::date), '[]'::jsonb) into v_xdays
        from jsonb_array_elements(public.x_calendar(w0::timestamp at time zone 'Europe/Warsaw', (w0 + 21)::timestamp at time zone 'Europe/Warsaw')) a
       where a->>'at' is not null;
    end if;
    select coalesce(jsonb_agg(z.p order by w.wo, z.k, z.o), '[]'::jsonb) into v_items
      from jsonb_array_elements(b_weeks) with ordinality w(j, wo),
      lateral (select x.p, 0 as k, x.o from jsonb_array_elements(w.j->'posts') with ordinality x(p, o)
               union all select x.p, 1, x.o from jsonb_array_elements(w.j->'planned') with ordinality x(p, o)) z;
    v_strip := public.content_plan_brain_strip(p_account, v_items, p_now);

    -- Results of the topics already done (fix1: inside the fail-safe).
    select coalesce(jsonb_agg(x.j || jsonb_build_object('impressions', mt.views, 'reactions', mt.reactions, 'comments', mt.comments) order by x.o), '[]'::jsonb)
      into b_done
      from jsonb_array_elements(done) with ordinality x(j, o)
      left join public.content_plan_draft_metrics(p_account, coalesce(v_done_ids, '{}'::uuid[])) mt on mt.draft_id::text = x.j->>'draft_id';

    weeks := b_weeks; supply := b_supply; warnings := b_warn; done := b_done;
  exception when others then
    v_strip := null; v_err := left(sqlerrm, 200);
  end;

  return jsonb_build_object('ok', true, 'account', p_account, 'today', v_today, 'target', target,
    'target_week', target_week, 'open', open_target,
    'state', case when target_week is null then 'two_weeks_planned' else 'planning' end,
    'proposals_only', cfg.proposals_only, 'auto_generate', cfg.auto_generate, 'founder_story_max', cfg.founder_story_max,
    'cadence_source', cfg.cadence_source, 'lm_per_week', lm_target,
    'weeks', weeks, 'done', done, 'supply', supply, 'warnings', warnings, 'last_run', last_run,
    'done_median', round(v_med),
    'tz', case when p_account = 'risedtc' then jsonb_build_object('name','America/Los_Angeles','label','PT') else jsonb_build_object('name','Europe/Warsaw','label','Warsaw') end,
    'x_days', v_xdays,
    'brain_strip', v_strip)
    || case when v_err is not null then jsonb_build_object('brain_error', v_err) else '{}'::jsonb end;
end $function$
;
-- Existing active planned ideas are registered only if they already link a hidden, undated draft.
SELECT public.content_plan_register_ivan_idea(l.id,l.promoted_draft_id)
FROM public.content_plan_slots s JOIN public.lm_idea_candidates l ON l.id::text=s.idea_ref
WHERE s.account='ivan' AND s.idea_source='lm_idea_candidates' AND s.status IN ('planned','requested','proposal')
AND s.week_start>=date_trunc('week',now() AT TIME ZONE 'Europe/Warsaw')::date AND l.promoted_draft_id IS NOT NULL;
COMMIT;
