-- Rollback of db/281 (autopilot follow-up). Puts back the db/280 state: the autopilot candidates hold their own checks again,
-- the plan reads and the planner's write no longer use the autopilot's eligibility, the text guard and its pick ledger are
-- removed, the 3-argument live write and the Sunday 06:00 UTC job come back. It never touches carousel_drafts: a post the
-- guard took off the schedule stays in Review (find them first: select * from public.content_autopilot_picks where state = 'held';).
-- Plan slots the planner dropped as cannot go out stay dropped (content_plan_slots.status_note like 'cannot go out:%').
BEGIN;
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'content-autopilot-saturday';
DROP TRIGGER IF EXISTS zz_content_autopilot_text_guard ON public.carousel_drafts;
DROP FUNCTION IF EXISTS public.content_autopilot_text_guard();

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
    select coalesce(jsonb_agg(y.j order by y.created_at), '[]'::jsonb), count(*) into planned, n_planned from (
      select s.created_at, jsonb_build_object('kind','planned','slot_id', s.id, 'topic', s.topic, 'why_now', s.why_now,
        'evidence', s.evidence, 'format', s.format, 'picture', s.picture, 'idea_source', s.idea_source, 'idea_ref', s.idea_ref,
        'proposal', cfg.proposals_only and st.status = 'proposal', 'status', st.status, 'status_label', st.label, 'draft_id', st.draft_id) j
      from public.content_plan_slots s
      cross join lateral (
        select case
          when s.idea_source = 'carousel_drafts' then (select case when d.status = 'review' then 'waiting_review' else 'dropped' end from public.carousel_drafts d where d.id::text = s.idea_ref and d.scheduled_at is null)
          when s.idea_source = 'lm_idea_candidates' then (select case when l.status in ('reviewing','pending') then case when s.status = 'requested' then 'requested' else 'planned' end
                                                                       when l.status in ('promoted','approved') then 'drafting' else 'dropped' end from public.lm_idea_candidates l where l.id::text = s.idea_ref)
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

    if i >= 1 and target_week is null and n_posts + n_planned < target then target_week := wk; open_target := target - n_posts - n_planned; end if;
    weeks := weeks || jsonb_build_array(jsonb_build_object('start', wk, 'which', case i when 0 then 'this' when 1 then 'next' else 'after' end,
      'target', target, 'posts', posts, 'planned', planned, 'filled', n_posts + n_planned, 'dated', n_posts,
      'no_day', (select count(*) from jsonb_array_elements(planned) pl where pl->>'day' is null),
      'open', greatest(target - n_posts - n_planned, 0),
      'lead_magnets', (select count(*) from jsonb_array_elements(posts) p where (p->>'lead_magnet')::boolean),
      'founder', (select count(*) from jsonb_array_elements(posts) p where (p->>'founder')::boolean)));
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
end $function$;

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

CREATE OR REPLACE FUNCTION public.content_autopilot_candidates(p_account text, p_week date, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  cfg public.content_autopilot_config%ROWTYPE;
  v_ids uuid[]; v_brain jsonb := '{}'::jsonb; b jsonb; r record; out jsonb := '[]'::jsonb;
  f text[]; wn text[]; why text[]; sc numeric; inv jsonb; chk jsonb; mc jsonb; bv3 jsonb; v_carry text; age int; rd jsonb;
BEGIN
  SELECT * INTO cfg FROM public.content_autopilot_config WHERE account = p_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'no autopilot config for %', p_account; END IF;

  SELECT array_agg(d.id) INTO v_ids
    FROM public.carousel_drafts d JOIN public.cb34_p2_members m ON m.draft_id = d.id
   WHERE m.client_id = p_account
     AND (CASE WHEN p_account = 'ivan' THEN d.client_id IS NULL ELSE d.client_id = p_account END)
     AND d.status IN ('review','approved') AND d.scheduled_at IS NULL AND d.published_at IS NULL
     AND NOT coalesce(jsonb_typeof(d.taxonomy) = 'object' AND d.taxonomy ->> 'deleted_by_operator' = 'true', false)
     AND NOT coalesce(jsonb_typeof(d.taxonomy) = 'object' AND d.taxonomy ->> 'internal_test' = 'true', false);
  IF v_ids IS NULL THEN RETURN out; END IF;
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
           mr.verdict AS mr_verdict, mr.carry_pass AS mr_carry, mr.length_pass AS mr_len, mr.body_sha256 AS mr_sha,
           (SELECT s.week_start FROM public.content_plan_slots s WHERE s.account = p_account AND s.idea_source = 'carousel_drafts'
               AND s.idea_ref = d.id::text AND s.status IN ('planned','proposal','requested') ORDER BY s.created_at DESC LIMIT 1) AS planned_week,
           (SELECT s.id FROM public.content_plan_slots s WHERE s.account = p_account AND s.idea_source = 'carousel_drafts'
               AND s.idea_ref = d.id::text AND s.status IN ('planned','proposal','requested') ORDER BY s.created_at DESC LIMIT 1) AS plan_slot_id
      FROM public.carousel_drafts d
      JOIN public.cb34_p2_members m ON m.draft_id = d.id
      LEFT JOIN public.cb_must_carry_replay mr ON mr.draft_id = d.id
     WHERE d.id = ANY (v_ids)
  LOOP
    f := '{}'; wn := '{}'; why := '{}'; sc := 0;
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
    -- 10. freshness and other weeks
    age := (p_now::date - r.created_at::date);
    IF age > cfg.max_draft_age_days THEN f := f || ('older than ' || cfg.max_draft_age_days || ' days'); END IF;
    IF r.planned_week IS NOT NULL AND r.planned_week <> p_week THEN
      f := f || ('planned for the week of ' || to_char(r.planned_week, 'FMDD Mon'));
    END IF;
    IF coalesce(cardinality(r.image_urls), 0) = 0 AND r.type = 'text' THEN wn := wn || 'text only, no picture'::text; END IF;

    -- score (only explains the order; every pick already passed every check)
    IF r.status = 'approved' OR (r.verdict = 'keep' AND r.verdict_source <> 'implicit') THEN sc := sc + 100; why := why || 'you approved it'::text; END IF;
    IF r.planned_week = p_week THEN sc := sc + 50; why := why || 'the planner put it in this week'::text; END IF;
    IF b -> 'qa' ->> 'outcome' = 'passed' THEN sc := sc + 10; why := why || 'QA passed first time'::text;
    ELSIF b -> 'qa' ->> 'outcome' = 'recovered' THEN sc := sc + 5; why := why || 'QA passed after one rewrite'::text; END IF;
    rd := b -> 'read';
    IF jsonb_typeof(rd) = 'object' AND rd ->> 'proven' = 'true' AND coalesce(rd ->> 'small', 'false') <> 'true'
       AND (rd ->> 'rate') ~ '^[0-9.]+$' AND (rd ->> 'base') ~ '^[0-9.]+$' AND (rd ->> 'rate')::numeric > (rd ->> 'base')::numeric THEN
      sc := sc + 15; why := why || ('its kind of post (' || coalesce(rd ->> 'dim', '?') || ' ' || coalesce(rd ->> 'val', '?') || ') is proven above your usual');
    END IF;
    sc := sc + greatest(0, 10 - age / 3.0);
    IF r.source_ref LIKE 'outlier:%' THEN why := why || ('adapts a niche outlier by ' || coalesce(b -> 'brief' ->> 'author', r.author, 'an unnamed author')); END IF;
    IF v_carry IN ('verifier','replay') THEN why := why || 'carries what made the winner work'::text; END IF;

    out := out || jsonb_build_array(jsonb_build_object(
      'draft_id', r.id, 'title', r.title, 'status', r.status, 'type', r.type,
      'pillar', r.tax ->> 'pillar', 'founder', coalesce(r.tax ->> 'pillar' = 'personal', false),
      'opener', b -> 'angle' ->> 'opener', 'source_ref', r.source_ref, 'author', r.author,
      'author_name', b -> 'brief' ->> 'author', 'created_at', r.created_at, 'age_days', age,
      'must_carry', v_carry, 'planned_week', r.planned_week, 'plan_slot_id', r.plan_slot_id,
      'eligible', cardinality(f) = 0, 'fails', to_jsonb(f), 'warnings', to_jsonb(wn),
      'score', round(sc, 1), 'why', to_jsonb(why)));
  END LOOP;
  RETURN out;
END $function$;

CREATE OR REPLACE FUNCTION public.content_autopilot_run(p_account text, p_week date DEFAULT NULL::date, p_now timestamp with time zone DEFAULT now(), p_notify boolean DEFAULT true, p_trigger text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '90s'
AS $function$
#variable_conflict use_variable
DECLARE
  cfg public.content_autopilot_config%ROWTYPE; pcfg public.content_plan_config%ROWTYPE;
  v_run uuid := gen_random_uuid(); v_today date; v_week date; st jsonb; w jsonb; dated jsonb; planned jsonb; cands jsonb;
  target int; n_dated int; v_open int; n_slots int; n_elig int; founder_n int; founder_max int;
  dated_days date[] := '{}'; day_fmt jsonb := '{}'::jsonb; free_days date[] := '{}'; veto_days date[] := '{}';
  srcs text[] := '{}'; authors text[] := '{}'; pillar_n jsonb := '{}'::jsonb; openers text[] := '{}'; picked_ids uuid[] := '{}';
  picks jsonb := '[]'::jsonb; warnings jsonb := '[]'::jsonb; rejected jsonb := '[]'::jsonb; skip jsonb := '{}'::jsonb;
  c jsonb; best jsonb; best_sc numeric; adj numeric; why_skip text; k int; i int; dd date; v_day date; v_at timestamptz;
  fmt_prev text; fmt_next text; res jsonb; n_sched int := 0; v_summary text; v_lines text := ''; v_title text; v_payload jsonb;
  v_url text; v_secret text; v_req bigint; v_notify jsonb; v_outcome text; v_action text; p jsonb; v_reason text; s jsonb;
  lab text := CASE p_account WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Rise' WHEN 'arch' THEN 'Arch' ELSE p_account END;
BEGIN
  IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
  SELECT * INTO cfg FROM public.content_autopilot_config WHERE account = p_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'no autopilot config for %', p_account; END IF;
  v_today := (p_now AT TIME ZONE cfg.lane_tz)::date;
  v_week := coalesce(p_week, v_today + (8 - extract(isodow FROM v_today)::int));
  IF extract(isodow FROM v_week) <> 1 THEN RAISE EXCEPTION 'week must start on a Monday: %', v_week; END IF;
  IF cfg.mode = 'off' THEN
    INSERT INTO public.content_autopilot_runs(id, account, week_start, mode, trigger, outcome, summary)
    VALUES (v_run, p_account, v_week, 'off', p_trigger, 'off', 'Autopilot is off for this seat.');
    RETURN jsonb_build_object('ok', true, 'run_id', v_run, 'mode', 'off');
  END IF;
  IF cfg.mode = 'live' AND cfg.action <> 'schedule' THEN RAISE EXCEPTION 'client live step is not built'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('content-autopilot:' || p_account, 0));
  INSERT INTO public.content_autopilot_runs(id, account, week_start, mode, trigger, outcome) VALUES (v_run, p_account, v_week, cfg.mode, p_trigger, 'running');
  v_action := CASE WHEN cfg.action = 'propose_to_board' THEN 'would_propose' WHEN cfg.mode = 'live' THEN 'scheduled' ELSE 'would_schedule' END;

  SELECT * INTO pcfg FROM public.content_plan_config WHERE account = p_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'no plan config for %', p_account; END IF;
  founder_max := pcfg.founder_story_max;
  st := public.content_plan_week(p_account, p_now);
  SELECT x INTO w FROM jsonb_array_elements(st -> 'weeks') x WHERE (x ->> 'start')::date = v_week;
  IF w IS NULL THEN RAISE EXCEPTION 'the week of % is outside the plan horizon', v_week; END IF;
  target := (w ->> 'target')::int;
  dated := coalesce(w -> 'posts', '[]'::jsonb);
  planned := coalesce(w -> 'planned', '[]'::jsonb);
  n_dated := jsonb_array_length(dated);
  v_open := greatest(target - n_dated, 0);
  n_slots := least(v_open, cfg.max_picks);

  -- what the dated posts already take: days, formats, founder count, pillars, sources
  FOR p IN SELECT * FROM jsonb_array_elements(dated) LOOP
    IF p ->> 'day' IS NOT NULL THEN
      dated_days := dated_days || (p ->> 'day')::date;
      day_fmt := day_fmt || jsonb_build_object(p ->> 'day', coalesce(p ->> 'format', '?'));
    END IF;
  END LOOP;
  founder_n := (SELECT count(*) FROM jsonb_array_elements(dated) x WHERE coalesce((x ->> 'founder')::boolean, false));
  SELECT coalesce(jsonb_object_agg(t.pillar, t.n), '{}'::jsonb) INTO pillar_n FROM (
    SELECT d.taxonomy ->> 'pillar' AS pillar, count(*) AS n FROM public.carousel_drafts d
     WHERE d.id IN (SELECT (x ->> 'draft_id')::uuid FROM jsonb_array_elements(dated) x WHERE x ->> 'draft_id' IS NOT NULL)
       AND jsonb_typeof(d.taxonomy) = 'object' AND d.taxonomy ->> 'pillar' IS NOT NULL GROUP BY 1) t;
  SELECT coalesce(array_agg(DISTINCT m.source_ref) FILTER (WHERE m.source_ref LIKE 'outlier:%'), '{}'),
         coalesce(array_agg(DISTINCT public.cb35_source_author(p_account, m.source_ref, m.brief ->> 'source_author'))
                  FILTER (WHERE public.cb35_source_author(p_account, m.source_ref, m.brief ->> 'source_author') IS NOT NULL), '{}')
    INTO srcs, authors
    FROM public.carousel_drafts d JOIN public.cb34_p2_members m ON m.draft_id = d.id
   WHERE m.client_id = p_account AND (CASE WHEN p_account = 'ivan' THEN d.client_id IS NULL ELSE d.client_id = p_account END)
     AND d.status IN ('review','approved','scheduled','published')
     AND coalesce(d.published_at, d.scheduled_at) >= (v_week - cfg.source_cooldown_days)::timestamp AT TIME ZONE cfg.lane_tz
     AND coalesce(d.published_at, d.scheduled_at) <  (v_week + 7 + cfg.source_cooldown_days)::timestamp AT TIME ZONE cfg.lane_tz;

  -- free weekdays (automatic dates stay weekday-only, one post a day) outside the veto window
  FOR i IN 0..4 LOOP
    dd := v_week + i;
    CONTINUE WHEN dd = ANY (dated_days);
    IF ((dd::timestamp + cfg.lane_time) AT TIME ZONE cfg.lane_tz) < p_now + make_interval(hours => cfg.veto_hours) THEN
      veto_days := veto_days || dd; CONTINUE;
    END IF;
    free_days := free_days || dd;
  END LOOP;

  cands := public.content_autopilot_candidates(p_account, v_week, p_now);
  n_elig := (SELECT count(*) FROM jsonb_array_elements(cands) x WHERE (x ->> 'eligible')::boolean);
  SELECT coalesce(jsonb_agg(jsonb_build_object('draft_id', x -> 'draft_id', 'title', left(x ->> 'title', 90), 'fails', x -> 'fails')
           ORDER BY (x ->> 'created_at') DESC), '[]'::jsonb)
    INTO rejected FROM jsonb_array_elements(cands) x WHERE NOT (x ->> 'eligible')::boolean;

  FOR k IN 1..n_slots LOOP
    best := NULL; best_sc := NULL;
    FOR c IN SELECT x FROM jsonb_array_elements(cands) x WHERE (x ->> 'eligible')::boolean AND NOT ((x ->> 'draft_id')::uuid = ANY (picked_ids)) LOOP
      why_skip := NULL;
      IF (c ->> 'founder')::boolean AND founder_n >= founder_max THEN
        why_skip := 'founder stories are at the cap of ' || founder_max || ' this week';
      ELSIF c ->> 'source_ref' LIKE 'outlier:%' AND c ->> 'source_ref' = ANY (srcs) THEN
        why_skip := 'its source post is already used this week or within ' || cfg.source_cooldown_days || ' days';
      ELSIF c ->> 'author' IS NOT NULL AND c ->> 'author' = ANY (authors) THEN
        why_skip := 'another post from ' || coalesce(c ->> 'author_name', c ->> 'author') || ' is already used this week or within ' || cfg.source_cooldown_days || ' days';
      ELSIF c ->> 'pillar' IS NOT NULL AND coalesce((pillar_n ->> (c ->> 'pillar'))::int, 0) >= cfg.pillar_max_per_week THEN
        why_skip := 'already ' || cfg.pillar_max_per_week || ' ' || (c ->> 'pillar') || ' posts this week';
      END IF;
      IF why_skip IS NOT NULL THEN skip := skip || jsonb_build_object(c ->> 'draft_id', why_skip); CONTINUE; END IF;
      adj := (c ->> 'score')::numeric - CASE WHEN c ->> 'opener' IS NOT NULL AND c ->> 'opener' = ANY (openers) THEN 15 ELSE 0 END;
      IF best IS NULL OR adj > best_sc OR (adj = best_sc AND c ->> 'created_at' > best ->> 'created_at') THEN best := c; best_sc := adj; END IF;
    END LOOP;

    IF best IS NULL THEN
      INSERT INTO public.content_autopilot_log(run_id, account, week_start, mode, slot_n, action, reasons, warnings)
      VALUES (v_run, p_account, v_week, cfg.mode, k, 'not_scheduled',
        jsonb_build_array(CASE WHEN n_elig = 0 THEN 'no brain draft passed every check'
                               ELSE 'no draft left that passes every check and the rotation rules' END),
        CASE WHEN skip <> '{}'::jsonb THEN jsonb_build_array(jsonb_build_object('held_back_by_rotation', skip)) ELSE '[]'::jsonb END);
      CONTINUE;
    END IF;
    IF cardinality(free_days) = 0 THEN
      INSERT INTO public.content_autopilot_log(run_id, account, week_start, mode, slot_n, draft_id, title, action, score, reasons)
      VALUES (v_run, p_account, v_week, cfg.mode, k, (best ->> 'draft_id')::uuid, best ->> 'title', 'not_scheduled', best_sc,
        jsonb_build_array('no free weekday left at least ' || cfg.veto_hours || 'h ahead'));
      CONTINUE;
    END IF;
    -- day: the first free weekday whose neighbours carry a different format; else the first free weekday
    v_day := NULL;
    FOREACH dd IN ARRAY free_days LOOP
      fmt_prev := day_fmt ->> ((dd - 1)::text); fmt_next := day_fmt ->> ((dd + 1)::text);
      IF coalesce(fmt_prev, '') <> (best ->> 'type') AND coalesce(fmt_next, '') <> (best ->> 'type') THEN v_day := dd; EXIT; END IF;
    END LOOP;
    s := '[]'::jsonb;
    IF v_day IS NULL THEN v_day := free_days[1]; s := s || jsonb_build_array('two ' || (best ->> 'type') || ' posts on back-to-back days'); END IF;
    free_days := array_remove(free_days, v_day);
    v_at := (v_day::timestamp + cfg.lane_time) AT TIME ZONE cfg.lane_tz;

    picked_ids := picked_ids || (best ->> 'draft_id')::uuid;
    day_fmt := day_fmt || jsonb_build_object(v_day::text, best ->> 'type');
    IF (best ->> 'founder')::boolean THEN founder_n := founder_n + 1; END IF;
    IF best ->> 'source_ref' LIKE 'outlier:%' THEN srcs := srcs || (best ->> 'source_ref'); END IF;
    IF best ->> 'author' IS NOT NULL THEN authors := authors || (best ->> 'author'); END IF;
    IF best ->> 'pillar' IS NOT NULL THEN pillar_n := pillar_n || jsonb_build_object(best ->> 'pillar', coalesce((pillar_n ->> (best ->> 'pillar'))::int, 0) + 1); END IF;
    IF best ->> 'opener' IS NOT NULL THEN openers := openers || (best ->> 'opener'); END IF;

    picks := picks || jsonb_build_array(best || jsonb_build_object('slot_n', k, 'day', v_day, 'at', v_at, 'adj_score', best_sc, 'pick_warnings', (best -> 'warnings') || s));
  END LOOP;

  -- write: shadow and client = log only; live (ivan) = the Inbox's Schedule write, one savepoint per pick
  FOR p IN SELECT * FROM jsonb_array_elements(picks) LOOP
    res := NULL; v_reason := 'week of ' || to_char(v_week, 'FMDD Mon') || ', slot ' || (p ->> 'slot_n');
    IF cfg.mode = 'live' AND cfg.action = 'schedule' THEN
      BEGIN
        res := public.content_autopilot_schedule_ivan((p ->> 'draft_id')::uuid, (p ->> 'at')::timestamptz, v_reason);
      EXCEPTION WHEN others THEN res := jsonb_build_object('ok', false, 'error', SQLERRM);
      END;
      IF coalesce((res ->> 'ok')::boolean, false) THEN n_sched := n_sched + 1; END IF;
    END IF;
    INSERT INTO public.content_autopilot_log(run_id, account, week_start, mode, slot_n, plan_slot_id, slot_day, slot_at, draft_id, title,
      action, score, reasons, warnings, result)
    VALUES (v_run, p_account, v_week, cfg.mode, (p ->> 'slot_n')::int, (p ->> 'plan_slot_id')::uuid, (p ->> 'day')::date, (p ->> 'at')::timestamptz,
      (p ->> 'draft_id')::uuid, p ->> 'title',
      CASE WHEN res IS NULL THEN v_action WHEN (res ->> 'ok')::boolean THEN 'scheduled' ELSE 'error' END,
      (p ->> 'adj_score')::numeric, p -> 'why', coalesce(p -> 'pick_warnings', '[]'::jsonb),
      jsonb_build_object('must_carry', p ->> 'must_carry', 'source_ref', p ->> 'source_ref', 'author', coalesce(p ->> 'author_name', p ->> 'author'),
        'pillar', p ->> 'pillar', 'opener', p ->> 'opener', 'format', p ->> 'type', 'write', res));
  END LOOP;

  -- warnings: the plan's own (empty pillar, no proof, photos, LM due, founder cap) + what the autopilot could not do
  -- plan warnings that are about this week, or about the seat as a whole (no proof, no photos, empty pillar); not other weeks' days
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO warnings FROM jsonb_array_elements(coalesce(st -> 'warnings', '[]'::jsonb)) x
   WHERE x ->> 'code' IN ('no_fresh_proof', 'no_photos', 'empty_topic_area')
      OR EXISTS (SELECT 1 FROM generate_series(0, 6) g WHERE (x ->> 'text') LIKE '%' || to_char(v_week + g, 'FMDD Mon') || '%');
  IF jsonb_array_length(picks) < n_slots THEN
    warnings := warnings || jsonb_build_array(jsonb_build_object('code', 'unfilled',
      'text', (n_slots - jsonb_array_length(picks)) || ' of ' || n_slots || ' open slots stay empty: '
        || CASE WHEN n_elig = 0 THEN 'no brain draft passed every check' ELSE 'not enough drafts pass every check and the rotation rules' END));
  END IF;
  IF cardinality(veto_days) > 0 AND v_open > 0 THEN
    warnings := warnings || jsonb_build_array(jsonb_build_object('code', 'veto_window',
      'text', (SELECT string_agg(to_char(x, 'Dy FMDD Mon'), ', ') FROM unnest(veto_days) x) || ' left free: less than ' || cfg.veto_hours || 'h ahead'));
  END IF;
  FOR s IN SELECT x FROM jsonb_array_elements(planned) x LOOP
    c := (SELECT y FROM jsonb_array_elements(cands) y WHERE y ->> 'draft_id' = s ->> 'draft_id');
    IF c IS NOT NULL AND NOT (c ->> 'eligible')::boolean THEN
      warnings := warnings || jsonb_build_array(jsonb_build_object('code', 'planned_draft_failed', 'draft_id', c -> 'draft_id',
        'text', 'Planned "' || left(c ->> 'title', 60) || '" not used: ' || (c -> 'fails' ->> 0)));
    END IF;
  END LOOP;
  IF n_elig < target THEN
    warnings := warnings || jsonb_build_array(jsonb_build_object('code', 'thin_supply',
      'text', CASE WHEN n_elig = 0 THEN 'No brain draft passes every check right now' WHEN n_elig = 1 THEN 'Only 1 brain draft passes every check right now'
                   ELSE 'Only ' || n_elig || ' brain drafts pass every check right now' END));
  END IF;

  -- one summary line, plain words
  v_outcome := CASE WHEN v_open = 0 THEN 'week_full' WHEN jsonb_array_length(picks) = 0 THEN 'no_supply' ELSE 'ok' END;
  SELECT coalesce(string_agg(to_char((x ->> 'day')::date, 'Dy FMDD Mon') || ' ' || left(cfg.lane_time::text, 5) || ' "' || left(x ->> 'title', 70) || '"', '; '
           ORDER BY (x ->> 'day')), '') INTO v_lines FROM jsonb_array_elements(picks) x;
  v_title := 'Autopilot' || CASE WHEN cfg.mode = 'shadow' THEN ' (shadow)' ELSE '' END || ' · ' || lab || ' · week of ' || to_char(v_week, 'FMDD Mon');
  v_summary := CASE
    WHEN v_open = 0 THEN 'Nothing to schedule: the week already has ' || n_dated || ' of ' || target || ' posts.'
    WHEN jsonb_array_length(picks) = 0 THEN 'Nothing to schedule: ' || v_open || ' open slot' || CASE WHEN v_open = 1 THEN '' ELSE 's' END || ', no draft passed every check.'
    WHEN cfg.action = 'propose_to_board' THEN 'Autopilot would propose: ' || v_lines || '.'
    WHEN cfg.mode = 'shadow' THEN 'Autopilot would schedule: ' || v_lines || '. Nothing was scheduled.'
    ELSE 'Autopilot scheduled: ' || v_lines || '. Move or remove any of them in the calendar; each is at least ' || cfg.veto_hours || 'h away.' END;
  IF jsonb_array_length(warnings) > 0 THEN
    v_summary := v_summary || ' Warnings: ' || (SELECT string_agg(rtrim(x ->> 'text', '. '), '; ') FROM jsonb_array_elements(warnings) x) || '.';
  END IF;

  UPDATE public.content_autopilot_runs SET target = target, dated_before = n_dated, open_before = v_open, picked = jsonb_array_length(picks),
         scheduled = n_sched, eligible = n_elig, outcome = v_outcome, summary = v_summary, warnings = warnings, rejected = rejected
   WHERE id = v_run;

  -- ONE feed-only row in Ivan's inbox through the inbox-notify front door (content-plan producer, Plan view link)
  IF p_notify THEN
    v_payload := jsonb_build_object('family', 'content_plan', 'source', 'content-plan',
      'dedupe_key', 'autopilot:' || cfg.mode || ':' || p_account || ':' || v_week::text, 'severity', 'info',
      'title', v_title, 'body', left(v_summary, 1500), 'url', './#exp/d/content/plan?lane=' || p_account,
      'media', jsonb_build_object('kind', 'autopilot', 'mode', cfg.mode, 'account', p_account, 'week', v_week, 'run_id', v_run),
      'push', false);
    BEGIN
      SELECT value INTO v_url FROM public.integration_config WHERE key = 'inbox_notify_url';
      SELECT value INTO v_secret FROM public.integration_config WHERE key = 'inbox_push_secret';
      SELECT net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
               body := v_payload, timeout_milliseconds := 30000) INTO v_req;
      v_notify := jsonb_build_object('request_id', v_req, 'dedupe_key', v_payload ->> 'dedupe_key', 'title', v_title);
    EXCEPTION WHEN others THEN v_notify := jsonb_build_object('error', SQLERRM);
    END;
    UPDATE public.content_autopilot_runs SET notify = v_notify WHERE id = v_run;
  END IF;

  RETURN jsonb_build_object('ok', true, 'run_id', v_run, 'account', p_account, 'mode', cfg.mode, 'week', v_week, 'target', target,
    'dated', n_dated, 'open', v_open, 'eligible', n_elig, 'picked', jsonb_array_length(picks), 'scheduled', n_sched,
    'summary', v_summary, 'notify', v_notify);
END $function$;

DROP FUNCTION IF EXISTS public.content_autopilot_schedule_ivan(uuid, timestamptz, text, text, uuid);
CREATE OR REPLACE FUNCTION public.content_autopilot_schedule_ivan(p_draft uuid, p_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_at timestamptz; v_mode text;
BEGIN
  IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
  SELECT mode INTO v_mode FROM public.content_autopilot_config WHERE account = 'ivan';
  IF v_mode IS DISTINCT FROM 'live' THEN RAISE EXCEPTION 'autopilot for ivan is %, not live: nothing scheduled', coalesce(v_mode, 'missing'); END IF;
  -- the move log (content_plan_record_move) names the planner, not Ivan, as who set the time
  PERFORM set_config('content_plan.actor', 'planner', true);
  PERFORM set_config('content_plan.move_reason', left('autopilot: ' || coalesce(p_reason, ''), 300), true);
  UPDATE public.carousel_drafts SET status = 'scheduled', scheduled_at = p_at
   WHERE id = p_draft AND client_id IS NULL AND status IN ('review','approved','scheduled') AND published_at IS NULL
   RETURNING scheduled_at INTO v_at;
  PERFORM set_config('content_plan.actor', '', true);
  PERFORM set_config('content_plan.move_reason', '', true);
  IF v_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_schedulable'); END IF;
  RETURN jsonb_build_object('ok', true, 'scheduled_at', v_at, 'requested_at', p_at, 'shifted_by_weekday_guard', v_at IS DISTINCT FROM p_at);
END $function$;
REVOKE ALL ON FUNCTION public.content_autopilot_schedule_ivan(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.content_autopilot_sunday(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE a text; out jsonb := '[]'::jsonb; res jsonb;
BEGIN
  FOR a IN SELECT account FROM public.content_autopilot_config WHERE mode <> 'off' ORDER BY account LOOP
    BEGIN
      res := public.content_autopilot_run(a, NULL, p_now, true, 'cron');
    EXCEPTION WHEN others THEN
      INSERT INTO public.content_autopilot_runs(account, mode, trigger, outcome, error)
      VALUES (a, (SELECT mode FROM public.content_autopilot_config WHERE account = a), 'cron', 'error', SQLERRM);
      res := jsonb_build_object('account', a, 'error', SQLERRM);
    END;
    out := out || jsonb_build_array(res);
  END LOOP;
  RETURN out;
END $function$;
REVOKE ALL ON FUNCTION public.content_autopilot_sunday(timestamptz) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.content_autopilot_weekly(timestamptz);
DROP FUNCTION IF EXISTS public.content_brain_block_reason(jsonb, date);
DROP FUNCTION IF EXISTS public.content_brain_eligibility(text, timestamptz, uuid[], timestamptz);
DROP TABLE IF EXISTS public.content_autopilot_picks;
SELECT cron.schedule('content-autopilot-sunday', '0 6 * * 0', $$set statement_timeout = '300s'; select public.content_autopilot_sunday()$$);
COMMIT;
