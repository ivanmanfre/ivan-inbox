-- 20261114g: own-history forecast (cb60).
-- Predicts a draft's 7-14 day impressions ratio to the account's own trailing median from that
-- account's OWN published posts, by source kind x audience lane (a reasoned proxy-judge label),
-- shrunk toward the account mean for small n. Recorded for every new draft/idea by the labeller
-- workflow, graded weekly beside the niche score (same run_key as cb15_forecast_grader).
-- Ranking: unchanged. The niche score only orders IDEAS (RISE/ARCH kickoff, app idea lists); on the
-- availability-gated backtest the own forecast did not beat the niche idea score (content_own_backtests),
-- so nothing is re-ranked. Both are recorded and graded weekly from now on.
-- Additive: no existing table, view or function is changed. Rollback: 20261114g_own_history_forecast_rollback.sql

begin;

-- 1. labels (own published posts = training; drafts and ideas = forecast subjects)
create table public.content_own_labels (
  label_id bigserial primary key,
  client_id text not null check (client_id in ('ivan','risedtc','arch')),
  subject_table text not null check (subject_table in ('own_post','carousel_drafts','client_ideas')),
  subject_ref text not null,
  source_kind text not null check (source_kind in ('viral_copy','own_winner','call_material','news_research','lead_magnet','hand','planner_other')),
  audience_lane text not null check (audience_lane in ('poland_life','business')),
  hook_shape text check (hook_shape in ('story','number_claim','bold_claim','question','list_promise','announcement')),
  confidence text check (confidence in ('high','low')),
  why text,
  labeller_version text not null,
  labelled_at timestamptz not null default now(),
  unique (subject_table, subject_ref, labeller_version)
);
create index content_own_labels_subject_idx on public.content_own_labels (subject_table, subject_ref, labelled_at desc);

-- 2. outcomes: the grader's own rule (7-14d reading closest to 7, median of other own posts in the
--    prior 90 days with a 7-14d reading, boosted excluded), one row per own post, refreshed weekly
create table public.content_own_outcomes (
  client_id text not null,
  digits text not null,
  published_at timestamptz not null,
  reading numeric,
  reading_age_days numeric,
  reading_captured_at timestamptz,
  available_at timestamptz,          -- when the reading AND every baseline reading behind its median existed
  own_median numeric,
  own_n integer not null default 0,
  boosted boolean not null default false,
  ratio numeric,
  log_ratio numeric,
  refreshed_at timestamptz not null default now(),
  primary key (client_id, digits)
);

