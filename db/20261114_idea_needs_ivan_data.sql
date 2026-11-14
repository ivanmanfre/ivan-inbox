-- 20261114 Ideas that wait for Ivan's data.
--
-- Bug (Ivan 2026-11-13, draft 848607fe "GEO?"): content-radar idea 4e140f60 carried the free-text note
-- "NEEDS IVAN'S REAL DATA: did the prospect take the scan" inside raw_context. Nothing read it. The planner
-- (n8n NcDrN7QXun5s37u0) picked the idea, content_plan_apply reserved a week slot, lm-curator-decide made the draft.
--
-- Fix: the need is a field. An idea with needs_ivan_data = true and no answer is refused by content_plan_apply
-- (reason waits_for_ivan_data), and the planner no longer offers it (its candidate rows are to_jsonb of the idea, so
-- the fields ride along). content_idea_answer_ivan stores his answer and adds it to the idea's evidence as his own
-- fact, which opens the idea again. Nothing is deleted. Ivan's own "Generate draft" tap is not blocked.
--
-- Readers checked with who-reads before this file: content_plan_apply is called by n8n NcDrN7QXun5s37u0 PlanWeeks
-- only. content_idea_waits and content_idea_answer_ivan are new names with no readers.
-- Rollback: 20261114_idea_needs_ivan_data_rollback.sql

alter table public.lm_idea_candidates
  add column if not exists needs_ivan_data boolean not null default false,
  add column if not exists needs_ivan_question text,
  add column if not exists needs_ivan_answer text,
  add column if not exists needs_ivan_answered_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lm_idea_candidates_needs_question_ck') then
    alter table public.lm_idea_candidates add constraint lm_idea_candidates_needs_question_ck
      check (not needs_ivan_data or nullif(btrim(coalesce(needs_ivan_question, '')), '') is not null);
  end if;
end $$;

comment on column public.lm_idea_candidates.needs_ivan_data is
  'true = this idea cannot become a post until Ivan supplies one fact only he has. Written by the content-radar skill.';
comment on column public.lm_idea_candidates.needs_ivan_question is
  'The one question to ask Ivan, answerable in one line. Required when needs_ivan_data is true.';
comment on column public.lm_idea_candidates.needs_ivan_answer is
  'His answer, written by content_idea_answer_ivan. While this is empty the planner does not pick the idea.';

-- One definition of "still waits", used by content_plan_apply and the Review source read.
create or replace function public.content_idea_waits(p_needs boolean, p_answer text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(p_needs, false) and nullif(btrim(coalesce(p_answer, '')), '') is null
$function$;

-- His answer. Service calls and the signed-in owner only. The answer is stored and added to the idea's evidence as
-- his own fact, so the writer and the fact check see it. An idea that is already a draft or archived is not changed.
create or replace function public.content_idea_answer_ivan(p_idea uuid, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare c public.lm_idea_candidates%rowtype; v_answer text := left(btrim(coalesce(p_answer, '')), 1200); ev jsonb;
begin
  if not (public.content_plan_service_ok() or (auth.uid() is not null and public.cb34_p2_operator_lane_allowed('ivan'))) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_idea is null or v_answer = '' then return jsonb_build_object('ok', false, 'error', 'empty_answer'); end if;
  select * into c from public.lm_idea_candidates where id = p_idea for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not c.needs_ivan_data then return jsonb_build_object('ok', false, 'error', 'no_question'); end if;
  if c.status not in ('pending', 'scored', 'reviewing') then return jsonb_build_object('ok', false, 'error', 'idea_closed'); end if;
  if nullif(btrim(coalesce(c.needs_ivan_answer, '')), '') is not null then return jsonb_build_object('ok', false, 'error', 'already_answered'); end if;
  ev := case when jsonb_typeof(c.evidence) = 'array' then c.evidence
             when jsonb_typeof(c.evidence) = 'object' then jsonb_build_array(c.evidence) else '[]'::jsonb end;
  update public.lm_idea_candidates
     set needs_ivan_answer = v_answer, needs_ivan_answered_at = now(),
         evidence = ev || jsonb_build_array(jsonb_build_object(
           'who', 'Ivan Manfredi', 'tier', 'FACT', 'quote', v_answer, 'source', 'ivan_answer',
           'instrument', 'His answer to: ' || c.needs_ivan_question))
   where id = p_idea;
  return jsonb_build_object('ok', true, 'idea_id', p_idea);
end $function$;

revoke all on function public.content_idea_waits(boolean, text) from public, anon;
grant execute on function public.content_idea_waits(boolean, text) to authenticated, service_role;
revoke all on function public.content_idea_answer_ivan(uuid, text) from public, anon;
grant execute on function public.content_idea_answer_ivan(uuid, text) to authenticated, service_role;

-- content_plan_apply: the live definition (db/281) plus one refusal, marked db/20261114 inside.
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
    -- db/20261114: an idea that still needs a fact only Ivan has is not planned until he answers its question.
    if v_src = 'lm_idea_candidates' and p_account = 'ivan' and exists (
         select 1 from public.lm_idea_candidates l where l.id::text = v_ref and public.content_idea_waits(l.needs_ivan_data, l.needs_ivan_answer)) then
      skipped := skipped || jsonb_build_array(jsonb_build_object('ref', v_ref, 'reason', 'waits_for_ivan_data')); continue;
    end if;
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
