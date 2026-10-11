-- 252 Content plan: planning horizon + Plan view read model (thread A, 2026-10-11).
-- Ivan ruling 11 Oct: always keep the next full week planned for each account; if next week is full,
-- plan the week after (2 weeks ahead). Viral or timely topics are never pre-planned (they go through the
-- newsjack swap into the current week). Client planning cards are proposals until Ivan uses the existing
-- approval path. Nothing here dates, moves or publishes a post, and nothing sends a message.
-- Weeks are Monday to Sunday on the Warsaw clock (the inbox calendar's clock).

create table if not exists public.content_plan_config (
  account text primary key check (account in ('ivan','risedtc','arch')),
  posts_per_week int check (posts_per_week is null or posts_per_week between 1 and 14),
  cadence_source text not null,
  founder_story_max int not null default 2,
  lm_per_week int,
  auto_generate boolean not null default false,
  proposals_only boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.content_plan_config enable row level security;
revoke all on public.content_plan_config from anon, authenticated;

insert into public.content_plan_config(account, posts_per_week, cadence_source, founder_story_max, lm_per_week, auto_generate, proposals_only) values
 ('ivan', null, 'your format policy, at most 4 a week', 2, null, true, false),
 ('risedtc', 5, '5 content posts a week, as agreed for RISE; lead magnets are off', 2, 0, false, true),
 ('arch', 3, 'the rhythm on Davorin''s board; he mentioned 5 in August but it never ran', 2, 0, false, true)
on conflict (account) do nothing;

create table if not exists public.content_plan_slots (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account in ('ivan','risedtc','arch')),
  week_start date not null check (extract(isodow from week_start) = 1),
  kind text not null check (kind in ('idea','review_draft')),
  idea_source text not null check (idea_source in ('lm_idea_candidates','client_ideas','carousel_drafts')),
  idea_ref text not null,
  topic text not null,
  why_now text not null,
  evidence jsonb not null default '[]'::jsonb,
  format text,
  picture text,
  status text not null check (status in ('planned','proposal','requested','dropped','superseded')),
  status_note text,
  plan_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists content_plan_slots_active_ref on public.content_plan_slots(account, idea_source, idea_ref) where status in ('planned','proposal','requested');
create index if not exists content_plan_slots_week on public.content_plan_slots(account, week_start);
alter table public.content_plan_slots enable row level security;
revoke all on public.content_plan_slots from anon, authenticated;

create table if not exists public.content_plan_runs (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account in ('ivan','risedtc','arch')),
  ran_at timestamptz not null default now(),
  target_week date,
  open_before int,
  picked int not null default 0,
  outcome jsonb not null default '{}'::jsonb
);
create index if not exists content_plan_runs_recent on public.content_plan_runs(account, ran_at desc);
alter table public.content_plan_runs enable row level security;
revoke all on public.content_plan_runs from anon, authenticated;

-- Who may write: the service role or a direct database session (n8n Postgres, SQL owner). Never a browser.
create or replace function public.content_plan_service_ok() returns boolean
language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce(auth.role(),'') = 'service_role' or coalesce(current_setting('request.jwt.claims', true), '') = '';
$$;
revoke all on function public.content_plan_service_ok() from public, anon, authenticated;

-- Evidence and a one-line reason for a post that already holds a slot, from what the row itself records.
create or replace function public.content_plan_post_evidence(p_draft uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
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
end $$;
revoke all on function public.content_plan_post_evidence(uuid) from public, anon, authenticated;

-- Evidence for an idea, computed from the idea row itself (never from model text).
create or replace function public.content_plan_idea_evidence(p_source text, p_ref text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
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
end $$;
revoke all on function public.content_plan_idea_evidence(text, text) from public, anon, authenticated;

-- The read model: weeks, slots, done topics, review supply, warnings. Used by the inbox Plan view and the planner.
create or replace function public.content_plan_week(p_account text, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer
set search_path to 'public','pg_temp' set statement_timeout to '15s' as $$
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
end $$;
revoke all on function public.content_plan_week(text, timestamptz) from public, anon;
grant execute on function public.content_plan_week(text, timestamptz) to authenticated, service_role;

-- The planner's write: one slot per pick, only into the current target week, never over its open count.
create or replace function public.content_plan_apply(p_account text, p_week date, p_picks jsonb, p_run jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'public','pg_temp' set statement_timeout to '20s' as $$
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
end $$;
revoke all on function public.content_plan_apply(text, date, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.content_plan_apply(text, date, jsonb, jsonb) to service_role;

-- Log a run that wrote nothing (model refused, planner error, both weeks planned) so the Plan view can say when it last looked.
create or replace function public.content_plan_log_run(p_account text, p_outcome jsonb)
returns uuid language plpgsql volatile security definer set search_path to 'public','pg_temp' as $$
declare v_id uuid; st jsonb;
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  st := public.content_plan_week(p_account);
  insert into public.content_plan_runs(account, target_week, open_before, picked, outcome)
  values (p_account, (st->>'target_week')::date, coalesce((st->>'open')::int,0), 0, coalesce(p_outcome,'{}'::jsonb)) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.content_plan_log_run(text, jsonb) from public, anon, authenticated;
grant execute on function public.content_plan_log_run(text, jsonb) to service_role;

-- Mark a planned Ivan slot once its draft was requested through the normal idea-approve path.
create or replace function public.content_plan_mark(p_slot uuid, p_status text, p_note text default null)
returns boolean language plpgsql volatile security definer set search_path to 'public','pg_temp' as $$
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  if p_status not in ('requested','dropped','superseded') then raise exception 'bad status'; end if;
  update public.content_plan_slots set status = p_status, status_note = p_note, updated_at = now() where id = p_slot;
  return found;
end $$;
revoke all on function public.content_plan_mark(uuid, text, text) from public, anon, authenticated;
grant execute on function public.content_plan_mark(uuid, text, text) to service_role;

-- One line per account for the Monday card.
create or replace function public.content_plan_monday_lines(p_now timestamptz default now())
returns text language plpgsql stable security definer set search_path to 'public','pg_temp' set statement_timeout to '12s' as $$
declare a text; st jsonb; line text; out text := ''; w jsonb;
begin
  foreach a in array array['ivan','risedtc','arch'] loop
    begin
      st := public.content_plan_week(a, p_now);
      line := case a when 'ivan' then 'Ivan' when 'risedtc' then 'Rise' else 'Arch' end || ': ';
      if st->>'state' = 'two_weeks_planned' then
        line := line || 'next 2 weeks planned';
      else
        select x into w from jsonb_array_elements(st->'weeks') x where x->>'start' = st->>'target_week';
        line := line || 'week of ' || to_char((st->>'target_week')::date,'FMDD Mon') || ' ' || (w->>'filled') || ' of ' || (w->>'target') || ' planned'
          || case when (st->>'proposals_only')::boolean and jsonb_array_length(w->'planned') > 0 then ', ' || jsonb_array_length(w->'planned') || ' as proposals' else '' end;
      end if;
      if jsonb_array_length(st->'warnings') > 0 then
        line := line || '. ' || (select string_agg(x->>'text', '; ') from jsonb_array_elements(st->'warnings') x);
      end if;
    exception when others then line := case a when 'ivan' then 'Ivan' when 'risedtc' then 'Rise' else 'Arch' end || ': plan could not be read';
    end;
    out := out || case when out = '' then '' else E'\n' end || line;
  end loop;
  return out;
end $$;
revoke all on function public.content_plan_monday_lines(timestamptz) from public, anon, authenticated;
