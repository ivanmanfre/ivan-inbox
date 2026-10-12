-- 265: the plan_ready alert. One row per account-week in content_plan_alerts (primary key), fired once through
-- inbox-notify (family content_plan, kind plan_ready, dedupe plan-ready:<account>:<week>) when a week has a run that
-- picked something AND every planned post has a written draft, or 6 hours after the week was first seen filled.
-- Never fires on a "nothing to plan" run (no run with picked > 0 for that week). content_plan_apply calls the check at
-- its end (an alert failure never fails a plan write); pg_cron job content-plan-ready runs the sweep every 15 minutes.
-- Weeks planned before this migration are seeded as "never alerted" so the first sweep stays quiet.
-- Rollback = 265_content_plan_ready_alert_rollback.sql (content_plan_apply restored to its live body, byte-identical to db/262).
-- (The plan numbered this 264; 263 and 264 are taken by the plan-UI branch.)

select set_config('lock_timeout', '5s', true);

create table if not exists public.content_plan_alerts (
  account text not null check (account in ('ivan','risedtc','arch')),
  week_start date not null check (extract(isodow from week_start) = 1),
  filled_at timestamptz not null,
  sent_at timestamptz,
  request_id bigint,
  payload jsonb,
  attempts int not null default 0,
  note text,
  primary key (account, week_start)
);
alter table public.content_plan_alerts enable row level security;
comment on table public.content_plan_alerts is 'db/265: one plan_ready alert per account-week. filled_at = first time the check saw the week planned; sent_at = claimed by the single sender; note set = planned before db/265, never alerted.';

-- Weeks already planned before this migration: no alert for them.
insert into public.content_plan_alerts(account, week_start, filled_at, note)
select distinct r.account, r.target_week, now(), 'planned before db/265, never alerted'
  from public.content_plan_runs r where r.picked > 0 and r.target_week is not null
on conflict (account, week_start) do nothing;

