-- 20261106_post_quality_09_sol_r1.sql: fixes from cross-review round 1 (gpt-6.1-sol) on 20261106_post_quality_09.sql.
-- #1 new text on a dated post is checked; #2 the planner returns rerun_under_bar instead of tripping the gate;
-- #3/#4 relink locks + re-reads both rows and needs the full text to match; #5 the stamp merges into current flags;
-- #9 rejected flag lines are counted; #10 a real earlier publish of the same draft still counts; #11 the draft must be
-- covered too; #12 no bare auth.uid() override. Rollback: 20261106_post_quality_09_sol_r1_rollback.sql
begin;
create or replace function public.ivan_rerun_check(p_body text, p_draft uuid default null, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  with d as (select public.ivan_post_shingles(p_body) s),
  boosted as (select b.post_ref from public.own_post_boost_current_v b where b.client_id = 'ivan' and b.boosted is true),
  own as (
    select o.id, o.social_id, o.linkedin_url, o.posted_at, o.num_impressions, o.post_text,
           exists (select 1 from boosted b where b.post_ref in (public.outlier_canonical_post_ref(o.social_id), public.outlier_canonical_post_ref(o.linkedin_url))) is_boosted
      from public.own_posts o
     where o.posted_at <= p_now and coalesce(o.post_text, '') <> ''
       -- its own earlier publish attempt that never reached anyone (a real earlier publish of this draft still counts)
       and (p_draft is null or coalesce(o.clickup_task_id, '') <> p_draft::text or coalesce(o.num_impressions, 0) > 0)
       and not (coalesce(o.num_impressions, 0) = 0 and o.metrics_updated_at is null)   -- a dead twin the tracker never saw
  ),
  med as (
    select percentile_cont(0.5) within group (order by o.num_impressions)::numeric md, count(*) n
      from own o
     where o.posted_at > p_now - interval '90 days' and o.posted_at <= p_now - interval '3 days'
       and o.num_impressions > 0 and not o.is_boosted),
  hit as (
    select o.*, x.shared, x.ratio
      from own o, d,
      lateral (select s2, cardinality(array(select unnest(d.s) intersect select unnest(s2))) shared
                 from (select public.ivan_post_shingles(o.post_text) s2) z) y,
      lateral (select y.shared, y.shared::numeric / greatest(least(cardinality(d.s), cardinality(y.s2)), 1) ratio) x
     -- most of the shorter text AND a good part of the draft: a short old post quoted inside a long new draft is no re-run
     where cardinality(d.s) >= 5 and x.shared >= 8 and x.ratio >= 0.5 and x.shared::numeric / cardinality(d.s) >= 0.4
     order by x.ratio desc, o.posted_at desc
     limit 1)
  select case when h.id is null then null else jsonb_build_object(
      'of_post_id', h.id, 'social_id', h.social_id,
      'url', case when h.linkedin_url ~* '^https://' then h.linkedin_url end,
      'posted_at', h.posted_at, 'impressions', coalesce(h.num_impressions, 0), 'boosted', h.is_boosted,
      'median_90d', round(m.md), 'bar', ceil(1.5 * m.md), 'median_n', m.n,
      'overlap', round(h.ratio, 2), 'shared', h.shared,
      'pass', (not h.is_boosted and m.n >= 5 and coalesce(h.num_impressions, 0) >= 1.5 * m.md),
      'rule', 'a re-run needs the original at 1.5x his organic 90-day median or more (boosted posts never count)',
      'checked_at', p_now) end
    from med m left join hit h on true
$$;

create or replace function public.ivan_rerun_blocked(p_body text, p_draft uuid, p_qa jsonb)
returns boolean language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare r jsonb;
begin
  if coalesce(p_qa #>> '{line_flags,rerun_kept,sha}', '') = public.ivan_body_sha(p_body) then return false; end if;
  r := public.ivan_rerun_check(p_body, p_draft);
  return r is not null and (r ->> 'pass')::boolean is not true;
end $$;
revoke all on function public.ivan_rerun_blocked(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ivan_rerun_blocked(text, uuid, jsonb) to service_role;

create or replace function public.ivan_rerun_gate()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_sha text; v_ivan boolean; v_dating boolean; v_approving boolean; r jsonb; v_qa jsonb; v_lf jsonb; v_was timestamptz;
begin
  if new.client_id is not null or new.published_at is not null then return new; end if;
  v_dating := (new.scheduled_at is not null and (tg_op = 'INSERT' or old.scheduled_at is distinct from new.scheduled_at))
           or (new.status = 'scheduled' and (tg_op = 'INSERT' or old.status is distinct from 'scheduled'))
           -- new text on a post that already has a date is checked like a new date (sol r1 #1)
           or (tg_op = 'UPDATE' and old.post_body is distinct from new.post_body and (new.scheduled_at is not null or new.status = 'scheduled'));
  v_approving := new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved');
  if not (v_dating or v_approving) then return new; end if;
  begin
    v_ivan := coalesce(current_setting('app.schedule_manual', true), '') = 'on'
           or public.cb39_implicit_actor() is not null;
  exception when others then v_ivan := false; end;
  v_qa := case when jsonb_typeof(new.qa) = 'object' then new.qa else '{}'::jsonb end;
  v_lf := case when jsonb_typeof(v_qa -> 'line_flags') = 'object' then v_qa -> 'line_flags' else '{}'::jsonb end;
  v_sha := public.ivan_body_sha(new.post_body);
  if coalesce(v_lf #>> '{rerun_kept,sha}', '') = v_sha then return new; end if;
  if not v_ivan and not v_dating then return new; end if;   -- a machine approving dates nothing; the dating write is checked
  r := public.ivan_rerun_check(new.post_body, new.id);
  if r is null or (r ->> 'pass')::boolean is true then return new; end if;
  if v_ivan then
    -- Ivan approves or dates a re-run that misses the bar: his call. Kept for this exact text.
    new.qa := v_qa || jsonb_build_object('line_flags', v_lf || jsonb_build_object('rerun', r, 'rerun_sha', v_sha,
      'rerun_kept', jsonb_build_object('sha', v_sha, 'at', now(), 'by', 'ivan')));
    return new;
  end if;
  -- A machine dated a re-run that misses the bar: back to Review with no date, in this same write.
  v_was := new.scheduled_at;
  if tg_op = 'UPDATE' then v_was := coalesce(new.scheduled_at, old.scheduled_at); end if;
  if new.status in ('scheduled', 'approved') then new.status := 'review'; end if;
  new.scheduled_at := null;
  new.qa := v_qa || jsonb_build_object('line_flags', v_lf || jsonb_build_object('rerun', r || jsonb_build_object('held_at', now(), 'held_from', v_was), 'rerun_sha', v_sha));
  update public.scheduled_posts set status = 'cancelled',
         error_message = left('rerun_gate: repeats the ' || to_char((r ->> 'posted_at')::timestamptz at time zone 'Europe/Warsaw', 'FMDD Mon')
           || ' post (' || (r ->> 'impressions') || ' impressions, bar ' || (r ->> 'bar') || '). Back in Review for Ivan.', 300)
   where clickup_task_id = new.id::text and status = 'pending';
  return new;
end $$;

drop trigger if exists zzz_ivan_rerun_gate on public.carousel_drafts;
create trigger zzz_ivan_rerun_gate before insert or update of scheduled_at, status, post_body on public.carousel_drafts
  for each row execute function public.ivan_rerun_gate();

create or replace function public.ivan_rerun_stamp(p_limit int default 200)
returns int language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare t record; n int := 0; r jsonb;
begin
  for t in select * from public.ivan_line_flag_targets_v v where coalesce(v.lf ->> 'rerun_sha', '') <> v.body_sha
            order by v.scheduled_at nulls last, v.created_at desc limit p_limit loop
    r := public.ivan_rerun_check(t.post_body, t.id);
    update public.carousel_drafts d
       set qa = (case when jsonb_typeof(d.qa) = 'object' then d.qa else '{}'::jsonb end)
                || jsonb_build_object('line_flags', (case when jsonb_typeof(d.qa) = 'object' and jsonb_typeof(d.qa -> 'line_flags') = 'object' then d.qa -> 'line_flags' else '{}'::jsonb end)
                   || jsonb_build_object('rerun', r, 'rerun_sha', t.body_sha))
     where d.id = t.id and public.ivan_body_sha(d.post_body) = t.body_sha;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.ivan_line_flags_save(p_draft uuid, p_body_sha text, p_lines jsonb, p_by text, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare d record; v_lf jsonb; v_lines jsonb := '[]'::jsonb; x jsonb; v_text text; v_kind text; v_ask text; v_n int; v_rej int := 0;
begin
  select c.id, c.post_body, c.qa into d from public.carousel_drafts c where c.id = p_draft and c.client_id is null for update;
  if not found then return jsonb_build_object('saved', false, 'reason', 'not_found'); end if;
  if public.ivan_body_sha(d.post_body) <> coalesce(p_body_sha, '') then return jsonb_build_object('saved', false, 'reason', 'body_changed'); end if;
  v_lf := case when jsonb_typeof(d.qa) = 'object' and jsonb_typeof(d.qa -> 'line_flags') = 'object' then d.qa -> 'line_flags' else '{}'::jsonb end;
  if p_error is not null then
    v_n := case when coalesce(v_lf #>> '{fail,sha}', '') = p_body_sha then coalesce((v_lf #>> '{fail,n}')::int, 0) else 0 end + 1;
    v_lf := v_lf || jsonb_build_object('fail', jsonb_build_object('sha', p_body_sha, 'n', v_n, 'at', now(), 'why', left(p_error, 200)));
  else
    for x in select e from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) e loop
      v_text := btrim(coalesce(x ->> 'text', ''));
      v_kind := lower(coalesce(x ->> 'kind', ''));
      v_ask := left(btrim(regexp_replace(coalesce(x ->> 'ask', ''), '\s+', ' ', 'g')), 90);
      if v_text <> '' and (length(v_text) > 600 or position(v_text in d.post_body) = 0 or v_kind not in ('personal', 'dated')) then v_rej := v_rej + 1; end if;
      continue when v_text = '' or length(v_text) > 600 or position(v_text in d.post_body) = 0 or v_kind not in ('personal', 'dated');
      continue when exists (select 1 from jsonb_array_elements(v_lines) y where y ->> 'text' = v_text and y ->> 'kind' = v_kind);
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('text', v_text, 'kind', v_kind, 'ask', nullif(v_ask, '')));
      exit when jsonb_array_length(v_lines) >= 8;
    end loop;
    v_lf := (v_lf - 'fail') || jsonb_build_object('lines', v_lines, 'lines_sha', p_body_sha, 'lines_by', left(coalesce(p_by, '?'), 80), 'lines_at', now(), 'lines_rejected', v_rej);
    if coalesce(v_lf #>> '{kept,sha}', '') <> p_body_sha then v_lf := v_lf - 'kept'; end if;
  end if;
  update public.carousel_drafts c
     set qa = (case when jsonb_typeof(c.qa) = 'object' then c.qa else '{}'::jsonb end) || jsonb_build_object('line_flags', v_lf)
   where c.id = p_draft;
  return jsonb_build_object('saved', true, 'lines', jsonb_array_length(v_lines), 'rejected', v_rej, 'error', p_error is not null);
end $$;

create or replace function public.ivan_own_post_relink(p_apply boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare p record; v_task text; v_live_task text; v_moved boolean; v_spid text; out jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ivan-own-post-relink', 0));
  for p in
    with o as (
      select x.*, lower(left(regexp_replace(btrim(coalesce(x.post_text, '')), '\s+', ' ', 'g'), 30)) k30
        from public.own_posts x where x.posted_at > now() - interval '120 days'),
    dead as (
      select * from o where coalesce(num_impressions, 0) = 0 and metrics_updated_at is null
         and posted_at < now() - interval '48 hours' and length(k30) >= 20)
    select d.id dead_id, d.social_id dead_urn, d.clickup_task_id dead_task, to_jsonb(dx) dead_row,
           (array_agg(l.id order by l.num_impressions desc))[1] live_id,
           (array_agg(l.social_id order by l.num_impressions desc))[1] live_urn,
           count(l.id) n_live
      from dead d
      join public.own_posts dx on dx.id = d.id
      join o l on l.id <> d.id and l.k30 = d.k30 and (l.posted_at at time zone 'UTC')::date = (d.posted_at at time zone 'UTC')::date
              and coalesce(l.num_impressions, 0) > 0 and l.metrics_updated_at is not null
              -- a twin is the same post: the full text matches (all 9 real pairs on 2026-11-06 were >= 0.97), not only its opening
              and similarity(coalesce(l.post_text, ''), coalesce(d.post_text, '')) >= 0.9
     group by d.id, d.social_id, d.clickup_task_id, dx.id
  loop
    if p.n_live <> 1 then skipped := skipped || jsonb_build_array(jsonb_build_object('dead', p.dead_urn, 'why', 'live twins: ' || p.n_live)); continue; end if;
    -- lock both rows (fixed order), then re-read what the decision rests on (sol r1 #3)
    perform 1 from public.own_posts where id in (p.dead_id, p.live_id) order by id for update;
    if not exists (select 1 from public.own_posts where id = p.dead_id and coalesce(num_impressions, 0) = 0 and metrics_updated_at is null)
       or not exists (select 1 from public.own_posts where id = p.live_id and coalesce(num_impressions, 0) > 0 and metrics_updated_at is not null) then
      skipped := skipped || jsonb_build_array(jsonb_build_object('dead', p.dead_urn, 'why', 'changed since the read')); continue;
    end if;
    select nullif(btrim(coalesce(clickup_task_id, '')), '') into v_task from public.own_posts where id = p.dead_id;
    select nullif(btrim(coalesce(clickup_task_id, '')), '') into v_live_task from public.own_posts where id = p.live_id;
    if v_task is not null and v_live_task is not null and v_live_task <> v_task then
      skipped := skipped || jsonb_build_array(jsonb_build_object('dead', p.dead_urn, 'why', 'live twin links another draft'));
      continue;
    end if;
    v_moved := v_task is not null and v_live_task is null;
    select source_post_id into v_spid from public.carousel_drafts where v_task is not null and id::text = v_task;
    if p_apply then
      if v_moved then update public.own_posts set clickup_task_id = v_task where id = p.live_id and nullif(btrim(coalesce(clickup_task_id, '')), '') is null; end if;
      if v_task is not null then
        update public.carousel_drafts set source_post_id = p.live_urn where id::text = v_task and source_post_id is not distinct from p.dead_urn;
      end if;
      update public.video_ideas set source_post_id = p.live_id where source_post_id = p.dead_id;
      insert into public.own_post_relinks (dead_id, dead_social_id, live_id, live_social_id, draft_id, moved_task_id, draft_source_post_before, dead_row)
      values (p.dead_id, p.dead_urn, p.live_id, p.live_urn, v_task, v_moved, v_spid, p.dead_row);
      delete from public.own_posts where id = p.dead_id and coalesce(num_impressions, 0) = 0 and metrics_updated_at is null;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('dead', p.dead_urn, 'live', p.live_urn, 'draft', v_task, 'moved_task', v_moved, 'draft_pointed_at_dead', v_spid is not distinct from p.dead_urn and v_task is not null));
  end loop;
  return jsonb_build_object('applied', p_apply, 'relinked', out, 'skipped', skipped);
end $$;

CREATE OR REPLACE FUNCTION public.content_plan_place_ivan(p_draft uuid, p_at timestamp with time zone, p_expected_body_sha256 text, p_source text DEFAULT 'approved_scheduler'::text, p_explicit_extra boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.carousel_drafts%ROWTYPE; sid uuid; wk date; n int; reserved_n int; v_at timestamptz; e jsonb;
 old_manual text := current_setting('app.schedule_manual',true);
 old_actor text := current_setting('content_plan.actor',true);
 old_kind text := current_setting('content_plan.placement_kind',true);
BEGIN
 IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
 p_explicit_extra:=coalesce(p_explicit_extra,false);
 IF p_source NOT IN ('approved_scheduler','autopilot','explicit','timely_swap') OR p_source IS NULL THEN RETURN jsonb_build_object('ok',false,'error','invalid_source'); END IF;
 IF p_explicit_extra AND p_source <> 'explicit' THEN RETURN jsonb_build_object('ok',false,'error','extra_requires_explicit'); END IF;
 IF p_at IS NULL OR p_at <= now() THEN RETURN jsonb_build_object('ok',false,'error','past_date'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('content-plan:ivan',0));
 PERFORM public.content_plan_reconcile_ivan();
 SELECT * INTO d FROM public.carousel_drafts WHERE id=p_draft FOR UPDATE;
 IF NOT FOUND OR d.client_id IS NOT NULL OR d.published_at IS NOT NULL
    OR coalesce(d.taxonomy->>'deleted_by_operator','')='true'
    OR d.status NOT IN ('review','approved','scheduled') THEN RETURN jsonb_build_object('ok',false,'error','not_schedulable'); END IF;
 IF p_expected_body_sha256 IS NULL OR p_expected_body_sha256<>encode(sha256(convert_to(coalesce(d.post_body,''),'UTF8')),'hex') THEN RETURN jsonb_build_object('ok',false,'error','text_changed'); END IF;
 IF d.status='scheduled' AND d.scheduled_at IS NOT DISTINCT FROM p_at THEN
   SELECT id INTO sid FROM public.content_plan_slots WHERE account='ivan' AND placed_draft_id=d.id AND placed_at=p_at ORDER BY created_at LIMIT 1;
   IF sid IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'scheduled_at',p_at,'slot_id',sid,'idempotent',true); END IF;
 END IF;
 IF d.scheduled_at IS NOT NULL AND d.scheduled_at IS DISTINCT FROM p_at THEN RETURN jsonb_build_object('ok',false,'error','already_dated'); END IF;
 IF p_source IN ('approved_scheduler','explicit','timely_swap') AND d.status<>'approved' THEN RETURN jsonb_build_object('ok',false,'error','approval_required'); END IF;
 IF nullif(btrim(d.post_body),'') IS NULL OR public.cb34_p2_review_block(d.qa,d.taxonomy) IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','quality_hold'); END IF;
 -- build 09 (sol r1 #2): a re-run under the bar is never placed by a machine; say so instead of tripping zzz_ivan_rerun_gate
 IF p_source <> 'explicit' AND public.ivan_rerun_blocked(d.post_body, d.id, d.qa) THEN RETURN jsonb_build_object('ok',false,'error','rerun_under_bar'); END IF;
 IF d.type='video' AND nullif(d.video_url,'') IS NULL OR d.type IN ('carousel','pdf','document') AND nullif(d.pdf_url,'') IS NULL THEN RETURN jsonb_build_object('ok',false,'error','media_not_ready'); END IF;
 IF p_source='autopilot' THEN
   IF p_at < now()+make_interval(hours=>greatest(48,coalesce((SELECT veto_hours FROM public.content_autopilot_config WHERE account='ivan'),48))) THEN RETURN jsonb_build_object('ok',false,'error','veto_window'); END IF;
   IF NOT coalesce((public.content_autonomy_gate_ivan(p_draft)->>'eligible')::boolean,false) THEN RETURN jsonb_build_object('ok',false,'error','autonomy_hold'); END IF;
   IF NOT EXISTS(SELECT 1 FROM public.content_autopilot_config WHERE account='ivan' AND mode='live') THEN RETURN jsonb_build_object('ok',false,'error','autopilot_not_live'); END IF;
   e := (SELECT x FROM jsonb_array_elements(public.content_brain_eligibility('ivan',now(),array[p_draft])) x LIMIT 1);
   IF e IS NULL OR coalesce(jsonb_array_length(e->'fails'),1)>0 THEN RETURN jsonb_build_object('ok',false,'error','quality_hold'); END IF;
 END IF;
 IF p_source<>'explicit' AND extract(isodow FROM p_at AT TIME ZONE 'Europe/Warsaw')>=6 THEN RETURN jsonb_build_object('ok',false,'error','automatic_weekday_only'); END IF;
 -- Include unlinked queue rows; a draft/queue pair is one publication, not two.
 IF EXISTS(SELECT 1 FROM public.carousel_drafts x WHERE x.client_id IS NULL AND x.id<>d.id
   AND x.status IN ('review','approved','scheduled','published') AND coalesce(x.published_at,x.scheduled_at) IS NOT NULL
   AND coalesce(x.taxonomy->>'deleted_by_operator','')<>'true'
   AND (abs(extract(epoch FROM coalesce(x.published_at,x.scheduled_at)-p_at))<86400
       OR (coalesce(x.published_at,x.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date=(p_at AT TIME ZONE 'Europe/Warsaw')::date))
 OR EXISTS(SELECT 1 FROM public.scheduled_posts q WHERE q.platform='linkedin' AND q.status IN ('pending','posting','posted')
   AND coalesce(q.is_repost,false)=false AND q.clickup_task_id IS DISTINCT FROM d.id::text
   AND NOT EXISTS(SELECT 1 FROM public.carousel_drafts x WHERE x.id::text=q.clickup_task_id)
   AND (abs(extract(epoch FROM coalesce(q.posted_at,q.scheduled_at)-p_at))<86400
       OR (coalesce(q.posted_at,q.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date=(p_at AT TIME ZONE 'Europe/Warsaw')::date))
 THEN RETURN jsonb_build_object('ok',false,'error','spacing_conflict'); END IF;
 wk:=date_trunc('week',p_at AT TIME ZONE 'Europe/Warsaw')::date;
 SELECT count(*) INTO n FROM (
  SELECT x.id::text FROM public.carousel_drafts x WHERE x.client_id IS NULL AND x.id<>d.id
   AND x.status IN ('review','approved','scheduled','published') AND coalesce(x.taxonomy->>'deleted_by_operator','')<>'true'
   AND (coalesce(x.published_at,x.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date>=wk
   AND (coalesce(x.published_at,x.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date<wk+7
  UNION ALL SELECT q.id::text FROM public.scheduled_posts q WHERE q.platform='linkedin' AND q.status IN ('pending','posting','posted')
   AND coalesce(q.is_repost,false)=false AND NOT EXISTS(SELECT 1 FROM public.carousel_drafts x WHERE x.id::text=q.clickup_task_id)
   AND (coalesce(q.posted_at,q.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date>=wk
   AND (coalesce(q.posted_at,q.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date<wk+7
 ) dated;
 IF n>=5 AND NOT p_explicit_extra THEN RETURN jsonb_build_object('ok',false,'error','baseline_full'); END IF;
 -- A reserved draft belongs to its plan week; automatic placement cannot silently steal it.
 SELECT s.id INTO sid FROM public.content_plan_slots s WHERE s.account='ivan' AND s.status IN ('planned','requested','proposal')
  AND (s.placed_draft_id=d.id OR s.idea_source='carousel_drafts' AND s.idea_ref=d.id::text
   OR s.idea_source='lm_idea_candidates' AND EXISTS(SELECT 1 FROM public.lm_idea_candidates l WHERE l.id::text=s.idea_ref AND l.promoted_draft_id=d.id))
  ORDER BY (s.week_start=wk) DESC,s.created_at LIMIT 1 FOR UPDATE;
 IF sid IS NOT NULL AND EXISTS(SELECT 1 FROM public.content_plan_slots WHERE id=sid AND week_start<>wk) THEN RETURN jsonb_build_object('ok',false,'error','reserved_other_week'); END IF;
 IF sid IS NULL AND NOT p_explicit_extra THEN
  SELECT count(*) INTO reserved_n FROM public.content_plan_slots s WHERE s.account='ivan' AND s.week_start=wk
   AND s.status IN ('planned','requested','proposal')
   -- Keep pending generation and reviewable reservations. A failed automatic written reservation cannot consume a new placement's capacity.
   AND NOT (s.kind='review_draft' AND s.idea_source='carousel_drafts' AND s.plan_run_id IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.carousel_drafts held WHERE held.id::text=s.idea_ref AND held.client_id IS NULL
       AND held.scheduled_at IS NULL AND held.published_at IS NULL
       AND NOT coalesce((public.content_autonomy_base_ivan(held.id)->>'eligible')::boolean,false)))
   AND NOT EXISTS(SELECT 1 FROM public.carousel_drafts x WHERE x.scheduled_at IS NOT NULL AND (x.id=s.placed_draft_id OR s.idea_source='carousel_drafts' AND x.id::text=s.idea_ref
    OR s.idea_source='lm_idea_candidates' AND EXISTS(SELECT 1 FROM public.lm_idea_candidates l WHERE l.id::text=s.idea_ref AND l.promoted_draft_id=x.id)));
  IF n+reserved_n>=5 THEN RETURN jsonb_build_object('ok',false,'error','reserved_capacity_full'); END IF;
 END IF;
 IF sid IS NULL THEN
  INSERT INTO public.content_plan_slots(account,week_start,kind,idea_source,idea_ref,topic,why_now,format,status)
  VALUES('ivan',wk,'review_draft','carousel_drafts',d.id::text,d.title,'Approved content placed into the shared plan',d.type,'planned') RETURNING id INTO sid;
 END IF;
 PERFORM set_config('content_plan.actor','planner',true);
 PERFORM set_config('content_plan.placement_kind',p_source,true);
 PERFORM set_config('app.schedule_manual',CASE WHEN p_source='explicit' THEN 'on' ELSE '' END,true);
 UPDATE public.carousel_drafts SET status='scheduled',scheduled_at=p_at WHERE id=d.id RETURNING scheduled_at INTO v_at;
 IF v_at IS DISTINCT FROM p_at THEN RAISE EXCEPTION 'placement shifted unexpectedly'; END IF;
 UPDATE public.content_plan_slots SET placed_draft_id=d.id,placed_at=v_at,placement_kind=p_source,updated_at=now() WHERE id=sid;
 UPDATE public.content_plan_slots s SET status='superseded',status_note='same draft placed through the shared plan',updated_at=now()
  WHERE s.account='ivan' AND s.id<>sid AND s.status IN ('planned','requested','proposal')
   AND (s.placed_draft_id=d.id OR s.idea_source='carousel_drafts' AND s.idea_ref=d.id::text
    OR s.idea_source='lm_idea_candidates' AND EXISTS(SELECT 1 FROM public.lm_idea_candidates l WHERE l.id::text=s.idea_ref AND l.promoted_draft_id=d.id));
 PERFORM set_config('content_plan.actor',coalesce(old_actor,''),true);
 PERFORM set_config('content_plan.placement_kind',coalesce(old_kind,''),true);
 PERFORM set_config('app.schedule_manual',coalesce(old_manual,''),true);
 RETURN jsonb_build_object('ok',true,'scheduled_at',v_at,'slot_id',sid);
END $function$;

commit;
