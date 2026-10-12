-- rollback 257: restore content_plan_apply as of db/255 (live def 12 Oct), drop the replan trigger.
CREATE OR REPLACE FUNCTION public.content_plan_apply(p_account text, p_week date, p_picks jsonb, p_run jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
declare st jsonb; cfg public.content_plan_config%rowtype; v_open int; p jsonb; inserted jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
  v_src text; v_ref text; v_topic text; v_format text; v_picture text; v_ok boolean; v_id uuid; v_run uuid := gen_random_uuid(); v_why text;
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  perform pg_advisory_xact_lock(hashtextextended('content-plan:' || p_account, 0));
  select * into cfg from public.content_plan_config where account = p_account;
  st := public.content_plan_week(p_account);
  if st->>'target_week' is null then
    insert into public.content_plan_runs(id, account, target_week, open_before, picked, outcome) values (v_run, p_account, null, 0, 0, p_run || jsonb_build_object('reason','two_weeks_planned'));
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
    if exists (select 1 from public.content_plan_slots s where s.account = p_account and s.idea_source = v_src and s.idea_ref = v_ref and s.status in ('planned','proposal','requested')) then
      skipped := skipped || jsonb_build_array(jsonb_build_object('ref', v_ref, 'reason', 'already_planned')); continue; end if;
    if length(v_why) < 12 or v_why ~ '—' then v_why := null; end if;
    v_picture := case when v_format in ('carousel','pdf') then 'carousel deck' when v_format = 'video' then 'video'
                      when p_account = 'ivan' then 'photo if one fits, else none (photo assigner)' else 'decided when drafted' end;
    insert into public.content_plan_slots(account, week_start, kind, idea_source, idea_ref, topic, why_now, evidence, format, picture, status, plan_run_id)
    values (p_account, p_week, case when v_src = 'carousel_drafts' then 'review_draft' else 'idea' end, v_src, v_ref, left(v_topic, 300),
      coalesce(v_why, 'Top of the ' || case when v_src = 'carousel_drafts' then 'written drafts' else 'idea pool' end || ' for this week'),
      public.content_plan_idea_evidence(v_src, v_ref), v_format, v_picture,
      case when cfg.proposals_only then 'proposal' else 'planned' end, v_run)
    returning id into v_id;
    inserted := inserted || jsonb_build_array(jsonb_build_object('slot_id', v_id, 'source', v_src, 'ref', v_ref, 'topic', left(v_topic,120)));
  end loop;
  insert into public.content_plan_runs(id, account, target_week, open_before, picked, outcome)
  values (v_run, p_account, p_week, v_open, jsonb_array_length(inserted), p_run || jsonb_build_object('skipped', skipped,
    'reason', case when jsonb_array_length(inserted) = 0 and v_open > 0 then 'no_candidates' else 'ok' end));
  return jsonb_build_object('ok', true, 'run_id', v_run, 'target_week', p_week, 'open_before', v_open, 'inserted', inserted, 'skipped', skipped);
end $function$
;

drop trigger if exists content_plan_replan_on_fail on public.carousel_drafts;
drop function if exists public.content_plan_replan_on_fail();
-- content_plan_replans is kept (log only). Slot format/picture rows are not restored.