create or replace function public.content_plan_ready_check(p_account text, p_week date, p_now timestamptz default now(), p_dry boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set statement_timeout to '15s'
as $function$
declare
  led public.content_plan_alerts%rowtype; st jsonb; w jsonb; filled timestamptz;
  v_total int; v_written int; v_waiting int; v_unwritten int; v_proposal int; v_low int; v_failed int; v_open int;
  v_name text; v_label text; v_title text; v_body text; v_ideas text; v_payload jsonb; v_url text; v_secret text; v_req bigint; v_claimed int; v_had boolean;
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  perform pg_advisory_xact_lock(hashtextextended('content-plan-ready:' || p_account || ':' || p_week::text, 0));

  select * into led from public.content_plan_alerts where account = p_account and week_start = p_week;
  v_had := found;
  if v_had and led.sent_at is not null then return jsonb_build_object('fire', false, 'why', 'already sent'); end if;
  if v_had and led.note is not null then return jsonb_build_object('fire', false, 'why', 'planned before the alert existed'); end if;
  -- Nothing to plan: no run for this week ever picked anything. A run with picked = 0 (or one with no target week) is not a plan.
  if not exists (select 1 from public.content_plan_runs r where r.account = p_account and r.target_week = p_week and r.picked > 0) then
    return jsonb_build_object('fire', false, 'why', 'nothing planned');
  end if;
  if not v_had then
    if not p_dry then
      insert into public.content_plan_alerts(account, week_start, filled_at) values (p_account, p_week, p_now)
        on conflict (account, week_start) do nothing;
      select * into led from public.content_plan_alerts where account = p_account and week_start = p_week;
      if led.sent_at is not null then return jsonb_build_object('fire', false, 'why', 'already sent'); end if;
    end if;
    filled := p_now;
  else
    filled := led.filled_at;
  end if;

  st := public.content_plan_week(p_account, p_now);
  select x into w from jsonb_array_elements(st->'weeks') x where x->>'start' = p_week::text;
  if w is null then return jsonb_build_object('fire', false, 'why', 'week not in view'); end if;

  with it as (
    select 'post' as src, x->>'status' as status, coalesce((x #>> '{brain,flags,low_score}')::boolean, false) as low from jsonb_array_elements(w->'posts') x
    union all
    select 'planned', x->>'status', coalesce((x #>> '{brain,flags,low_score}')::boolean, false) from jsonb_array_elements(w->'planned') x)
  select count(*),
         count(*) filter (where src = 'post' or status = 'waiting_review'),
         count(*) filter (where (src = 'post' and status = 'review') or (src = 'planned' and status = 'waiting_review')),
         count(*) filter (where src = 'planned' and status in ('planned','requested','drafting')),
         count(*) filter (where src = 'planned' and status = 'proposal'),
         count(*) filter (where low and ((src = 'post' and status = 'review') or (src = 'planned' and status = 'waiting_review')))
    into v_total, v_written, v_waiting, v_unwritten, v_proposal, v_low from it;
  if v_total = 0 then return jsonb_build_object('fire', false, 'why', 'nothing in the week'); end if;
  v_open := coalesce((w->>'open')::int, 0);

  -- Wait for the drafts (or for the planner to finish filling the week), but never longer than 6 hours from first seen filled.
  if (v_unwritten > 0 or v_open > 0) and p_now < filled + interval '6 hours' then
    return jsonb_build_object('fire', false, 'why', 'drafts still being written', 'unwritten', v_unwritten, 'open', v_open, 'filled_at', filled);
  end if;

  select count(*) into v_failed from public.content_plan_slots s join public.client_ideas ci on s.idea_source = 'client_ideas' and ci.id::text = s.idea_ref
   where s.account = p_account and s.week_start = p_week and s.status in ('planned','proposal','requested') and ci.status in ('approved','live')
     and exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id)
     and not exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status not in ('error','archived'));

  v_name := case p_account when 'ivan' then 'Ivan' when 'risedtc' then 'Rise' else 'Arch' end;
  v_label := to_char(p_week, 'FMDD Mon');
  v_title := v_name || ' · week of ' || v_label || ' is ready';
  if v_unwritten = 0 and v_proposal = 0 and v_low = 0 and v_failed = 0 and v_written = v_waiting and v_written > 0 then
    v_body := v_written || case when v_written = 1 then ' post written and checked. It waits' else ' posts written and checked. They wait' end || ' for your OK.';
  else
    v_body := case when v_written = 0 then 'No post is written yet.'
                   else v_written || ' written, ' || case when v_waiting = 0 then 'none wait' when v_waiting = 1 then '1 waits' else v_waiting || ' wait' end || ' for your OK.' end;
    if v_unwritten > 0 then v_body := v_body || ' ' || v_unwritten || case when v_unwritten = 1 then ' is' else ' are' end || ' still being written.'; end if;
    if v_proposal > 0 then v_body := v_body || ' ' || v_proposal || case when v_proposal = 1 then ' waits' else ' wait' end || ' for you to start.'; end if;
    if v_low > 0 then v_body := v_body || ' ' || v_low || case when v_low = 1 then ' has' else ' have' end || ' a low score.'; end if;
    if v_failed > 0 then v_body := v_body || ' ' || v_failed || ' failed.'; end if;
  end if;
  select string_agg(regexp_replace(regexp_replace(x->>'text', '^Out of ideas for ', ''), ' \(.*\)$', ''), ' and ') into v_ideas
    from jsonb_array_elements(st->'warnings') x where x->>'code' = 'empty_topic_area' and x->>'text' like 'Out of ideas for %';
  if v_ideas is not null then v_body := v_body || ' Out of ideas for ' || v_ideas || '.'; end if;

  v_payload := jsonb_build_object('family', 'content_plan', 'source', 'content-plan', 'dedupe_key', 'plan-ready:' || p_account || ':' || p_week::text,
    'severity', 'info', 'title', v_title, 'body', v_body, 'url', './#exp/d/content/plan?lane=' || p_account,
    'media', jsonb_build_object('kind', 'plan_ready', 'account', p_account, 'week', p_week), 'push', true);
  if p_dry then return jsonb_build_object('fire', true, 'dry', true, 'payload', v_payload); end if;

  -- One sender: the row is claimed before the post, so a second caller (apply and sweep together) finds it sent.
  update public.content_plan_alerts set sent_at = p_now, payload = v_payload where account = p_account and week_start = p_week and sent_at is null;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then return jsonb_build_object('fire', false, 'why', 'already sent'); end if;
  select value into v_url from public.integration_config where key = 'inbox_notify_url';
  select value into v_secret from public.integration_config where key = 'inbox_push_secret';
  select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
           body := v_payload, timeout_milliseconds := 30000) into v_req;
  update public.content_plan_alerts set request_id = v_req where account = p_account and week_start = p_week;
  return jsonb_build_object('fire', true, 'payload', v_payload);
end $function$;

create or replace function public.content_plan_ready_sweep(p_now timestamptz default now())
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set statement_timeout to '60s'
as $function$
declare a text; wk date; w0 date := ((p_now at time zone 'Europe/Warsaw')::date) - (extract(isodow from (p_now at time zone 'Europe/Warsaw')::date)::int - 1);
  out jsonb := '[]'::jsonb; r jsonb;
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  -- An alert whose post came back with an error (or no answer) is re-armed, at most 3 tries; the dedupe key folds a repeat.
  update public.content_plan_alerts l set sent_at = null, request_id = null, attempts = l.attempts + 1
   where l.sent_at is not null and l.request_id is not null and l.attempts < 3 and l.sent_at < p_now - interval '3 minutes' and l.sent_at > p_now - interval '3 hours'
     and exists (select 1 from net._http_response h where h.id = l.request_id and (h.status_code is null or h.status_code not between 200 and 299));
  foreach a in array array['ivan','risedtc','arch'] loop
    for wk in select distinct r2.target_week from public.content_plan_runs r2
               where r2.account = a and r2.picked > 0 and r2.target_week between w0 and w0 + 14
                 and not exists (select 1 from public.content_plan_alerts l where l.account = a and l.week_start = r2.target_week and (l.sent_at is not null or l.note is not null))
               order by 1 loop
      begin
        r := public.content_plan_ready_check(a, wk, p_now);
        out := out || jsonb_build_array(jsonb_build_object('account', a, 'week', wk) || r - 'payload');
      exception when others then
        out := out || jsonb_build_array(jsonb_build_object('account', a, 'week', wk, 'error', sqlerrm));
      end;
    end loop;
  end loop;
  return out;
end $function$;

revoke all on function public.content_plan_ready_check(text, date, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.content_plan_ready_sweep(timestamptz) from public, anon, authenticated;
grant execute on function public.content_plan_ready_check(text, date, timestamptz, boolean) to service_role;
grant execute on function public.content_plan_ready_sweep(timestamptz) to service_role;

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
  -- db/265: tell the plan_ready check this week was just written. An alert failure never fails the plan write.
  begin
    perform public.content_plan_ready_check(p_account, p_week);
  exception when others then null;
  end;
  return jsonb_build_object('ok', true, 'run_id', v_run, 'target_week', p_week, 'open_before', v_open, 'inserted', inserted, 'skipped', skipped);
end $function$;


select cron.schedule('content-plan-ready', '*/15 * * * *', 'select public.content_plan_ready_sweep()')
 where not exists (select 1 from cron.job where jobname = 'content-plan-ready');
