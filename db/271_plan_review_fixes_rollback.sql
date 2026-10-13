-- Rollback db/271: the two function bodies as they were live before. Table grants are not restored (they were unused).

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
       and exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id)
       and not exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status not in ('error','archived'));
    if n > 0 then
      warnings := warnings || jsonb_build_array(jsonb_build_object('code','draft_failed','text',
        n || ' planned draft' || case when n = 1 then '' else 's' end || ' failed the check twice. The planner is picking a new topic.'));
    end if;
  end if;
  if p_account <> 'ivan' then
    for r in
      select d.taxonomy->>'pillar' pillar, count(*) n from public.carousel_drafts d
       where d.client_id = p_account and d.status = 'published' and d.published_at >= p_now - interval '56 days' and d.taxonomy->>'pillar' is not null
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

CREATE OR REPLACE FUNCTION public.content_plan_ready_check(p_account text, p_week date, p_now timestamp with time zone DEFAULT now(), p_dry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
AS $function$
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
  -- Planned before db/265 and already full: never alerted. A seed marked "open places" may alert once, when the week is full (below).
  if v_had and led.note is not null and led.note not like '%open places' then return jsonb_build_object('fire', false, 'why', 'planned before the alert existed'); end if;
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

  -- A week seeded with open places: quiet until the planner fills it, then it is judged like any new week (6 h clock starts now).
  if v_had and led.note is not null then
    if v_open > 0 then return jsonb_build_object('fire', false, 'why', 'planned before the alert existed, still has open places', 'open', v_open); end if;
    filled := p_now;
    if not p_dry then update public.content_plan_alerts set note = null, filled_at = p_now where account = p_account and week_start = p_week; end if;
  end if;

  -- Wait for the drafts (or for the planner to finish filling the week), but never longer than 6 hours from first seen filled.
  if (v_unwritten > 0 or v_open > 0) and p_now < filled + interval '6 hours' then
    return jsonb_build_object('fire', false, 'why', 'drafts still being written', 'unwritten', v_unwritten, 'open', v_open, 'filled_at', filled);
  end if;

  select count(*) into v_failed from public.content_plan_slots s join public.client_ideas ci on s.idea_source = 'client_ideas' and ci.id::text = s.idea_ref
   where s.account = p_account and s.week_start = p_week and s.status in ('planned','proposal','requested') and ci.status in ('approved','live')
     and exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id)
     and not exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status not in ('error','archived'));

  -- db/270: a failed draft whose slot the planner already refilled (the week has no open slot) is not news.
  if v_open = 0 then v_failed := 0; end if;

  v_name := case p_account when 'ivan' then 'Ivan' when 'risedtc' then 'Rise' else 'Arch' end;
  v_label := to_char(p_week, 'FMDD Mon');
  v_title := v_name || ' · week of ' || v_label || ' is planned';
  if v_unwritten = 0 and v_proposal = 0 and v_low = 0 and v_failed = 0 and v_written = v_waiting and v_written > 0 then
    v_title := v_name || ' · week of ' || v_label || ' is ready';
    v_body := v_written || case when v_written = 1 then ' post written and checked. It waits' else ' posts written and checked. They wait' end || ' for your OK.';
  else
    v_body := case when v_written = 0 then 'No post is written yet.'
                   else v_written || ' written, ' || case when v_waiting = 0 then 'none wait' when v_waiting = 1 then '1 waits' else v_waiting || ' wait' end || ' for your OK.' end;
    if v_unwritten > 0 then v_body := v_body || ' ' || v_unwritten || case when v_unwritten = 1 then ' is' else ' are' end || ' still being written.'; end if;
    if v_proposal > 0 then v_body := v_body || ' ' || v_proposal || case when v_proposal = 1 then ' topic needs' else ' topics need' end || ' you to tap Generate draft.'; end if;
    if v_low > 0 then v_body := v_body || ' ' || v_low || case when v_low = 1 then ' has' else ' have' end || ' a low score.'; end if;
    if v_failed > 0 then v_body := v_body || ' ' || v_failed || case when v_failed = 1 then ' draft' else ' drafts' end || ' failed the quality check. The planner is picking new topics.'; end if;
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