-- 3. forecasts (append-only)
create table public.content_own_forecasts (
  forecast_id uuid primary key default gen_random_uuid(),
  client_id text not null,
  subject_table text not null check (subject_table in ('carousel_drafts','client_ideas')),
  subject_ref text not null,
  label_id bigint references public.content_own_labels(label_id),
  source_kind text,
  audience_lane text,
  model_version text not null,
  predicted_log_ratio numeric,
  predicted_ratio numeric,
  cell_n integer, kind_n integer, lane_n integer, train_n integer,
  status text not null check (status in ('ok','thin_history')),
  origin text not null check (origin in ('live','backtest')),
  as_of timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index content_own_forecasts_subject_idx on public.content_own_forecasts (subject_table, subject_ref, recorded_at desc);

-- 4. grades, one per graded draft, beside the niche grade row
create table public.content_own_forecast_grades (
  own_grade_id bigserial primary key,
  run_key text not null,
  grade_id uuid not null unique references public.outlier_forecast_grades(grade_id),
  client_id text not null,
  draft_id text not null,
  forecast_id uuid references public.content_own_forecasts(forecast_id),
  predicted_ratio numeric,
  own_top_half boolean,
  cohort_n integer,
  realised_ratio numeric,
  outperformed boolean,
  niche_top_half boolean,
  niche_idea_score numeric,
  niche_draft_score numeric,
  origin text not null check (origin in ('live','backtest')),
  excluded_reason text,
  graded_at timestamptz not null default now()
);

-- 5. the backtest record behind the ranking decision
create table public.content_own_backtests (
  backtest_id bigserial primary key,
  client_id text not null,
  model_version text not null,
  same_posts_n integer, own_auc_same numeric, niche_auc_same numeric,
  all_posts_n integer, own_auc_all numeric,
  own_beats_niche boolean not null,
  rule text not null,
  detail jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null default now()
);

alter table public.content_own_labels enable row level security;
alter table public.content_own_outcomes enable row level security;
alter table public.content_own_forecasts enable row level security;
alter table public.content_own_forecast_grades enable row level security;
alter table public.content_own_backtests enable row level security;
revoke all on public.content_own_labels, public.content_own_outcomes, public.content_own_forecasts,
  public.content_own_forecast_grades, public.content_own_backtests from anon, authenticated;

-- refresh outcomes (same rule as outlier_grade_candidates)
create or replace function public.content_own_outcomes_refresh(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path to 'public','pg_temp' set statement_timeout to '120s'
as $$
declare v_n integer;
begin
  with elig as (
    select o.client_id, public.outlier_canonical_post_ref(o.publication_id) as digits, o.observed_value as v,
      coalesce(o.window_end, o.captured_at) as cap, greatest(o.captured_at, coalesce(o.window_end, o.captured_at)) as capt, o.window_start as pub,
      extract(epoch from (coalesce(o.window_end, o.captured_at) - o.window_start)) / 86400.0 as age
    from public.editorial_eligible_outcome_snapshots_v o
    where o.metric = 'impressions' and o.artifact_role = 'own_post' and o.observed_value is not null
      and coalesce(o.unknown_reason, '') = '' and o.window_start is not null
      and coalesce(o.window_end, o.captured_at) <= p_now and o.captured_at <= p_now and o.client_id in ('ivan','risedtc','arch')
  ), posts as (
    select client_id, digits, min(pub) as pub from elig where digits ~ '^[0-9]{16,20}$' group by 1, 2
  ), rd as (
    select p.client_id, p.digits, p.pub, x.v, x.age, x.capt as cap from posts p
    left join lateral (
      select y.v, y.age, y.capt from (
        select e.v, e.age, e.cap, e.capt, 'editorial_eligible_outcome_snapshots_v'::text as src
        from elig e where e.client_id = p.client_id and e.digits = p.digits
        union all
        select a.impressions::numeric, extract(epoch from (a.captured_at - p.pub)) / 86400.0, a.captured_at, a.captured_at, 'audn_post_metric_snapshots'
        from public.audn_post_metric_snapshots a
        where a.client_id = p.client_id and a.impressions is not null and a.captured_at <= p_now
          and public.outlier_canonical_post_ref(a.post_social_id) = p.digits) y
      where y.age >= 7 and y.age <= 14 order by abs(y.age - 7), y.cap, y.src limit 1) x on true
  ), full_rows as (
    select r.client_id, r.digits, r.pub, r.v, r.age, r.cap, b.bcap, b.med, coalesce(b.n, 0) as n,
      exists (select 1 from public.own_post_boost_current_v bb where bb.client_id = r.client_id
              and bb.post_ref = r.digits and bb.boosted) as boosted
    from rd r left join lateral (
      select (percentile_cont(0.5) within group (order by q.v))::numeric as med, count(*) as n, max(q.capt) as bcap from (
        select distinct on (e.digits) e.digits, e.v, e.cap, e.capt from elig e
        where e.client_id = r.client_id and e.digits <> r.digits
          and e.pub >= r.pub - interval '90 days' and e.pub < r.pub and e.age >= 7 and e.age <= 14
          and not exists (select 1 from public.own_post_boost_current_v b where b.client_id = e.client_id
                          and b.post_ref = e.digits and b.boosted)
        order by e.digits, abs(e.age - 7), e.cap) q) b on true
  )
  insert into public.content_own_outcomes as t (client_id, digits, published_at, reading, reading_age_days,
    reading_captured_at, available_at, own_median, own_n, boosted, ratio, log_ratio, refreshed_at)
  select client_id, digits, pub, v, round(age::numeric, 3), cap, case when v is not null then greatest(cap, bcap) end,
    med, n, boosted,
    case when v is not null then round(v / greatest(coalesce(med, 0), 1), 6) end,
    case when v is not null then ln(greatest(v / greatest(coalesce(med, 0), 1), 0.02)) end, now()
  from full_rows
  on conflict (client_id, digits) do update set published_at = excluded.published_at, reading = excluded.reading,
    reading_age_days = excluded.reading_age_days, reading_captured_at = excluded.reading_captured_at,
    available_at = excluded.available_at, own_median = excluded.own_median, own_n = excluded.own_n,
    boosted = excluded.boosted, ratio = excluded.ratio, log_ratio = excluded.log_ratio, refreshed_at = excluded.refreshed_at;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- the model: kind x lane cell, backing off to the mean of the kind and lane estimates, which back off
-- to the account mean; every level shrunk n/(n+k0). Trains only on own posts whose reading AND every
-- baseline reading behind their median existed at p_at (available_at <= p_at). <5 = thin_history.
create or replace function public.content_own_predict(p_client text, p_kind text, p_lane text, p_at timestamptz,
  p_k0 numeric default 3)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp'
as $$
  with tr as (
    select o.log_ratio as y, l.source_kind as k, l.audience_lane as a
    from public.content_own_outcomes o
    join lateral (select l.source_kind, l.audience_lane from public.content_own_labels l
                  where l.subject_table = 'own_post' and l.client_id = o.client_id and l.subject_ref = o.digits
                  order by l.labelled_at desc, l.label_id desc limit 1) l on true
    where o.client_id = p_client and o.reading is not null and not o.boosted and o.own_n >= 5
      and o.available_at <= p_at
  ), s as (
    select count(*) as n, avg(y) as mu,
      count(*) filter (where k = p_kind) as nk, avg(y) filter (where k = p_kind) as mk,
      count(*) filter (where a = p_lane) as nl, avg(y) filter (where a = p_lane) as ml,
      count(*) filter (where k = p_kind and a = p_lane) as nc, avg(y) filter (where k = p_kind and a = p_lane) as mc
    from tr
  ), lv as (
    select s.*, s.mu + s.nk / (s.nk + p_k0) * (coalesce(s.mk, s.mu) - s.mu) as pk,
      s.mu + s.nl / (s.nl + p_k0) * (coalesce(s.ml, s.mu) - s.mu) as pl from s
  ), pc as (
    select lv.*, (lv.pk + lv.pl) / 2 as prior from lv
  )
  select jsonb_build_object('model_version', 'own-cell-v1:k' || p_k0::text, 'train_n', n, 'kind_n', nk, 'lane_n', nl, 'cell_n', nc,
    'status', case when n < 5 then 'thin_history' else 'ok' end,
    'predicted_log_ratio', case when n >= 5 then prior + nc / (nc + p_k0) * (coalesce(mc, prior) - prior) end,
    'predicted_ratio', case when n >= 5 then round(exp(prior + nc / (nc + p_k0) * (coalesce(mc, prior) - prior)), 4) end)
  from pc
$$;

-- record a forecast for a labelled draft or idea (dedupes an identical repeat)
create or replace function public.content_own_forecast_record(p_subject_table text, p_subject_ref text,
  p_origin text default 'live', p_as_of timestamptz default now())
returns uuid language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare l record; f jsonb; v_prev record; v_id uuid;
begin
  select * into l from public.content_own_labels where subject_table = p_subject_table and subject_ref = p_subject_ref
   order by labelled_at desc, label_id desc limit 1;
  if not found then return null; end if;
  f := public.content_own_predict(l.client_id, l.source_kind, l.audience_lane, p_as_of);
  select forecast_id, label_id, model_version, train_n, predicted_log_ratio into v_prev from public.content_own_forecasts
   where subject_table = p_subject_table and subject_ref = p_subject_ref and origin = p_origin
   order by recorded_at desc limit 1;
  if found and v_prev.label_id = l.label_id and v_prev.model_version = f ->> 'model_version'
     and v_prev.train_n = (f ->> 'train_n')::int
     and round(v_prev.predicted_log_ratio, 6) is not distinct from round((f ->> 'predicted_log_ratio')::numeric, 6) then
    return v_prev.forecast_id;
  end if;
  insert into public.content_own_forecasts (client_id, subject_table, subject_ref, label_id, source_kind, audience_lane,
    model_version, predicted_log_ratio, predicted_ratio, cell_n, kind_n, lane_n, train_n, status, origin, as_of)
  values (l.client_id, p_subject_table, p_subject_ref, l.label_id, l.source_kind, l.audience_lane, f ->> 'model_version',
    (f ->> 'predicted_log_ratio')::numeric, (f ->> 'predicted_ratio')::numeric, (f ->> 'cell_n')::int,
    (f ->> 'kind_n')::int, (f ->> 'lane_n')::int, (f ->> 'train_n')::int, f ->> 'status', p_origin, p_as_of)
  returning forecast_id into v_id;
  return v_id;
end $$;

-- weekly grade beside the niche grade (cron cb60_own_forecast_grader, 15 min after cb15_forecast_grader)
create or replace function public.content_own_forecast_grade(p_run_key text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_ins integer := 0; v_feed integer := 0; r record; v_key text; v_refresh integer;
begin
  if p_run_key is null or btrim(p_run_key) = '' then raise exception 'content_own_forecast_grade: p_run_key required'; end if;
  if not pg_try_advisory_xact_lock(hashtext('cb60_own_forecast_grade')) then
    return jsonb_build_object('run_key', p_run_key, 'skipped', 'another_grader_running'); end if;
  v_refresh := public.content_own_outcomes_refresh(now());
  insert into public.content_own_forecast_grades (run_key, grade_id, client_id, draft_id, forecast_id, predicted_ratio,
    realised_ratio, outperformed, niche_top_half, niche_idea_score, niche_draft_score, origin, excluded_reason)
  select p_run_key, g.grade_id, g.client_id, g.draft_id, f.forecast_id, f.predicted_ratio, g.realised_ratio,
    g.outperformed, g.industry_top_half, g.industry_idea_score, g.industry_draft_score, 'live',
    case when f.forecast_id is null then 'no_own_forecast_before_publish' when f.predicted_ratio is null then 'thin_history' end
  from public.outlier_forecast_grades g
  left join lateral (select x.forecast_id, x.predicted_ratio from public.content_own_forecasts x
                     where x.subject_table = 'carousel_drafts' and x.subject_ref = g.draft_id and x.origin = 'live'
                       and x.recorded_at <= g.published_at
                     order by x.recorded_at desc limit 1) f on true
  where g.run_key = p_run_key and g.excluded_reason is null
  on conflict (grade_id) do nothing;
  get diagnostics v_ins = row_count;
  -- top half within each account's graded cohort (backtest + live rows that carry a prediction)
  update public.content_own_forecast_grades t set own_top_half = t.predicted_ratio >= m.med, cohort_n = m.n
  from (select client_id, percentile_cont(0.5) within group (order by predicted_ratio) as med, count(*) as n
        from public.content_own_forecast_grades where predicted_ratio is not null group by client_id) m
  where m.client_id = t.client_id and t.run_key = p_run_key and t.predicted_ratio is not null;
  for r in
    select c.client_id,
      -- both halves counted over the SAME rows: graded posts that carry both an own and a niche half
      count(*) filter (where g.own_top_half and g.outperformed and g.niche_top_half is not null) as oth,
      count(*) filter (where g.own_top_half and g.niche_top_half is not null) as otn,
      count(*) filter (where g.own_top_half = false and g.outperformed and g.niche_top_half is not null) as obh,
      count(*) filter (where g.own_top_half = false and g.niche_top_half is not null) as obn,
      count(*) filter (where g.niche_top_half and g.outperformed and g.own_top_half is not null) as nth,
      count(*) filter (where g.niche_top_half and g.own_top_half is not null) as ntn,
      count(*) filter (where g.niche_top_half = false and g.outperformed and g.own_top_half is not null) as nbh,
      count(*) filter (where g.niche_top_half = false and g.own_top_half is not null) as nbn,
      count(*) filter (where g.run_key = p_run_key) as new_n
      , count(*) filter (where g.own_top_half is null or g.niche_top_half is null) as unmatched
    from (values ('ivan'), ('risedtc'), ('arch')) c(client_id)
    left join public.content_own_forecast_grades g on g.client_id = c.client_id
    group by c.client_id
  loop
    continue when r.new_n = 0;
    v_key := 'cb60-own-forecast-grader:' || r.client_id || ':' || p_run_key;
    if not exists (select 1 from public.inbox_notifications n where n.dedupe_key = v_key) then
      insert into public.inbox_notifications (family, source, dedupe_key, severity, title, body, url, tenant, media)
      values ('reporting_digest', 'cb60-own-forecast-grader', v_key, 'info',
        'Own-history forecast: ' || case r.client_id when 'risedtc' then 'RISE' when 'arch' then 'ARCH' else 'Ivan' end
          || ' - ' || r.new_n || ' new',
        'Own-history top half beat the own median ' || r.oth || '/' || r.otn || ', bottom half ' || r.obh || '/' || r.obn
          || '. Niche score on the same posts: top ' || r.nth || '/' || r.ntn || ', bottom ' || r.nbh || '/' || r.nbn
          || ' (same ' || (r.otn + r.obn) || ' posts; ' || r.unmatched || ' graded post(s) lack one of the two and are left out). Includes the 2026-11-14 backtest rows.',
        './#exp/brain-b/today', case r.client_id when 'risedtc' then 'rise' else r.client_id end,
        jsonb_build_object('run_key', p_run_key));
      v_feed := v_feed + 1;
    end if;
  end loop;
  return jsonb_build_object('run_key', p_run_key, 'outcomes_refreshed', v_refresh, 'graded_rows_inserted', v_ins, 'feed_lines', v_feed);
end $$;

-- labeller queue: drafts and ideas first (they get forecasts), then newly measured own posts (training)
create or replace function public.content_own_label_queue(p_limit integer default 40, p_labeller text default 'own-kind-v1')
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' set statement_timeout to '30s'
as $$
  with d as (
    select 1 as pri, d.created_at as at, jsonb_build_object('key', 'carousel_drafts:' || d.id, 'client', coalesce(d.client_id, 'ivan'),
      'kind_of_item', 'draft', 'source_ref', d.source_ref, 'source_label', d.source_label,
      'source_detail_kind', d.source_detail ->> 'kind', 'source_detail', left(coalesce(d.source_detail::text, ''), 300),
      'taxonomy_source', d.taxonomy ->> 'source', 'taxonomy_source_ref', d.taxonomy ->> 'source_ref',
      'brief_source_kind', d.taxonomy -> 'brain_brief' ->> 'source_kind', 'source_post_id', d.source_post_id,
      'funnel_source', d.funnel_source, 'title', d.title,
      'text', left(d.post_body, 700)) as item
    from public.carousel_drafts d
    where coalesce(d.client_id, 'ivan') in ('ivan','risedtc','arch') and d.created_at > now() - interval '45 days'
      and d.status in ('review','approved','scheduled') and coalesce(btrim(d.post_body), '') <> ''
      and not exists (select 1 from public.content_own_labels l where l.subject_table = 'carousel_drafts'
                      and l.subject_ref = d.id::text and l.labeller_version = p_labeller)
  ), i as (
    select 2, c.created_at, jsonb_build_object('key', 'client_ideas:' || c.id, 'client', c.client_id, 'kind_of_item', 'idea',
      'source_ref', c.source_ref, 'source_label', c.source_label, 'lane', c.lane, 'title', coalesce(c.title, c.hook),
      'text', left(concat_ws(E'\n', c.hook, c.idea::text), 700))
    from public.client_ideas c
    where c.client_id in ('risedtc','arch') and c.status in ('staged','approved') and c.created_at > now() - interval '60 days'
      and not exists (select 1 from public.content_own_labels l where l.subject_table = 'client_ideas'
                      and l.subject_ref = c.id::text and l.labeller_version = p_labeller)
  ), o as (
    select 3, o.published_at, jsonb_build_object('key', 'own_post:' || o.client_id || ':' || o.digits, 'client', o.client_id,
      'kind_of_item', 'published post', 'published', to_char(o.published_at, 'YYYY-MM-DD'),
      'source_ref', d.source_ref, 'source_label', d.source_label, 'source_detail_kind', d.source_detail ->> 'kind',
      'taxonomy_source', d.taxonomy ->> 'source', 'taxonomy_source_ref', d.taxonomy ->> 'source_ref',
      'brief_source_kind', d.taxonomy -> 'brain_brief' ->> 'source_kind', 'source_post_id', d.source_post_id,
      'title', d.title, 'text', left(coalesce(d.post_body, m.t), 700))
    from public.content_own_outcomes o
    left join lateral (select v.draft_id from public.editorial_publication_link_resolved_v v
                       where v.client_id = o.client_id and v.is_latest_for_draft and v.resolution_status = 'resolved'
                         and v.draft_table = 'carousel_drafts'
                         and public.outlier_canonical_post_ref(coalesce(v.platform_social_digits, v.platform_share_digits, v.activity_digits)) = o.digits
                       limit 1) lk on true
    left join public.carousel_drafts d on d.id::text = lk.draft_id
    left join lateral (select m.meta ->> 'text' as t from public.client_post_metrics m
                       where m.client_id = o.client_id and public.outlier_canonical_post_ref(coalesce(m.social_id, m.post_url)) = o.digits
                       limit 1) m on true
    where o.reading is not null
      and not exists (select 1 from public.content_own_labels l where l.subject_table = 'own_post'
                      and l.subject_ref = o.digits and l.labeller_version = p_labeller)
  )
  select coalesce(jsonb_agg(item order by pri, at desc), '[]'::jsonb)
  from (select * from d union all select * from i union all select * from o order by 1, 2 desc limit greatest(least(p_limit, 100), 1)) q(pri, at, item)
$$;

-- labeller write: validated rows only; drafts and ideas get a forecast right away
create or replace function public.content_own_label_write(p_rows jsonb, p_labeller text default 'own-kind-v1')
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare e jsonb; v_tab text; v_ref text; v_client text; v_key text; n_lab integer := 0; n_fc integer := 0; n_bad integer := 0; v_rc integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be an array'; end if;
  for e in select * from jsonb_array_elements(p_rows) loop
    v_key := e ->> 'key';
    v_tab := split_part(v_key, ':', 1);
    if v_tab = 'own_post' then
      v_client := split_part(v_key, ':', 2); v_ref := split_part(v_key, ':', 3);
      if not exists (select 1 from public.content_own_outcomes o where o.client_id = v_client and o.digits = v_ref) then
        n_bad := n_bad + 1; continue; end if;
    elsif v_tab = 'carousel_drafts' then
      v_ref := split_part(v_key, ':', 2);
      select coalesce(d.client_id, 'ivan') into v_client from public.carousel_drafts d where d.id::text = v_ref;
    elsif v_tab = 'client_ideas' then
      v_ref := split_part(v_key, ':', 2);
      select c.client_id into v_client from public.client_ideas c where c.id::text = v_ref;
    else
      n_bad := n_bad + 1; continue;
    end if;
    if v_client is null or v_client not in ('ivan','risedtc','arch')
       or coalesce(e ->> 'source_kind', '') not in ('viral_copy','own_winner','call_material','news_research','lead_magnet','hand','planner_other')
       or coalesce(e ->> 'audience_lane', '') not in ('poland_life','business') then
      n_bad := n_bad + 1; continue;
    end if;
    insert into public.content_own_labels (client_id, subject_table, subject_ref, source_kind, audience_lane, hook_shape,
      confidence, why, labeller_version)
    values (v_client, v_tab, v_ref, e ->> 'source_kind', e ->> 'audience_lane',
      case when e ->> 'hook_shape' in ('story','number_claim','bold_claim','question','list_promise','announcement') then e ->> 'hook_shape' end,
      case when e ->> 'confidence' in ('high','low') then e ->> 'confidence' end, left(e ->> 'why', 300), p_labeller)
    on conflict (subject_table, subject_ref, labeller_version) do nothing;
    get diagnostics v_rc = row_count; n_lab := n_lab + v_rc;
    if v_rc > 0 and v_tab in ('carousel_drafts','client_ideas') then
      perform public.content_own_forecast_record(v_tab, v_ref, 'live', now()); n_fc := n_fc + 1;
    end if;
  end loop;
  return jsonb_build_object('labelled', n_lab, 'forecast', n_fc, 'rejected', n_bad);
end $$;

-- backtest backfill for the graded drafts: label = the published post's own label, prediction made
-- as of the publish time from posts measured before it (origin backtest, run_key backtest-20261114)
create or replace function public.content_own_backtest_backfill()
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare g record; l record; f jsonb; v_id uuid; n integer := 0;
begin
  for g in select * from public.outlier_forecast_grades x where x.excluded_reason is null
             and not exists (select 1 from public.content_own_forecast_grades y where y.grade_id = x.grade_id) loop
    select * into l from public.content_own_labels where subject_table = 'own_post' and client_id = g.client_id
       and subject_ref = g.activity_digits order by labelled_at desc, label_id desc limit 1;
    v_id := null;
    if found then
      -- as of the niche forecast's own recorded time: the same information time as the niche score
      f := public.content_own_predict(g.client_id, l.source_kind, l.audience_lane, g.forecast_recorded_at);
      insert into public.content_own_forecasts (client_id, subject_table, subject_ref, label_id, source_kind, audience_lane,
        model_version, predicted_log_ratio, predicted_ratio, cell_n, kind_n, lane_n, train_n, status, origin, as_of)
      values (g.client_id, 'carousel_drafts', g.draft_id, l.label_id, l.source_kind, l.audience_lane, f ->> 'model_version',
        (f ->> 'predicted_log_ratio')::numeric, (f ->> 'predicted_ratio')::numeric, (f ->> 'cell_n')::int,
        (f ->> 'kind_n')::int, (f ->> 'lane_n')::int, (f ->> 'train_n')::int, f ->> 'status', 'backtest', g.forecast_recorded_at)
      returning forecast_id into v_id;
    end if;
    insert into public.content_own_forecast_grades (run_key, grade_id, client_id, draft_id, forecast_id, predicted_ratio,
      realised_ratio, outperformed, niche_top_half, niche_idea_score, niche_draft_score, origin, excluded_reason)
    values ('backtest-20261114', g.grade_id, g.client_id, g.draft_id, v_id,
      (select predicted_ratio from public.content_own_forecasts where forecast_id = v_id),
      g.realised_ratio, g.outperformed, g.industry_top_half, g.industry_idea_score, g.industry_draft_score, 'backtest',
      case when v_id is null then 'no_label' end);
    n := n + 1;
  end loop;
  update public.content_own_forecast_grades t set own_top_half = t.predicted_ratio >= m.med, cohort_n = m.n
  from (select client_id, percentile_cont(0.5) within group (order by predicted_ratio) as med, count(*) as n
        from public.content_own_forecast_grades where predicted_ratio is not null group by client_id) m
  where m.client_id = t.client_id and t.predicted_ratio is not null;
  return jsonb_build_object('backfilled', n);
end $$;

-- side-by-side read for reports
create or replace view public.content_forecast_compare_v with (security_invoker = on) as
  select g.run_key, g.client_id, g.draft_id, g.origin, g.predicted_ratio as own_predicted_ratio, g.own_top_half,
    g.niche_top_half, g.niche_idea_score, g.niche_draft_score, g.realised_ratio, g.outperformed, g.excluded_reason, g.graded_at
  from public.content_own_forecast_grades g;
revoke all on public.content_forecast_compare_v from anon, authenticated;

revoke all on function public.content_own_outcomes_refresh(timestamptz), public.content_own_predict(text, text, text, timestamptz, numeric),
  public.content_own_forecast_record(text, text, text, timestamptz), public.content_own_forecast_grade(text),
  public.content_own_label_queue(integer, text), public.content_own_label_write(jsonb, text),
  public.content_own_backtest_backfill() from public, anon, authenticated;
grant execute on function public.content_own_label_queue(integer, text), public.content_own_label_write(jsonb, text) to service_role;

commit;
