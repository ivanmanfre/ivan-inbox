-- Self-updating content brain, 1-day cut (11 Oct 2026). Design: research/self-updating-brain-2026-10-11/DESIGN.md
-- Registry (brain_rules), append-only history (brain_rule_events, brain_rule_tests), fixed-age reading (post_day7),
-- the corpus frame the monthly re-test reads (brain_corpus_frame), mechanical consumers (format-mix-policy-2026
-- variables, brain_lint_codes), apply / rollback / undo, the Monday line, and the pg_cron schedule.
-- Rollback file: same name with _rollback.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

-- 1. Registry --------------------------------------------------------------------------------------------------
create table if not exists public.brain_rules (
  rule_id           text primary key,
  family            text not null,
  scope             text not null check (scope in ('ivan','risedtc','arch','niche')),
  statement         text not null,
  test_id           text,                      -- '<claim>:<term>' in the frozen brain-retest code; null = no code test
  claimed_sign      smallint check (claimed_sign in (-1, 0, 1)),
  effect_pct        numeric, ci_lo_pct numeric, ci_hi_pct numeric, q numeric,
  posts             integer, creators integer,
  status            text not null check (status in ('candidate','shadow','live','watch','retired')),
  tier              text,
  consumer_type     text check (consumer_type in ('scheduler_var','lint_check','prompt_line','picker_weight','client_note','audit_section','workflow_gate')),
  consumer_ref      jsonb,
  protocol_sha      text,
  discovery_cutoff  timestamptz,
  last_tested       timestamptz,
  next_due          date,
  veto              boolean not null default false,
  override          text check (override in ('live','retired')),
  override_note     text,
  evidence          text,
  notes             text,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.brain_rule_events (
  id                bigserial primary key,
  rule_id           text not null references public.brain_rules(rule_id),
  kind              text not null check (kind in ('seed','transition','apply','rollback','veto','override','kit_staged','test_note')),
  from_status       text,
  to_status         text,
  consumer_type     text,
  consumer_ref      jsonb,
  before_value      jsonb,
  after_value       jsonb,
  reverts_event_id  bigint references public.brain_rule_events(id),
  undo_token        uuid,
  run_id            text,
  actor             text not null default 'system',
  reason            text,
  created_at        timestamptz not null default now()
);
create index if not exists brain_rule_events_rule_idx on public.brain_rule_events(rule_id, created_at desc);
create unique index if not exists brain_rule_events_undo_idx on public.brain_rule_events(undo_token) where undo_token is not null;
create unique index if not exists brain_rule_events_one_rollback on public.brain_rule_events(reverts_event_id) where kind = 'rollback';

create table if not exists public.brain_rule_tests (
  id                bigserial primary key,
  run_id            text not null,
  run_kind          text not null check (run_kind in ('monthly','dry_run','regression')),
  rule_id           text references public.brain_rules(rule_id),
  test_id           text not null,
  niche             text not null,
  estimate_pct      numeric, lo_pct numeric, hi_pct numeric, p numeric, q numeric,
  later_pct         numeric,
  posts             integer, creators integer, varying_creators integer, exposed integer,
  perm_rate         numeric,
  oos_posts         integer, oos_pct numeric, oos_lo_pct numeric, oos_hi_pct numeric,
  verdict           text,
  detail            jsonb,
  protocol_sha      text,
  created_at        timestamptz not null default now()
);
create index if not exists brain_rule_tests_rule_idx on public.brain_rule_tests(rule_id, created_at desc);

-- Mechanical lint codes the brain owns. The reader in content-lint / the writers is owed (STATUS.md); until then a
-- live lint rule shows as "live on paper only".
create table if not exists public.brain_lint_codes (
  code        text not null,
  scope       text not null check (scope in ('ivan','risedtc','arch')),
  mode        text not null check (mode in ('off','warn','block')),
  params      jsonb not null default '{}'::jsonb,
  rule_id     text references public.brain_rules(rule_id),
  updated_at  timestamptz not null default now(),
  primary key (code, scope)
);

-- Append-only guard.
create or replace function public.brain_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
drop trigger if exists brain_rule_events_append_only on public.brain_rule_events;
create trigger brain_rule_events_append_only before update or delete on public.brain_rule_events
  for each row execute function public.brain_append_only();
drop trigger if exists brain_rule_tests_append_only on public.brain_rule_tests;
create trigger brain_rule_tests_append_only before update or delete on public.brain_rule_tests
  for each row execute function public.brain_append_only();

create or replace function public.brain_rules_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists brain_rules_touch on public.brain_rules;
create trigger brain_rules_touch before update on public.brain_rules for each row execute function public.brain_rules_touch();

-- 2. Fixed-age reading -----------------------------------------------------------------------------------------
create table if not exists public.post_day7 (
  kind              text not null check (kind in ('own','corpus')),
  client_id         text not null,
  post_ref          text not null,
  author_ref        text,
  published_at      timestamptz,
  reading_at        timestamptz,
  age_days          numeric,
  method            text not null check (method in ('nearest','interpolated')),
  impressions       integer,
  reactions         integer,
  likes             numeric,
  comments          numeric,
  shares            numeric,
  reposts           numeric,
  score             numeric,
  published_format  text,
  refreshed_at      timestamptz not null default now(),
  primary key (kind, client_id, post_ref)
);

create or replace view public.post_day7_v with (security_invoker = on) as
  select * from public.post_day7;

create or replace function public.brain_expm1(x numeric) returns numeric language sql immutable as $$ select exp(x) - 1 $$;

create or replace function public.brain_day7_refresh() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
set statement_timeout = '180s' set lock_timeout = '5s' as $$
declare n_own int; n_corpus int;
begin
  create temp table _d7 (like public.post_day7 including defaults) on commit drop;

  -- Own and client posts: Unipile snapshot nearest to day 7, within 1 day. Format from the published attachments.
  insert into _d7 (kind, client_id, post_ref, published_at, reading_at, age_days, method, impressions, reactions, likes, comments, shares, reposts, score, published_format)
  select 'own', x.client_id, x.pid, x.published_at, x.captured_at, round(x.age, 3), 'nearest', x.impressions, x.reactions,
         x.reactions, x.comments, x.shares, x.shares, x.reactions + 3 * coalesce(x.shares, 0), x.fmt
    from (
      select distinct on (m.client_id, regexp_replace(m.social_id, '^.*:', ''))
             m.client_id, regexp_replace(m.social_id, '^.*:', '') pid, m.published_at, s.captured_at,
             extract(epoch from s.captured_at - m.published_at) / 86400.0 age,
             s.impressions, s.reactions, s.comments, s.shares,
             case
               when jsonb_array_length(coalesce(m.meta -> 'attachments', '[]'::jsonb)) = 0 then 'text'
               when exists (select 1 from jsonb_array_elements(m.meta -> 'attachments') e where e ->> 'type' = 'video') then 'video'
               when exists (select 1 from jsonb_array_elements(m.meta -> 'attachments') e where e ->> 'type' = 'file') then 'document'
               when jsonb_array_length(m.meta -> 'attachments') > 1 then 'multi_image'
               when exists (select 1 from jsonb_array_elements(m.meta -> 'attachments') e where e ->> 'type' = 'img') then 'image'
               else 'other' end fmt
        from public.client_post_metrics m
        join public.audn_post_metric_snapshots s
          on s.client_id = m.client_id and regexp_replace(s.post_social_id, '^.*:', '') = regexp_replace(m.social_id, '^.*:', '')
       where m.published_at is not null
         and abs(extract(epoch from s.captured_at - m.published_at) / 86400.0 - 7) <= 1
       order by m.client_id, regexp_replace(m.social_id, '^.*:', ''), abs(extract(epoch from s.captured_at - m.published_at) / 86400.0 - 7), s.captured_at
    ) x;
  get diagnostics n_own = row_count;

  -- Corpus posts: nearest reading within 1.5 days of day 7, else log-linear interpolation between the last reading
  -- before and the first reading after day 7 (bracket no wider than 14 days).
  with p as (
    select client_id, post_ref, author_ref, published_at, post_type
      from public.outlier_corpus_v4_v
     where client_id in ('ivan','risedtc','arch') and published_at is not null
  ), r as (
    select p.client_id, p.post_ref, p.author_ref, p.published_at, p.post_type, o.reading_at,
           o.likes::numeric likes, o.reposts::numeric reposts, o.comments::numeric comments,
           extract(epoch from o.reading_at - p.published_at) / 86400.0 age
      from p join public.outlier_readings_v4_v o on o.client_id = p.client_id and o.post_ref = p.post_ref
     where o.reading_at is not null and o.likes is not null and o.reposts is not null
  ), nearest as (
    select distinct on (client_id, post_ref) * from r where abs(age - 7) <= 1.5
     order by client_id, post_ref, abs(age - 7), reading_at
  ), lo as (
    select distinct on (client_id, post_ref) * from r where age < 7 and age >= 0 order by client_id, post_ref, age desc
  ), hi as (
    select distinct on (client_id, post_ref) * from r where age > 7 order by client_id, post_ref, age
  ), interp as (
    select lo.client_id, lo.post_ref, lo.author_ref, lo.published_at, lo.post_type,
           (7 - lo.age) / (hi.age - lo.age) w, lo.likes l0, hi.likes l1, lo.reposts r0, hi.reposts r1,
           lo.comments c0, hi.comments c1
      from lo join hi using (client_id, post_ref)
     where hi.age - lo.age <= 14
       and not exists (select 1 from nearest n where n.client_id = lo.client_id and n.post_ref = lo.post_ref)
  )
  insert into _d7 (kind, client_id, post_ref, author_ref, published_at, reading_at, age_days, method, likes, comments, reposts, score, published_format)
  select 'corpus', client_id, post_ref, author_ref, published_at, reading_at, round(age, 3), 'nearest', likes, comments, reposts,
         likes + 3 * reposts, post_type
    from nearest
  union all
  select 'corpus', client_id, post_ref, author_ref, published_at, published_at + interval '7 days', 7, 'interpolated',
         round(brain_expm1(ln(1 + l0) + w * (ln(1 + l1) - ln(1 + l0))), 2),
         case when c0 is null or c1 is null then null else round(brain_expm1(ln(1 + c0) + w * (ln(1 + c1) - ln(1 + c0))), 2) end,
         round(brain_expm1(ln(1 + r0) + w * (ln(1 + r1) - ln(1 + r0))), 2),
         round(brain_expm1(ln(1 + l0) + w * (ln(1 + l1) - ln(1 + l0))) + 3 * brain_expm1(ln(1 + r0) + w * (ln(1 + r1) - ln(1 + r0))), 2),
         post_type
    from interp;
  get diagnostics n_corpus = row_count;

  delete from public.post_day7;
  insert into public.post_day7 select * from _d7;
  return jsonb_build_object('own', n_own, 'corpus', n_corpus, 'at', now());
end $$;


-- 3. Corpus frame for the monthly re-test (the 8 October extract, materialized so the runner pages a table) ------
create table if not exists public.brain_corpus_frame (
  client_id text not null, post_ref text not null, author_ref text, published_at timestamptz, post_text text,
  post_type text, image_count integer, likes numeric, reposts numeric, comments numeric, observed_at timestamptz,
  age_days numeric, age_class text, paid_status text, source text, source_url text, score numeric,
  reading_count bigint, selection_source text, topic_class text, angle text, proof_type text, stakes text,
  topic_labelled_at timestamptz, refreshed_at timestamptz not null default now(),
  primary key (client_id, post_ref)
);

create or replace function public.brain_corpus_refresh() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
set statement_timeout = '180s' set lock_timeout = '5s' as $$
declare n int;
begin
  delete from public.brain_corpus_frame where true;  -- PostgREST safeupdate rejects a bare DELETE
  insert into public.brain_corpus_frame (client_id, post_ref, author_ref, published_at, post_text, post_type, image_count, likes, reposts,
         comments, observed_at, age_days, age_class, paid_status, source, source_url, score, reading_count, selection_source,
         topic_class, angle, proof_type, stakes, topic_labelled_at)
  select c.client_id, c.post_ref, c.author_ref, c.published_at, c.post_text, c.post_type, c.image_count, c.likes, c.reposts,
         c.comments, c.observed_at, c.age_days, c.age_class, c.paid_status, c.source, c.source_url, c.score, c.reading_count,
         c.selection_source, l.topic_class, l.angle, l.proof_type, l.stakes, l.labelled_at
    from public.outlier_corpus_v4_v c
    left join lateral (select topic_class, angle, proof_type, stakes, labelled_at from public.outlier_post_labels l
                        where l.client_id = c.client_id and l.post_ref = c.post_ref and l.subject_kind = 'post' and l.labeller = 'A'
                        order by l.labelled_at desc, label_id desc limit 1) l on true
   where c.client_id in ('ivan','risedtc','arch');
  get diagnostics n = row_count;
  return jsonb_build_object('rows', n, 'at', now());
end $$;

-- 4. Apply, rollback, undo, transition ----------------------------------------------------------------------------
create or replace function public.brain_rule_apply(p_rule_id text, p_after jsonb, p_run_id text default null,
  p_actor text default 'brain-retest', p_reason text default null, p_expected_before jsonb default null,
  p_to_status text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
set statement_timeout = '15s' set lock_timeout = '3s' as $$
declare r public.brain_rules%rowtype; cp record; v jsonb; k text; before jsonb; had boolean; old_text text; new_text text;
        ev bigint; tok uuid := gen_random_uuid(); lc record; from_st text;
begin
  select * into r from public.brain_rules where rule_id = p_rule_id for update;
  if not found then raise exception 'brain_rule_apply: unknown rule %', p_rule_id; end if;
  if r.veto then raise exception 'brain_rule_apply: rule % is vetoed; it never re-applies by itself', p_rule_id; end if;
  from_st := r.status;

  if r.consumer_type = 'scheduler_var' then
    k := r.consumer_ref ->> 'key';
    select id, variables into cp from public.content_prompts where slug = r.consumer_ref ->> 'slug' and is_active for update;
    if not found then raise exception 'brain_rule_apply: prompt row % not found', r.consumer_ref ->> 'slug'; end if;
    old_text := cp.variables[1];
    v := old_text::jsonb;
    had := v ? k;
    before := v -> k;
    if p_expected_before is not null and before is distinct from p_expected_before then
      raise exception 'brain_rule_apply: % drifted (expected %, found %)', k, p_expected_before, before;
    end if;
    new_text := (v || jsonb_build_object(k, p_after))::text;
    update public.content_prompts set variables[1] = new_text where id = cp.id;
    insert into public.brain_rule_events (rule_id, kind, from_status, to_status, consumer_type, consumer_ref, before_value, after_value, undo_token, run_id, actor, reason)
    values (p_rule_id, 'apply', from_st, coalesce(p_to_status, from_st), r.consumer_type, r.consumer_ref,
            jsonb_build_object('present', had, 'value', before, 'text', old_text),
            jsonb_build_object('value', p_after, 'text', new_text), tok, p_run_id, p_actor, p_reason)
    returning id into ev;
  elsif r.consumer_type = 'lint_check' then
    select * into lc from public.brain_lint_codes where code = r.consumer_ref ->> 'code' and scope = r.scope for update;
    before := case when found then jsonb_build_object('mode', lc.mode, 'params', lc.params) else null end;
    if p_expected_before is not null and before is distinct from p_expected_before then
      raise exception 'brain_rule_apply: lint % drifted', r.consumer_ref ->> 'code';
    end if;
    insert into public.brain_lint_codes (code, scope, mode, params, rule_id)
    values (r.consumer_ref ->> 'code', r.scope, p_after ->> 'mode', coalesce(p_after -> 'params', '{}'::jsonb), p_rule_id)
    on conflict (code, scope) do update set mode = excluded.mode, params = excluded.params, rule_id = excluded.rule_id, updated_at = now();
    insert into public.brain_rule_events (rule_id, kind, from_status, to_status, consumer_type, consumer_ref, before_value, after_value, undo_token, run_id, actor, reason)
    values (p_rule_id, 'apply', from_st, coalesce(p_to_status, from_st), r.consumer_type, r.consumer_ref,
            jsonb_build_object('present', before is not null, 'value', before), jsonb_build_object('value', p_after), tok, p_run_id, p_actor, p_reason)
    returning id into ev;
  else
    raise exception 'brain_rule_apply: consumer_type % is not applied by code; stage a kit', r.consumer_type;
  end if;

  if p_to_status is not null and p_to_status <> r.status then
    update public.brain_rules set status = p_to_status where rule_id = p_rule_id;
  end if;
  return jsonb_build_object('event_id', ev, 'undo_token', tok, 'before', before, 'after', p_after);
end $$;

create or replace function public.brain_rule_rollback(p_event_id bigint, p_actor text default 'operator', p_veto boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
set statement_timeout = '15s' set lock_timeout = '3s' as $$
declare e public.brain_rule_events%rowtype; r public.brain_rules%rowtype; cp record; v jsonb; k text; cur_text text;
        restored text; mode text; ev bigint; done bigint;
begin
  select * into e from public.brain_rule_events where id = p_event_id;
  if not found or e.kind <> 'apply' then raise exception 'brain_rule_rollback: % is not an apply event', p_event_id; end if;
  select id into done from public.brain_rule_events where reverts_event_id = p_event_id and kind = 'rollback';
  if found then return jsonb_build_object('already_rolled_back', true, 'rollback_event_id', done); end if;
  select * into r from public.brain_rules where rule_id = e.rule_id for update;

  if e.consumer_type = 'scheduler_var' then
    k := e.consumer_ref ->> 'key';
    select id, variables into cp from public.content_prompts where slug = e.consumer_ref ->> 'slug' and is_active for update;
    cur_text := cp.variables[1];
    if cur_text = e.after_value ->> 'text' then
      restored := e.before_value ->> 'text'; mode := 'exact_text';
    else
      v := cur_text::jsonb;
      if (e.before_value ->> 'present')::boolean then v := v || jsonb_build_object(k, e.before_value -> 'value');
      else v := v - k; end if;
      restored := v::text; mode := 'key_only';
    end if;
    update public.content_prompts set variables[1] = restored where id = cp.id;
    insert into public.brain_rule_events (rule_id, kind, from_status, to_status, consumer_type, consumer_ref, before_value, after_value, reverts_event_id, actor, reason)
    values (e.rule_id, 'rollback', r.status, case when r.status = e.to_status then e.from_status else r.status end, e.consumer_type, e.consumer_ref,
            jsonb_build_object('text', cur_text), jsonb_build_object('text', restored, 'mode', mode), p_event_id, p_actor,
            case when p_veto then 'undo with veto' else 'rollback' end)
    returning id into ev;
  elsif e.consumer_type = 'lint_check' then
    if (e.before_value ->> 'present')::boolean then
      update public.brain_lint_codes set mode = e.before_value -> 'value' ->> 'mode', params = e.before_value -> 'value' -> 'params', updated_at = now()
       where code = e.consumer_ref ->> 'code' and scope = r.scope;
    else
      delete from public.brain_lint_codes where code = e.consumer_ref ->> 'code' and scope = r.scope;
    end if;
    insert into public.brain_rule_events (rule_id, kind, from_status, to_status, consumer_type, consumer_ref, before_value, after_value, reverts_event_id, actor, reason)
    values (e.rule_id, 'rollback', r.status, case when r.status = e.to_status then e.from_status else r.status end, e.consumer_type, e.consumer_ref,
            e.after_value, e.before_value, p_event_id, p_actor, case when p_veto then 'undo with veto' else 'rollback' end)
    returning id into ev;
  else
    raise exception 'brain_rule_rollback: consumer_type % has no code rollback', e.consumer_type;
  end if;

  if r.status = e.to_status and e.from_status is distinct from e.to_status then
    update public.brain_rules set status = e.from_status where rule_id = e.rule_id;
  end if;
  if p_veto then
    update public.brain_rules set veto = true where rule_id = e.rule_id;
    insert into public.brain_rule_events (rule_id, kind, actor, reason, reverts_event_id) values (e.rule_id, 'veto', p_actor, 'Undo on the feed line', p_event_id);
  end if;
  return jsonb_build_object('rollback_event_id', ev, 'mode', mode, 'veto', p_veto);
end $$;

create or replace function public.brain_rule_undo(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare eid bigint;
begin
  select id into eid from public.brain_rule_events where undo_token = p_token and kind = 'apply';
  if not found then return jsonb_build_object('error', 'unknown_token'); end if;
  return public.brain_rule_rollback(eid, 'undo-link', true) || jsonb_build_object('event_id', eid);
end $$;

create or replace function public.brain_rule_transition(p_rule_id text, p_to text, p_run_id text default null,
  p_reason text default null, p_actor text default 'brain-retest')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.brain_rules%rowtype; ev bigint;
begin
  select * into r from public.brain_rules where rule_id = p_rule_id for update;
  if not found then raise exception 'unknown rule %', p_rule_id; end if;
  if r.override is not null and p_actor <> 'owner' then
    return jsonb_build_object('skipped', 'owner_override', 'override', r.override);
  end if;
  if r.status = p_to then return jsonb_build_object('skipped', 'same_status'); end if;
  update public.brain_rules set status = p_to, last_tested = now() where rule_id = p_rule_id;
  insert into public.brain_rule_events (rule_id, kind, from_status, to_status, run_id, actor, reason)
  values (p_rule_id, 'transition', r.status, p_to, p_run_id, p_actor, p_reason) returning id into ev;
  return jsonb_build_object('event_id', ev, 'from', r.status, 'to', p_to);
end $$;

-- 5. Monday line ------------------------------------------------------------------------------------------------
-- One line for the cb39 Monday card: what the brain changed this month, with an Undo link per change.
create or replace function public.brain_monday_line(p_now timestamptz default now()) returns text
language plpgsql stable security definer set search_path = public, pg_temp set statement_timeout = '5s' as $$
declare since timestamptz := date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC'; base text; parts text[] := '{}';
        x record; n int := 0;
begin
  select value into base from public.integration_config where key = 'brain_undo_url';
  for x in
    select e.id, e.rule_id, e.kind, e.from_status, e.to_status, e.consumer_ref, e.after_value, e.undo_token,
           exists (select 1 from public.brain_rule_events b where b.reverts_event_id = e.id and b.kind = 'rollback') undone
      from public.brain_rule_events e
     where e.created_at >= since and e.created_at <= p_now and e.kind in ('apply','transition')
     order by e.created_at
  loop
    if x.rule_id like 'zz-%' and x.undone then continue; end if;  -- an undone self-test leaves no line
    n := n + 1;
    if n > 3 then continue; end if;
    parts := parts || (x.rule_id || ': ' ||
      case when x.kind = 'apply' then coalesce(x.consumer_ref ->> 'key', x.consumer_ref ->> 'code', 'consumer') || ' set to ' || (x.after_value -> 'value')::text
           else x.from_status || ' to ' || x.to_status end ||
      case when x.undone then ' (undone)'
           when x.undo_token is not null and base is not null then ' Undo: ' || base || '?t=' || x.undo_token
           else '' end);
  end loop;
  if n = 0 then return 'Brain: nothing changed this month.'; end if;
  return 'Brain this month: ' || array_to_string(parts, '; ') || case when n > 3 then '; and ' || (n - 3) || ' more' else '' end || '.';
end $$;

-- 6. Schedule: daily day-7 refresh, monthly re-test on the first Monday (pg_cron has OR semantics for
-- day-of-month + day-of-week, so the date guard lives in the dispatcher). First real run: Monday 2 Nov 2026 06:00 UTC.
create or replace function public.brain_retest_dispatch(p_mode text default 'monthly', p_force boolean default false) returns bigint
language plpgsql security definer set search_path = public as $$
declare u text; k text; rid bigint;
begin
  if not p_force and extract(day from (now() at time zone 'UTC')) > 7 then return null; end if;
  select value into u from runner_secrets where key = 'runner_url';
  select value into k from runner_secrets where key = 'runner_key';
  if u is null or k is null then raise warning 'brain_retest_dispatch: runner_url/runner_key missing'; return null; end if;
  select net.http_post(url := u || '/lanes/brain-retest/run', body := jsonb_build_object('body', jsonb_build_object('mode', p_mode)),
    headers := jsonb_build_object('Content-Type','application/json','x-runner-key',k), timeout_milliseconds := 20000) into rid;
  return rid;
end $$;

select cron.unschedule(jobid) from cron.job where jobname in ('brain-day7-refresh','brain-retest-monthly');
select cron.schedule('brain-day7-refresh', '40 6 * * *', 'select public.brain_day7_refresh()');
select cron.schedule('brain-retest-monthly', '0 6 * * 1', 'select public.brain_retest_dispatch(''monthly'')');

-- 7. Locks ------------------------------------------------------------------------------------------------------
alter table public.brain_rules enable row level security;
alter table public.brain_rule_events enable row level security;
alter table public.brain_rule_tests enable row level security;
alter table public.brain_lint_codes enable row level security;
alter table public.post_day7 enable row level security;
alter table public.brain_corpus_frame enable row level security;
revoke all on public.brain_rules, public.brain_rule_events, public.brain_rule_tests, public.brain_lint_codes,
              public.post_day7, public.post_day7_v, public.brain_corpus_frame from anon, authenticated;
revoke execute on function public.brain_rule_apply(text, jsonb, text, text, text, jsonb, text), public.brain_rule_rollback(bigint, text, boolean),
  public.brain_rule_undo(uuid), public.brain_rule_transition(text, text, text, text, text), public.brain_day7_refresh(),
  public.brain_corpus_refresh(), public.brain_monday_line(timestamptz), public.brain_retest_dispatch(text, boolean) from public, anon, authenticated;

commit;

-- cb39 Monday card: append the brain line
CREATE OR REPLACE FUNCTION public.cb39_monday_card(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  wk timestamptz := date_trunc('week', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  key text; n_total int; by_lane text; last_release timestamptz; v_title text; v_body text; existing public.inbox_notifications%ROWTYPE;
  n_keep int; n_edit int; n_drop int; results_line text; part text; c text; brain_line text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cb39-monday-card', 0)) THEN RETURN jsonb_build_object('sent', false, 'reason', 'busy'); END IF;
  IF p_now < wk + interval '16 hours' THEN RETURN jsonb_build_object('sent', false, 'reason', 'before_release_window'); END IF;
  key := 'cb39-judge:' || to_char(wk AT TIME ZONE 'UTC', 'YYYY-MM-DD');

  SELECT coalesce(sum(n), 0)::int, string_agg(lane_label || ' ' || n, ', ' ORDER BY ord), max(newest)
    INTO n_total, by_lane, last_release
    FROM (SELECT CASE m.client_id WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Rise' ELSE 'Arch' END AS lane_label,
                 CASE m.client_id WHEN 'ivan' THEN 1 WHEN 'risedtc' THEN 2 ELSE 3 END AS ord,
                 count(*) AS n, max(m.released_at) AS newest
            FROM public.cb34_p2_members m
            JOIN public.carousel_drafts d ON d.id = m.draft_id
           WHERE m.state = 'released' AND m.validation ->> 'verdict' = 'PASS'
             AND m.released_at >= wk AND m.released_at <= p_now
             AND ((m.client_id = 'ivan' AND d.client_id IS NULL) OR (m.client_id <> 'ivan' AND d.client_id = m.client_id))
             AND d.status IN ('review','error') AND d.published_at IS NULL
             AND NOT coalesce((d.taxonomy ->> 'deleted_by_operator') = 'true', false)
             AND NOT EXISTS (SELECT 1 FROM public.cb39_draft_verdicts v WHERE v.draft_id = m.draft_id)
           GROUP BY m.client_id) x;

  IF n_total = 0 THEN RETURN jsonb_build_object('sent', false, 'reason', 'nothing_to_judge', 'week', wk); END IF;
  IF p_now - last_release < interval '45 minutes' AND p_now < wk + interval '30 hours' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'settling', 'to_judge', n_total, 'last_release', last_release); END IF;

  -- Last week's verdicts (Monday to Monday, UTC).
  SELECT count(*) FILTER (WHERE verdict = 'keep'), count(*) FILTER (WHERE verdict = 'edited'), count(*) FILTER (WHERE verdict = 'drop')
    INTO n_keep, n_edit, n_drop
    FROM public.cb39_draft_verdicts WHERE decided_at >= wk - interval '7 days' AND decided_at < wk;

  -- Run 37's results line, only when there is a mature read: posts that reached 7 days last week, with impressions
  -- at 7 days and a known buyer-engager count. Any failure of the read leaves the line out.
  results_line := NULL;
  BEGIN
    FOREACH c IN ARRAY ARRAY['ivan','risedtc','arch'] LOOP
      SELECT CASE WHEN count(*) > 0 THEN
               CASE c WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Rise' ELSE 'Arch' END || ' ' || count(*) || ' post' ||
               CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ', ' || sum(r.buyer_engagers) || ' buyer engager' ||
               CASE WHEN sum(r.buyer_engagers) = 1 THEN '' ELSE 's' END END
        INTO part
        FROM public.cb37_results(c, ((wk - interval '14 days') AT TIME ZONE 'UTC')::date) r
       WHERE r.published_at >= wk - interval '14 days' AND r.published_at < wk - interval '7 days'
         AND r.imp_7d IS NOT NULL AND r.buyer_engagers IS NOT NULL;
      IF part IS NOT NULL THEN results_line := coalesce(results_line || '; ', '') || part; END IF;
    END LOOP;
  EXCEPTION WHEN others THEN results_line := NULL;
  END;

  -- Self-updating brain (11 Oct 2026): one feed line, what changed this month with Undo, default "nothing changed".
  BEGIN brain_line := public.brain_monday_line(p_now); EXCEPTION WHEN others THEN brain_line := NULL; END;

  v_title := n_total || ' new brain draft' || CASE WHEN n_total = 1 THEN '' ELSE 's' END || '. Tap to judge.';
  v_body := by_lane || '. Approve or Drop on each card in Review, about 2 minutes.'
    || E'\nLast week: ' || n_keep || ' kept, ' || n_edit || ' edited, ' || n_drop || ' dropped.'
    || CASE WHEN results_line IS NOT NULL THEN E'\nResults at 7 days: ' || results_line || '.' ELSE '' END
    || CASE WHEN brain_line IS NOT NULL THEN E'\n' || brain_line ELSE '' END;

  SELECT * INTO existing FROM public.inbox_notifications WHERE dedupe_key = key AND source = 'cb39-judge' ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    IF existing.read_at IS NULL AND existing.dismissed_at IS NULL AND (existing.title IS DISTINCT FROM v_title OR existing.body IS DISTINCT FROM v_body) THEN
      UPDATE public.inbox_notifications SET title = v_title, body = v_body, last_seen_at = p_now WHERE id = existing.id;
      RETURN jsonb_build_object('sent', false, 'reason', 'refreshed', 'id', existing.id, 'to_judge', n_total);
    END IF;
    RETURN jsonb_build_object('sent', false, 'reason', 'already_sent', 'id', existing.id);
  END IF;

  INSERT INTO public.inbox_notifications(family, source, dedupe_key, severity, title, body, url, tenant, group_key, push_result)
  VALUES ('brain_drafts_pending', 'cb39-judge', key, 'info', v_title, v_body, '#exp/d/content/now', NULL, key,
          jsonb_build_object('skipped', 'feed_only'))
  RETURNING * INTO existing;
  RETURN jsonb_build_object('sent', true, 'id', existing.id, 'to_judge', n_total, 'title', v_title, 'body', v_body);
END $function$;
