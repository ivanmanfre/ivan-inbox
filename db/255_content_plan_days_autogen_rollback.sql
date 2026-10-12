-- 255 rollback: restores the three content_plan read functions as they were before 255 (captured live 2026-10-12) and resets the client flags.
-- Slot evidence text rewritten by 255 stays in its plainer wording.

CREATE OR REPLACE FUNCTION public.content_plan_post_evidence(p_draft uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d public.carousel_drafts%rowtype; ev jsonb := '[]'::jsonb; ci public.client_ideas%rowtype; call_title text; call_at timestamptz; ts text;
  m record; o record;
begin
  select * into d from public.carousel_drafts where id = p_draft;
  if not found then return ev; end if;
  if d.taxonomy ? 'lead_magnet' then
    ev := ev || jsonb_build_array(jsonb_build_object('type','lead_magnet','label','Lead magnet launch'
      || case when (d.taxonomy->>'paid_boost') = 'true' then ', boosted with paid ads' else '' end));
  end if;
  if jsonb_typeof(d.source_detail) = 'object' and d.source_detail->>'kind' = 'user_approved_series' then
    ev := ev || jsonb_build_array(jsonb_build_object('type','series','label','Series you approved, part ' || coalesce(d.source_detail->>'option','?')));
  end if;
  if d.taxonomy->>'source' = 'ivan-film-script' then
    ev := ev || jsonb_build_array(jsonb_build_object('type','own_source','label','Your own words from the service-film script'));
  end if;
  if d.client_idea_id is not null then
    select * into ci from public.client_ideas where id = d.client_idea_id;
    if found then
      ts := ci.meta->>'source_ts';
      if ci.lane in ('sales_call','fireflies_call') or ci.source_ref ~ '^(fc|ffc|ffr)-' then
        if ts ~ '\|' then
          begin call_at := split_part(ts,'|',2)::timestamptz; exception when others then call_at := null; end;
        end if;
        if call_at is not null then
          select t.title into call_title from public.transcripts t
           where t.source in ('fathom-risedtc','fireflies-arch') and t.date between call_at - interval '3 minutes' and call_at + interval '3 minutes'
           order by abs(extract(epoch from t.date - call_at)) limit 1;
        end if;
        ev := ev || jsonb_build_array(jsonb_build_object('type','call','label','From the call'
          || coalesce(' "' || call_title || '"','') || coalesce(' on ' || to_char(call_at at time zone 'Europe/Warsaw','FMDD Mon'),''),
          'at', call_at, 'ref', ci.source_ref));
      elsif ci.lane = 'winner_repurpose' or ci.source_label ilike '%winner%' then
        ev := ev || jsonb_build_array(jsonb_build_object('type','past_winner','label','Re-run of a past winner'));
      elsif ci.source_label is not null then
        ev := ev || jsonb_build_array(jsonb_build_object('type','idea','label',ci.source_label));
      end if;
    end if;
  end if;
  select mm.source_ref, mm.brief into m from public.cb34_p2_members mm where mm.draft_id = d.id order by mm.created_at desc limit 1;
  if found and m.source_ref like 'outlier:linkedin:%' then
    select os.ratio into o from public.outlier_post_scores os
     where os.client_id = coalesce(d.client_id,'ivan') and os.post_ref = split_part(m.source_ref, ':', 3) order by os.created_at desc limit 1;
    ev := ev || jsonb_build_array(jsonb_build_object('type','outlier','label','Niche outlier the Content Brain adapted'
      || case when o.ratio is not null then ', ' || round(o.ratio::numeric,1) || 'x its author''s usual' else '' end, 'ref', m.source_ref));
  elsif found then
    ev := ev || jsonb_build_array(jsonb_build_object('type','brain','label','Content Brain draft', 'ref', m.source_ref));
  end if;
  if d.source_label = 'proven-winner-mirror' or d.taxonomy->>'source' = 'proven-winner-mirror' then
    ev := ev || jsonb_build_array(jsonb_build_object('type','past_winner','label','Mirror of a proven winner'));
  end if;
  if d.taxonomy->>'pillar' = 'personal' then
    ev := ev || jsonb_build_array(jsonb_build_object('type','founder','label','Founder story (max 2 a week)'));
  end if;
  if jsonb_array_length(ev) = 0 then
    if (d.taxonomy->>'approval') like 'explicit-user%' or (jsonb_typeof(d.source_detail) = 'object' and d.source_detail ? 'authorization') or d.source_label = 'manual' then
      ev := jsonb_build_array(jsonb_build_object('type','approved','label','Written by hand and approved by you'));
    elsif d.source_label is not null then
      ev := jsonb_build_array(jsonb_build_object('type','idea','label',d.source_label));
    elsif d.taxonomy->>'pillar' is not null then
      ev := jsonb_build_array(jsonb_build_object('type','pillar','label','Pillar: ' || replace(d.taxonomy->>'pillar','_',' ')));
    end if;
  end if;
  return ev;
end $function$
;

CREATE OR REPLACE FUNCTION public.content_plan_idea_evidence(p_source text, p_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare ev jsonb := '[]'::jsonb; l public.lm_idea_candidates%rowtype; ci public.client_ideas%rowtype; e jsonb;
  call_at timestamptz; call_title text; ts text; tid text; lift numeric;
begin
  if p_source = 'lm_idea_candidates' then
    select * into l from public.lm_idea_candidates where id::text = p_ref;
    if not found then return ev; end if;
    e := case when jsonb_typeof(l.evidence) = 'array' then l.evidence->0 else '{}'::jsonb end;
    if l.source in ('ivan_call','calls','kyle_call') then
      tid := coalesce(e->>'transcript_id', l.source_ref);
      select t.title, t.date into call_title, call_at from public.transcripts t where t.id::text = tid limit 1;
      ev := ev || jsonb_build_array(jsonb_build_object('type','call','label',
        case l.source when 'kyle_call' then 'From Kyle''s call' else 'From your call' end
        || coalesce(' "' || call_title || '"','') || coalesce(' on ' || to_char(call_at at time zone 'Europe/Warsaw','FMDD Mon'),''),
        'at', call_at, 'ref', tid, 'quote', left(coalesce(e->>'quote', e->>'anchor_quote'),220)));
    elsif l.source = 'claude_sessions' then
      ev := ev || jsonb_build_array(jsonb_build_object('type','own_work','label','From your own build sessions'
        || coalesce(' (' || lower(e->>'tier') || ')',''), 'quote', left(e->>'story',220)));
    elsif l.source_ref ~ '^(outlier|cb22):(linkedin|x):' then
      lift := case when e->>'lift' ~ '^[0-9]+(\.[0-9]+)?$' then (e->>'lift')::numeric end;
      ev := ev || jsonb_build_array(jsonb_build_object('type','outlier','label','Niche outlier'
        || case when lift is not null then ', ' || round(lift,1) || 'x its author''s usual' else '' end, 'ref', l.source_ref));
    else
      ev := ev || jsonb_build_array(jsonb_build_object('type','idea','label','Idea bank: ' || replace(coalesce(l.source,'manual'),'_',' ')));
    end if;
    if l.composite_score is not null then
      ev := ev || jsonb_build_array(jsonb_build_object('type','score','label','Idea score ' || round(l.composite_score,1)));
    end if;
  elsif p_source = 'client_ideas' then
    select * into ci from public.client_ideas where id::text = p_ref;
    if not found then return ev; end if;
    ts := ci.meta->>'source_ts';
    if ci.lane in ('sales_call','fireflies_call') or ci.source_ref ~ '^(fc|ffc|ffr)-' then
      if ts ~ '\|' then begin call_at := split_part(ts,'|',2)::timestamptz; exception when others then call_at := null; end; end if;
      if call_at is not null then
        select t.title into call_title from public.transcripts t
         where t.source in ('fathom-risedtc','fireflies-arch') and t.date between call_at - interval '3 minutes' and call_at + interval '3 minutes'
         order by abs(extract(epoch from t.date - call_at)) limit 1;
      end if;
      ev := ev || jsonb_build_array(jsonb_build_object('type','call','label','From the call'
        || coalesce(' "' || call_title || '"','') || coalesce(' on ' || to_char(call_at at time zone 'Europe/Warsaw','FMDD Mon'),''),
        'at', call_at, 'ref', ci.source_ref,
        'quote', left(coalesce(ci.idea->>'verbatim_quote', ci.idea->>'anchor_quote', ci.meta->'source_detail'->>'quote'),220)));
    elsif ci.source_ref ~ '^(outlier|cb22):(linkedin|x):' then
      e := coalesce(ci.score_breakdown,'{}'::jsonb);
      lift := case when e->>'lift' ~ '^[0-9]+(\.[0-9]+)?$' then (e->>'lift')::numeric end;
      ev := ev || jsonb_build_array(jsonb_build_object('type','outlier','label','Niche outlier'
        || case when lift is not null then ', ' || round(lift,1) || 'x its author''s usual' else '' end, 'ref', ci.source_ref));
    elsif ci.lane = 'winner_repurpose' then
      ev := ev || jsonb_build_array(jsonb_build_object('type','past_winner','label','Re-run of a past winner'
        || coalesce(' (' || (ci.meta->>'original_comments') || ' comments)','')));
    else
      ev := ev || jsonb_build_array(jsonb_build_object('type','idea','label',coalesce(ci.source_label,'Idea bank')));
    end if;
    if ci.recipe_fit is not null and cardinality(ci.recipe_fit) > 0 then
      ev := ev || jsonb_build_array(jsonb_build_object('type','brain_rule','label','Fits what niche outliers carry: ' || replace(array_to_string(ci.recipe_fit[1:3], ', '),'_',' ')));
    end if;
  elsif p_source = 'carousel_drafts' then
    return public.content_plan_post_evidence(p_ref::uuid);
  end if;
  return ev;
end $function$
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
        'format', d.type, 'lead_magnet', d.taxonomy ? 'lead_magnet' or exists (select 1 from public.scheduled_posts q0
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
        'proposal', cfg.proposals_only, 'status', st.status, 'status_label', st.label, 'draft_id', st.draft_id) j
      from public.content_plan_slots s
      cross join lateral (
        select case
          when s.idea_source = 'carousel_drafts' then (select case when d.status = 'review' then 'waiting_review' else 'dropped' end from public.carousel_drafts d where d.id::text = s.idea_ref and d.scheduled_at is null)
          when s.idea_source = 'lm_idea_candidates' then (select case when l.status in ('reviewing','pending') then case when s.status = 'requested' then 'requested' else 'planned' end
                                                                       when l.status in ('promoted','approved') then 'drafting' else 'dropped' end from public.lm_idea_candidates l where l.id::text = s.idea_ref)
          else (select case when ci.status = 'staged' then 'proposal' when ci.status = 'approved' then 'drafting' when ci.status = 'live' then 'drafting' else 'dropped' end from public.client_ideas ci where ci.id::text = s.idea_ref)
        end as status0,
        (select coalesce(case when s.idea_source = 'carousel_drafts' then s.idea_ref::uuid end,
                         (select l.promoted_draft_id from public.lm_idea_candidates l where s.idea_source = 'lm_idea_candidates' and l.id::text = s.idea_ref),
                         (select d.id from public.carousel_drafts d where s.idea_source = 'client_ideas' and d.client_idea_id::text = s.idea_ref order by d.created_at desc limit 1))) as draft_id
      ) st0
      cross join lateral (
        select coalesce(st0.status0, 'dropped') as status, st0.draft_id,
          case coalesce(st0.status0,'dropped') when 'waiting_review' then 'Draft waiting in Review' when 'planned' then 'Planned, draft not written yet'
            when 'requested' then 'Draft requested' when 'drafting' then 'Draft being written or waiting in Review'
            when 'proposal' then 'Proposal: generate it from Ideas to use it' else 'Dropped' end as label
      ) st
      where s.account = p_account and s.week_start = wk and s.status in ('planned','proposal','requested')
        and coalesce(st.status,'dropped') <> 'dropped'
        and not exists (select 1 from public.carousel_drafts d where d.id = st.draft_id and d.scheduled_at is not null)
    ) y;

    if i >= 1 and target_week is null and n_posts + n_planned < target then target_week := wk; open_target := target - n_posts - n_planned; end if;
    weeks := weeks || jsonb_build_array(jsonb_build_object('start', wk, 'which', case i when 0 then 'this' when 1 then 'next' else 'after' end,
      'target', target, 'posts', posts, 'planned', planned, 'filled', n_posts + n_planned, 'open', greatest(target - n_posts - n_planned, 0),
      'lead_magnets', (select count(*) from jsonb_array_elements(posts) p where (p->>'lead_magnet')::boolean),
      'founder', (select count(*) from jsonb_array_elements(posts) p where (p->>'founder')::boolean)));
  end loop;

  -- Topics already done: published in the last 8 weeks.
  select coalesce(jsonb_agg(jsonb_build_object('title', coalesce(nullif(d.title,''), left(d.post_body,80)), 'day', (d.published_at at time zone 'Europe/Warsaw')::date,
           'format', d.type, 'pillar', d.taxonomy->>'pillar') order by d.published_at desc), '[]'::jsonb) into done
    from (select * from public.carousel_drafts d where (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end)
            and d.status = 'published' and d.published_at >= p_now - interval '56 days' order by d.published_at desc limit 40) d;

  -- Written drafts waiting in Review with no date: the first supply for an open slot.
  select coalesce(jsonb_agg(jsonb_build_object('draft_id', d.id, 'title', coalesce(nullif(d.title,''), left(d.post_body,80)), 'format', d.type,
           'created_at', d.created_at, 'brain', exists(select 1 from public.cb34_p2_members m where m.draft_id = d.id and m.state = 'released'),
           'evidence', public.content_plan_post_evidence(d.id)) order by d.created_at desc), '[]'::jsonb) into supply
    from (select * from public.carousel_drafts d where (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end)
            and d.status = 'review' and d.scheduled_at is null and d.created_at >= p_now - interval '30 days'
            and not coalesce((d.taxonomy->>'deleted_by_operator') = 'true', false)
            and not exists (select 1 from public.cb39_draft_verdicts v where v.draft_id = d.id and v.verdict = 'drop')
          order by d.created_at desc limit 25) d;

  select to_jsonb(r0) into last_run from (select cr.ran_at, cr.target_week, cr.open_before, cr.picked, cr.outcome from public.content_plan_runs cr where cr.account = p_account order by cr.ran_at desc limit 1) r0;

  -- Warnings only. Each names a real gap and stays silent otherwise.
  if target_week is not null and last_run is not null and coalesce((last_run->>'picked')::int,0) < coalesce((last_run->>'open_before')::int,0)
     and (last_run->>'target_week')::date = target_week and coalesce(last_run->'outcome'->>'reason','') = 'no_candidates' then
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','empty_topic_area','text','Not enough open ideas to fill the week of ' || to_char(target_week,'FMDD Mon')));
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
        warnings := warnings || jsonb_build_array(jsonb_build_object('code','empty_topic_area','text','No open ideas for ' || replace(r.pillar,'_',' ') || ' (' || r.n || ' posted in 8 weeks)'));
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
      'text', case when p_account = 'ivan' then 'No fresh proof: no open idea from a call or your own work in 3 weeks' else 'No fresh proof: no idea from a client call in 3 weeks' end));
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
        warnings := warnings || jsonb_build_array(jsonb_build_object('code','lm_due','text','Lead magnet due: none in the week of ' || to_char((weeks->i->>'start')::date,'FMDD Mon')));
      end if;
    end loop;
  end if;
  founder_n := coalesce((weeks->1->>'founder')::int,0);
  if founder_n > cfg.founder_story_max then
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','founder_cap','text', founder_n || ' founder stories next week, the cap is ' || cfg.founder_story_max));
  end if;

  return jsonb_build_object('ok', true, 'account', p_account, 'today', v_today, 'target', target,
    'target_week', target_week, 'open', open_target,
    'state', case when target_week is null then 'two_weeks_planned' else 'planning' end,
    'proposals_only', cfg.proposals_only, 'auto_generate', cfg.auto_generate, 'founder_story_max', cfg.founder_story_max,
    'cadence_source', cfg.cadence_source, 'lm_per_week', lm_target,
    'weeks', weeks, 'done', done, 'supply', supply, 'warnings', warnings, 'last_run', last_run);
end $function$
;

update public.content_plan_config set auto_generate = false, proposals_only = true, updated_at = now() where account in ('risedtc','arch');
drop function if exists public.content_plan_trait_words(text[]);
