-- RISE staged idea approval records the chosen draft format atomically.
CREATE OR REPLACE FUNCTION public.operator_approve_rise_idea_format(
  p_gate text, p_idea_id uuid, p_decision text, p_format text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_idea public.client_ideas%rowtype;
  v_result jsonb;
BEGIN
  IF NOT public.operator_gate_ok(p_gate) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_gate');
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_decision');
  END IF;
  IF p_format IS NULL OR p_format NOT IN ('text', 'carousel') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_format');
  END IF;

  SELECT * INTO v_idea FROM public.client_ideas
    WHERE id = p_idea_id AND client_id = 'risedtc' AND status = 'staged'
    FOR UPDATE;
  IF v_idea.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_not_staged');
  END IF;

  -- The existing RPC remains the authority for staged and reuse eligibility.
  v_result := public.operator_approve_idea(p_gate, p_idea_id, p_decision);
  IF v_result->>'ok' IS DISTINCT FROM 'true' THEN
    RETURN v_result;
  END IF;
  IF p_decision = 'approved' THEN
    UPDATE public.client_ideas
      SET format = p_format, planned_format = p_format
      WHERE id = p_idea_id;
  END IF;
  RETURN v_result;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.operator_approve_rise_idea_format(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_approve_rise_idea_format(text, uuid, text, text) TO authenticated, service_role;

-- Expose the planned value so the format picker defaults to the current choice.
CREATE OR REPLACE FUNCTION public.operator_client_ideas(p_gate text, p_client_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare out jsonb;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  select jsonb_agg(jsonb_build_object(
    'id', i.id, 'hook', i.hook, 'title', i.title, 'source_label', i.source_label,
    'source_ref', i.source_ref, 'pillar', i.pillar, 'format', i.format, 'planned_format', i.planned_format,
    'status', i.status, 'created_at', i.created_at,
    'icp_score', i.icp_score, 'score_breakdown', i.score_breakdown,
    'funnel_stage', i.funnel_stage, 'funnel_source', i.funnel_source,
    'agent_log', coalesce(i.agent_log, '[]'::jsonb),
    'reuse_of', i.reuse_of, 'eligible_at', i.eligible_at
  ) order by i.icp_score desc nulls last, i.created_at desc) into out
  from client_ideas i
  where i.client_id = p_client_id and i.status = 'staged'
    and (i.eligible_at is null or i.eligible_at <= now());
  return jsonb_build_object('ok', true, 'ideas', coalesce(out, '[]'::jsonb));
end; $function$;

-- Keep RISE carousel proposals as carousel; other client coercion is unchanged.
CREATE OR REPLACE FUNCTION public.content_plan_apply(p_account text, p_week date, p_picks jsonb, p_run jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
declare st jsonb; cfg public.content_plan_config%rowtype; v_open int; p jsonb; inserted jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
  v_src text; v_ref text; v_topic text; v_format text; v_picture text; v_ok boolean; v_id uuid; v_run uuid := gen_random_uuid(); v_why text;
  v_snap jsonb; -- db/261
  v_gate boolean; v_fail text; v_dropped jsonb := '[]'::jsonb; x jsonb; -- db/281
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  perform pg_advisory_xact_lock(hashtextextended('content-plan:' || p_account, 0));
  -- db/261: any date this transaction moves is the planner's (read by the content_plan_moves trigger).
  perform set_config('content_plan.actor', 'planner', true);
  select * into cfg from public.content_plan_config where account = p_account;
  st := public.content_plan_week(p_account);
  -- db/281: a planned written draft that cannot go out (content_plan_week lists it under cannot_go_out) gives its slot back.
  v_gate := exists (select 1 from public.content_autopilot_config ac where ac.account = p_account and ac.mode <> 'off');
  for x in select it from jsonb_array_elements(coalesce(st->'weeks','[]'::jsonb)) wk, jsonb_array_elements(coalesce(wk->'cannot_go_out','[]'::jsonb)) it loop
    update public.content_plan_slots set status = 'dropped', status_note = left('cannot go out: ' || coalesce(x->>'reason','?'), 300), updated_at = now()
     where id = (x->>'slot_id')::uuid and account = p_account and status in ('planned','proposal','requested');
    if found then v_dropped := v_dropped || jsonb_build_array(jsonb_build_object('slot_id', x->'slot_id', 'draft_id', x->'draft_id', 'reason', x->'reason')); end if;
  end loop;
  if jsonb_array_length(v_dropped) > 0 then st := public.content_plan_week(p_account); end if;
  if st->>'target_week' is null then
    insert into public.content_plan_runs(id, account, target_week, open_before, picked, outcome) values (v_run, p_account, null, 0, 0, p_run || jsonb_build_object('reason','two_weeks_planned', 'dropped_cannot_go_out', v_dropped));
    return jsonb_build_object('ok', true, 'run_id', v_run, 'inserted', inserted, 'reason', 'two_weeks_planned');
  end if;
  if (st->>'target_week')::date <> p_week then raise exception 'stale week: target is %', st->>'target_week'; end if;
  v_open := (st->>'open')::int;
  for p in select * from jsonb_array_elements(coalesce(p_picks,'[]'::jsonb)) loop
    exit when jsonb_array_length(inserted) >= v_open;
    v_src := p->>'source'; v_ref := p->>'ref'; v_why := btrim(coalesce(p->>'why_now',''));
    v_ok := false; v_topic := null; v_format := null; v_picture := null;
    if v_src = 'lm_idea_candidates' and p_account = 'ivan' then
      select coalesce(nullif(l.post_angle,''), l.raw_topic), coalesce(l.planned_format, l.format_recommendation), true into v_topic, v_format, v_ok
        from public.lm_idea_candidates l where l.id::text = v_ref and l.status in ('reviewing','pending')
         and l.content_type = 'post' and coalesce(nullif(btrim(lower(l.workspace_type)),''),'own') = 'own' and l.campaign_id is null
         and coalesce(l.source,'') not in ('x_viral','x_search','newsjack','breaking_news');
    elsif v_src = 'client_ideas' and p_account <> 'ivan' then
      select coalesce(nullif(ci.title,''), ci.hook), coalesce(ci.planned_format, ci.format), true into v_topic, v_format, v_ok
        from public.client_ideas ci where ci.id::text = v_ref and ci.client_id = p_account and ci.status = 'staged'
         and (ci.eligible_at is null or ci.eligible_at <= now()) and coalesce(ci.lane,'') not in ('x_viral','industry_radar');
    elsif v_src = 'carousel_drafts' then
      select coalesce(nullif(d.title,''), left(d.post_body,80)), d.type, true into v_topic, v_format, v_ok
        from public.carousel_drafts d where d.id::text = v_ref and d.status = 'review' and d.scheduled_at is null
         and (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end);
    end if;
    if not coalesce(v_ok,false) or v_topic is null then skipped := skipped || jsonb_build_array(jsonb_build_object('ref', v_ref, 'reason', 'not_open')); continue; end if;
    -- db/281: on an autopilot seat a written draft must pass the autopilot's own checks for the day it fills this week
    if v_src = 'carousel_drafts' and v_gate then
      begin
        v_fail := public.content_brain_block_reason(
          (select e from jsonb_array_elements(public.content_brain_eligibility(p_account, now(), array[v_ref::uuid])) e limit 1),
          greatest(p_week - 2, (now() at time zone 'Europe/Warsaw')::date));
      exception when others then v_fail := 'its checks could not be read';
      end;
      if v_fail is not null then skipped := skipped || jsonb_build_array(jsonb_build_object('ref', v_ref, 'reason', 'cannot_go_out', 'why', v_fail)); continue; end if;
    end if;
    if exists (select 1 from public.content_plan_slots s where s.account = p_account and s.idea_source = v_src and s.idea_ref = v_ref and s.status in ('planned','proposal','requested')) then
      skipped := skipped || jsonb_build_array(jsonb_build_object('ref', v_ref, 'reason', 'already_planned')); continue; end if;
    if length(v_why) < 12 or v_why ~ '—' then v_why := null; end if;
    -- 257: a client idea is drafted by the client kickoff, which writes a text post (post_format 'text'). A carousel
    -- or image label on the idea never becomes a deck, so the slot says what will really be made. RISE text posts get
    -- one of Mattan's photos from the RISE photo assigner when one fits; ARCH posts go out as text.
    if v_src = 'client_ideas' and p_account <> 'risedtc' then v_format := 'text'; end if;
    v_picture := case when v_format in ('carousel','pdf') then 'carousel deck' when v_format = 'video' then 'video'
                      when p_account = 'ivan' then 'photo if one fits, else none (photo assigner)'
                      when p_account = 'risedtc' then 'Mattan''s photo if one fits'
                      when p_account = 'arch' then 'no picture' else 'decided when drafted' end;
    insert into public.content_plan_slots(account, week_start, kind, idea_source, idea_ref, topic, why_now, evidence, format, picture, status, plan_run_id)
    values (p_account, p_week, case when v_src = 'carousel_drafts' then 'review_draft' else 'idea' end, v_src, v_ref, left(v_topic, 300),
      coalesce(v_why, case when v_src = 'carousel_drafts' then 'Top of the written drafts for this week' else 'A strong idea that fits this week.' end),
      case when p_account = 'ivan' then public.content_plan_idea_evidence(v_src, v_ref)
           else public.content_plan_strip_format_traits(public.content_plan_idea_evidence(v_src, v_ref)) end, v_format, v_picture,
      case when cfg.proposals_only then 'proposal' else 'planned' end, v_run)
    returning id into v_id;
    -- db/261: the ranker snapshot at pick time (rank, proof, read). read has the brain.read shape
    -- (content_plan_read_shape). The pick's own snapshot wins; else the idea's read now. Never fails the apply.
    begin
      v_snap := jsonb_build_object(
        'rank', case when jsonb_typeof(p->'snapshot'->'rank') = 'number' then p->'snapshot'->'rank' end,
        'proof', case when jsonb_typeof(p->'snapshot'->'proof') = 'string' then left(p->'snapshot'->>'proof', 300) end,
        'read', coalesce(case when jsonb_typeof(p->'snapshot'->'read') = 'object' then public.content_plan_read_shape(p->'snapshot'->'read') end,
                         case when v_src in ('client_ideas','lm_idea_candidates') then public.content_plan_read_shape(public.cb33_idea_read(p_account, v_ref)) end),
        'source', case when jsonb_typeof(p->'snapshot') = 'object' then 'planner' else 'apply' end,
        'at', now());
      update public.content_plan_slots set pick_snapshot = v_snap where id = v_id;
    exception when others then null;
    end;
    inserted := inserted || jsonb_build_array(jsonb_build_object('slot_id', v_id, 'source', v_src, 'ref', v_ref, 'topic', left(v_topic,120)));
  end loop;
  -- db/262: p_run's candidates and skipped (the planner's reasons) are kept as given; apply's own refusals go to apply_skipped.
  insert into public.content_plan_runs(id, account, target_week, open_before, picked, outcome)
  values (v_run, p_account, p_week, v_open, jsonb_array_length(inserted), p_run || jsonb_build_object('apply_skipped', skipped, 'dropped_cannot_go_out', v_dropped,
    'reason', case when jsonb_array_length(inserted) = 0 and v_open > 0 then 'no_candidates' else 'ok' end));
  -- db/265: tell the plan_ready check this week was just written. An alert failure never fails the plan write.
  begin
    perform public.content_plan_ready_check(p_account, p_week);
  exception when others then null;
  end;
  return jsonb_build_object('ok', true, 'run_id', v_run, 'target_week', p_week, 'open_before', v_open, 'inserted', inserted, 'skipped', skipped, 'dropped', v_dropped);
end $function$;
