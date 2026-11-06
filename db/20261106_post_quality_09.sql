-- 20261106_post_quality_09.sql  (build 09, Ivan inbox + systems review items #33, QW boost marks, #27 store, #8)
-- Rollback: 20261106_post_quality_09_rollback.sql
--
-- 1. Boost marks on the 3 known paid posts (23 Sep, 26 Sep video, 18 Oct), and cb51_own_winners (the brain's
--    own-post re-use pool) skips boost-marked posts in its median and its pool. outlier_grade_candidates,
--    editorial_forecast_baseline and content_plan_timing_ivan already skip marked posts.
-- 2. Re-run rule (Ivan 2026-11-03 for ARCH, applied to Ivan): a draft that repeats one of his published posts may
--    only go out by machine when the original got >= 1.5x his organic 90-day median impressions.
--    ivan_rerun_check() finds the repeat (word 3-gram overlap: a duplicate check, never a topic judge).
--    zzz_ivan_rerun_gate: a MACHINE dating a failing re-run sends it back to Review (no date, pending
--    scheduled_posts cancelled). Ivan dating or approving it himself is his call and is stamped as kept.
-- 3. qa.line_flags: where the line flags live (personal lines of the copied author, dated life claims, the
--    re-run note). Written by the n8n job "Ivan Draft Line Flags" (one reasoned proxy call per draft, prompt
--    content_prompts ivan-draft-line-flags) through ivan_line_flags_save(), and by ivan_rerun_stamp() (pg_cron).
--    Ivan keeps flagged lines as written through operator_line_flags_keep(). Nothing here blocks a post.
-- 4. Nightly re-link of dead twins (#8): the publisher's post Ivan deleted and reposted keeps the draft link
--    and reads 0. Same UTC day + same first 30 letters + the twin was never seen by the tracker -> the live
--    twin takes the draft link, the draft points at the live URN, the dead row is dropped (full row kept in
--    own_post_relinks).

begin;

-- ---------------------------------------------------------------- 1. boost marks + own-winner pool
insert into public.own_post_boost_marks (client_id, post_ref, boosted, marked_by, post_ref_input)
select 'ivan', v.ref, true, 'build-09 2026-11-06: known $30 Thought Leader Ad boost (swarm 05 finding 7)', v.inp
  from (values
    ('7508469162663505920', 'urn:li:activity:7508469162663505920 (23 Sep, 30 post ideas)'),
    ('7509565649103486976', 'urn:li:ugcPost:7509565649103486976 (26 Sep video, profile is a sales page)'),
    ('7509565683555258368', 'activity-7509565683555258368 (26 Sep video, share URL id)'),
    ('7517552679338864640', 'urn:li:activity:7517552679338864640 (18 Oct, cracked the algorithm)')
  ) v(ref, inp)
 where not exists (select 1 from public.own_post_boost_current_v c where c.client_id = 'ivan' and c.post_ref = v.ref);

CREATE OR REPLACE FUNCTION public.cb51_own_winners(p_client text, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT m.social_id, m.post_url, m.published_at, m.impressions, m.reactions, m.comments,
           nullif(btrim(coalesce(ft.t, m.meta ->> 'text')), '') AS body, substring(m.social_id FROM '([0-9]{6,})$') AS num
      FROM public.client_post_metrics m
      -- meta.text is cut at 500 chars; the full text lives in own_posts (Ivan) or client_post_state (client seats)
      LEFT JOIN LATERAL (
        SELECT t FROM (
          SELECT o.post_text AS t FROM public.own_posts o
           WHERE p_client = 'ivan' AND o.social_id ~ (':' || substring(m.social_id FROM '([0-9]{6,})$') || '$') AND coalesce(o.post_text, '') <> ''
          UNION ALL
          SELECT s.post_text FROM public.client_post_state s
           WHERE p_client <> 'ivan' AND s.client_id = p_client AND s.post_urn ~ (':' || substring(m.social_id FROM '([0-9]{6,})$') || '$') AND coalesce(s.post_text, '') <> ''
        ) z ORDER BY length(t) DESC LIMIT 1) ft ON true
     WHERE m.client_id = p_client AND p_client IN ('ivan', 'risedtc', 'arch')
       AND m.published_at > p_now - interval '90 days' AND m.published_at <= p_now
       AND m.impressions > 0
       AND coalesce(m.meta ->> 'is_repost', 'false') <> 'true'
       AND NOT coalesce(m.meta ? 'job_posting', false)
       -- 2026-11-06 build 09: a paid (boost-marked) post is not proof of what works organically; out of the median and the pool
       AND NOT EXISTS (SELECT 1 FROM public.own_post_boost_current_v bb
                        WHERE bb.client_id = p_client AND bb.boosted IS TRUE
                          AND bb.post_ref IN (substring(m.social_id FROM '([0-9]{16,20})$'), substring(coalesce(m.post_url, '') FROM 'activity[-:]([0-9]{16,20})')))),
  med AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY b.impressions)::numeric AS md, count(*) AS n
      FROM base b WHERE b.published_at < p_now - interval '3 days'),
  used AS (
    SELECT EXISTS (SELECT 1 FROM public.cb34_p2_members x
                    WHERE x.client_id = p_client AND x.source_ref LIKE 'outlier:linkedin:own-%'
                      AND x.week_start = (date_trunc('week', p_now AT TIME ZONE 'UTC'))::date) AS yes),
  cand AS (
    SELECT b.*, 'own-' || p_client || '-' || b.num AS ref, med.md
      FROM base b, med, used
     WHERE NOT used.yes AND med.n >= 5 AND med.md > 0 AND b.impressions >= 2 * med.md
       -- a stub caption (a video post's one-liner) holds nothing the text writer can learn from
       AND length(coalesce(b.body, '')) >= 150 AND b.num IS NOT NULL AND b.post_url ~* '^https://'
       AND public.cb35_live_source_draft(p_client, 'outlier:linkedin:own-' || p_client || '-' || b.num) IS NULL
       AND public.cb35_source_cooldown(p_client, 'outlier:linkedin:own-' || p_client || '-' || b.num, NULL, 21) IS NULL
     ORDER BY b.impressions DESC
     LIMIT 8)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'ref', c.ref, 'kind', 'own_winner',
           'author', CASE p_client WHEN 'ivan' THEN 'Ivan Manfredi' WHEN 'risedtc' THEN 'Mattan Danino' ELSE 'Davorin Smit' END || ' (own post)',
           'date', to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'ratio', round(c.impressions / c.md, 2), 'likes', c.reactions, 'comments', c.comments,
           'impressions', c.impressions, 'median_impressions', round(c.md),
           'url', c.post_url, 'text', c.body, 'post_type', NULL)
         ORDER BY c.impressions DESC), '[]'::jsonb)
    FROM cand c
