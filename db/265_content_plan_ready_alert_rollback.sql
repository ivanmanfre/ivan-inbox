-- 265 rollback: restores content_plan_apply to its live body before db/265 (captured with pg_get_functiondef on
-- 2026-10-13; byte-identical to db/262), removes the content-plan-ready cron job, and drops the plan_ready objects.
-- Alerts already sent stay in inbox_notifications (they are feed rows, not touched).

select set_config('lock_timeout', '5s', true);

do $$ begin
  if exists (select 1 from cron.job where jobname = 'content-plan-ready') then perform cron.unschedule('content-plan-ready'); end if;
end $$;

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
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  perform pg_advisory_xact_lock(hashtextextended('content-plan:' || p_account, 0));
  -- db/261: any date this transaction moves is the planner's (read by the content_plan_moves trigger).
  perform set_config('content_plan.actor', 'planner', true);
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
    -- 257: a client idea is drafted by the client kickoff, which writes a text post (post_format 'text'). A carousel
    -- or image label on the idea never becomes a deck, so the slot says what will really be made. RISE text posts get
    -- one of Mattan's photos from the RISE photo assigner when one fits; ARCH posts go out as text.
    if v_src = 'client_ideas' then v_format := 'text'; end if;
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
  values (v_run, p_account, p_week, v_open, jsonb_array_length(inserted), p_run || jsonb_build_object('apply_skipped', skipped,
    'reason', case when jsonb_array_length(inserted) = 0 and v_open > 0 then 'no_candidates' else 'ok' end));
  return jsonb_build_object('ok', true, 'run_id', v_run, 'target_week', p_week, 'open_before', v_open, 'inserted', inserted, 'skipped', skipped);
end $function$;


drop function if exists public.content_plan_ready_sweep(timestamptz);
drop function if exists public.content_plan_ready_check(text, date, timestamptz, boolean);
drop table if exists public.content_plan_alerts;