$function$;

-- ---------------------------------------------------------------- 2. re-run rule
create or replace function public.ivan_post_shingles(t text)
returns text[] language sql immutable parallel safe set search_path to 'pg_catalog' as $$
  with w as (select x, n from regexp_split_to_table(lower(coalesce(t, '')), '[^[:alnum:]]+') with ordinality a(x, n) where x <> ''),
       r as (select x, row_number() over (order by n) i from w)
  select coalesce(array_agg(distinct a.x || ' ' || b.x || ' ' || c.x), '{}')
    from r a join r b on b.i = a.i + 1 join r c on c.i = a.i + 2
$$;

-- The published post this draft repeats, or null. Repeat = at least 8 shared word 3-grams and at least half of
-- the shorter text's 3-grams (real data 2026-11-06: the 11 Nov copy of 30 Sep = 1.00; every other live draft <= 0.20).
-- pass = the original is not boost-marked and got >= 1.5x the organic median of his posts 3-90 days old.
create or replace function public.ivan_rerun_check(p_body text, p_draft uuid default null, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  with d as (select public.ivan_post_shingles(p_body) s),
  boosted as (select b.post_ref from public.own_post_boost_current_v b where b.client_id = 'ivan' and b.boosted is true),
  own as (
    select o.id, o.social_id, o.linkedin_url, o.posted_at, o.num_impressions, o.post_text,
           exists (select 1 from boosted b where b.post_ref in (public.outlier_canonical_post_ref(o.social_id), public.outlier_canonical_post_ref(o.linkedin_url))) is_boosted
      from public.own_posts o
     where o.posted_at <= p_now and coalesce(o.post_text, '') <> ''
       and (p_draft is null or coalesce(o.clickup_task_id, '') <> p_draft::text)      -- its own earlier publish attempt
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
     where cardinality(d.s) >= 5 and x.shared >= 8 and x.ratio >= 0.5
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

create or replace function public.ivan_body_sha(t text)
returns text language sql immutable parallel safe set search_path to 'public', 'extensions', 'pg_catalog' as $$
  select encode(sha256(convert_to(coalesce(t, ''), 'UTF8')), 'hex')
$$;

create or replace function public.ivan_rerun_gate()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_sha text; v_ivan boolean; v_dating boolean; v_approving boolean; r jsonb; v_qa jsonb; v_lf jsonb; v_was timestamptz;
begin
  if new.client_id is not null or new.published_at is not null then return new; end if;
  v_dating := (new.scheduled_at is not null and (tg_op = 'INSERT' or old.scheduled_at is distinct from new.scheduled_at))
           or (new.status = 'scheduled' and (tg_op = 'INSERT' or old.status is distinct from 'scheduled'));
  v_approving := new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved');
  if not (v_dating or v_approving) then return new; end if;
  begin
    v_ivan := coalesce(current_setting('app.schedule_manual', true), '') = 'on'
           or public.cb39_implicit_actor() is not null
           or auth.uid() is not null;
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
create trigger zzz_ivan_rerun_gate before insert or update of scheduled_at, status on public.carousel_drafts
  for each row execute function public.ivan_rerun_gate();

-- ---------------------------------------------------------------- 3. qa.line_flags
-- Ivan drafts that can still go out.
create or replace view public.ivan_line_flag_targets_v as
  select d.id, d.status, d.scheduled_at, d.created_at, d.title, d.post_body, public.ivan_body_sha(d.post_body) body_sha,
         case when jsonb_typeof(d.qa) = 'object' and jsonb_typeof(d.qa -> 'line_flags') = 'object' then d.qa -> 'line_flags' else '{}'::jsonb end lf,
         d.qa, d.taxonomy, d.source_detail, d.source_label
    from public.carousel_drafts d
   where d.client_id is null and d.published_at is null and d.board_archived_at is null
     and d.status in ('review', 'approved', 'scheduled') and coalesce(d.post_body, '') <> ''
     and (d.scheduled_at is null or d.scheduled_at > now())
     and coalesce(d.taxonomy ->> 'deleted_by_operator', '') <> 'true';
revoke all on public.ivan_line_flag_targets_v from anon, authenticated;

-- Re-run note for every target whose text changed since the last stamp (pure SQL, no proxy).
create or replace function public.ivan_rerun_stamp(p_limit int default 200)
returns int language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare t record; n int := 0; r jsonb;
begin
  for t in select * from public.ivan_line_flag_targets_v v where coalesce(v.lf ->> 'rerun_sha', '') <> v.body_sha
            order by v.scheduled_at nulls last, v.created_at desc limit p_limit loop
    r := public.ivan_rerun_check(t.post_body, t.id);
    update public.carousel_drafts d
       set qa = (case when jsonb_typeof(d.qa) = 'object' then d.qa else '{}'::jsonb end)
                || jsonb_build_object('line_flags', t.lf || jsonb_build_object('rerun', r, 'rerun_sha', t.body_sha))
     where d.id = t.id and public.ivan_body_sha(d.post_body) = t.body_sha;
    n := n + 1;
  end loop;
  return n;
end $$;

-- The n8n job's queue: dated drafts first, then copies, then the rest. Three failed reads of one text = skipped
-- until the text changes.
create or replace function public.ivan_line_flags_due(p_limit int default 4)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select coalesce(jsonb_agg(j order by k1, k2, k3 desc), '[]'::jsonb) from (
    select jsonb_build_object(
             'id', v.id, 'body_sha', v.body_sha, 'post_body', v.post_body, 'status', v.status,
             'scheduled_at', v.scheduled_at, 'title', v.title,
             'copy', case when v.source_detail ->> 'kind' in ('x_tracked_outlier', 'linkedin_outlier_copy')
                            or v.qa ->> 'review_kind' = 'outlier_copy' or v.taxonomy ->> 'source' in ('x_tracked_outlier', 'linkedin_outlier_copy')
                          then jsonb_build_object(
                            'author', coalesce(v.source_detail ->> 'author_name', v.qa #>> '{outlier_copy,source_author}', v.source_detail ->> 'handle'),
                            'handle', v.source_detail ->> 'handle',
                            'original_text', left(coalesce(v.source_detail ->> 'original_text', ''), 6000),
                            'hints', coalesce((select jsonb_agg(regexp_replace(x, '^EDIT:\s*', '')) from jsonb_array_elements_text(
                                        case when jsonb_typeof(v.taxonomy -> 'changes') = 'array' then v.taxonomy -> 'changes' else '[]'::jsonb end) x
                                        where x ~ '^EDIT:'), '[]'::jsonb)
                                     || coalesce(case when jsonb_typeof(v.qa #> '{outlier_copy,make_yours}') = 'array' then v.qa #> '{outlier_copy,make_yours}' end, '[]'::jsonb))
                          end) j,
           (v.scheduled_at is null) k1,
           (v.source_detail ->> 'kind' is null) k2,
           v.created_at k3
      from public.ivan_line_flag_targets_v v
     where coalesce(v.lf ->> 'lines_sha', '') <> v.body_sha
       and not (coalesce(v.lf #>> '{fail,sha}', '') = v.body_sha and coalesce((v.lf #>> '{fail,n}')::int, 0) >= 3)
     order by k1, k2, k3 desc
     limit greatest(1, least(p_limit, 20))) q
$$;

-- Save the job's answer for the exact text it read. Each line must be a verbatim piece of the current body.
create or replace function public.ivan_line_flags_save(p_draft uuid, p_body_sha text, p_lines jsonb, p_by text, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare d record; v_lf jsonb; v_lines jsonb := '[]'::jsonb; x jsonb; v_text text; v_kind text; v_ask text; v_n int;
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
      continue when v_text = '' or length(v_text) > 600 or position(v_text in d.post_body) = 0 or v_kind not in ('personal', 'dated');
      continue when exists (select 1 from jsonb_array_elements(v_lines) y where y ->> 'text' = v_text and y ->> 'kind' = v_kind);
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('text', v_text, 'kind', v_kind, 'ask', nullif(v_ask, '')));
      exit when jsonb_array_length(v_lines) >= 8;
    end loop;
    v_lf := (v_lf - 'fail') || jsonb_build_object('lines', v_lines, 'lines_sha', p_body_sha, 'lines_by', left(coalesce(p_by, '?'), 80), 'lines_at', now());
    if coalesce(v_lf #>> '{kept,sha}', '') <> p_body_sha then v_lf := v_lf - 'kept'; end if;
  end if;
  update public.carousel_drafts c
     set qa = (case when jsonb_typeof(c.qa) = 'object' then c.qa else '{}'::jsonb end) || jsonb_build_object('line_flags', v_lf)
   where c.id = p_draft;
  return jsonb_build_object('saved', true, 'lines', jsonb_array_length(v_lines), 'error', p_error is not null);
end $$;

-- Ivan keeps the flagged lines (and a re-run) as written, for this exact text.
create or replace function public.operator_line_flags_keep(p_gate text, p_draft uuid, p_body_sha text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare d record; v_lf jsonb; v_stamp jsonb;
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  select c.id, c.post_body, c.qa into d from public.carousel_drafts c where c.id = p_draft and c.client_id is null for update;
  if not found then raise exception 'not an Ivan draft'; end if;
  if public.ivan_body_sha(d.post_body) <> coalesce(p_body_sha, '') then return jsonb_build_object('kept', false, 'reason', 'body_changed'); end if;
  v_lf := case when jsonb_typeof(d.qa) = 'object' and jsonb_typeof(d.qa -> 'line_flags') = 'object' then d.qa -> 'line_flags' else '{}'::jsonb end;
  v_stamp := jsonb_build_object('sha', p_body_sha, 'at', now(), 'by', 'ivan');
  v_lf := v_lf || jsonb_build_object('kept', v_stamp) || case when v_lf ? 'rerun' and v_lf -> 'rerun' <> 'null'::jsonb then jsonb_build_object('rerun_kept', v_stamp) else '{}'::jsonb end;
  update public.carousel_drafts c set qa = (case when jsonb_typeof(c.qa) = 'object' then c.qa else '{}'::jsonb end) || jsonb_build_object('line_flags', v_lf)
   where c.id = p_draft;
  return jsonb_build_object('kept', true, 'at', v_stamp ->> 'at');
end $$;

revoke all on function public.ivan_rerun_check(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.ivan_rerun_gate() from public, anon, authenticated;
revoke all on function public.ivan_rerun_stamp(int) from public, anon, authenticated;
revoke all on function public.ivan_line_flags_due(int) from public, anon, authenticated;
revoke all on function public.ivan_line_flags_save(uuid, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.operator_line_flags_keep(text, uuid, text) from public, anon;
grant execute on function public.ivan_line_flags_due(int) to service_role;
grant execute on function public.ivan_line_flags_save(uuid, text, jsonb, text, text) to service_role;
grant execute on function public.ivan_rerun_stamp(int) to service_role;
grant execute on function public.ivan_rerun_check(text, uuid, timestamptz) to service_role;
grant execute on function public.operator_line_flags_keep(text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- 4. dead-twin re-link
create table if not exists public.own_post_relinks (
  id bigserial primary key,
  at timestamptz not null default now(),
  dead_id uuid not null,
  dead_social_id text,
  live_id uuid not null,
  live_social_id text,
  draft_id text,
  moved_task_id boolean not null default false,
  draft_source_post_before text,
  dead_row jsonb not null
);
alter table public.own_post_relinks enable row level security;
revoke all on public.own_post_relinks from anon, authenticated;

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
     group by d.id, d.social_id, d.clickup_task_id, dx.id
  loop
    if p.n_live <> 1 then skipped := skipped || jsonb_build_array(jsonb_build_object('dead', p.dead_urn, 'why', 'live twins: ' || p.n_live)); continue; end if;
    v_task := nullif(btrim(coalesce(p.dead_task, '')), '');
    select nullif(btrim(coalesce(clickup_task_id, '')), '') into v_live_task from public.own_posts where id = p.live_id;
    if v_task is not null and v_live_task is not null and v_live_task <> v_task then
      skipped := skipped || jsonb_build_array(jsonb_build_object('dead', p.dead_urn, 'why', 'live twin links another draft'));
      continue;
    end if;
    v_moved := v_task is not null and v_live_task is null;
    select source_post_id into v_spid from public.carousel_drafts where v_task is not null and id::text = v_task;
    if p_apply then
      if v_moved then update public.own_posts set clickup_task_id = v_task where id = p.live_id; end if;
      if v_task is not null then
        update public.carousel_drafts set source_post_id = p.live_urn where id::text = v_task and source_post_id is not distinct from p.dead_urn;
      end if;
      update public.video_ideas set source_post_id = p.live_id where source_post_id = p.dead_id;
      insert into public.own_post_relinks (dead_id, dead_social_id, live_id, live_social_id, draft_id, moved_task_id, draft_source_post_before, dead_row)
      values (p.dead_id, p.dead_urn, p.live_id, p.live_urn, v_task, v_moved, v_spid, p.dead_row);
      delete from public.own_posts where id = p.dead_id;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('dead', p.dead_urn, 'live', p.live_urn, 'draft', v_task, 'moved_task', v_moved, 'draft_pointed_at_dead', v_spid is not distinct from p.dead_urn and v_task is not null));
  end loop;
  return jsonb_build_object('applied', p_apply, 'relinked', out, 'skipped', skipped);
end $$;
revoke all on function public.ivan_own_post_relink(boolean) from public, anon, authenticated;
grant execute on function public.ivan_own_post_relink(boolean) to service_role;

commit;

-- ---------------------------------------------------------------- crons (outside the transaction)
select cron.unschedule(jobid) from cron.job where jobname in ('ivan-own-post-relink', 'ivan-rerun-stamp');
select cron.schedule('ivan-own-post-relink', '40 23 * * *', $c$select public.ivan_own_post_relink(true)$c$);
select cron.schedule('ivan-rerun-stamp', '7,37 * * * *', $c$select public.ivan_rerun_stamp(200)$c$);
