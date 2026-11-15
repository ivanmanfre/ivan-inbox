-- 20261115a: the snapshot insert trigger looks up ONE row instead of resolving the whole table.
--
-- editorial_project_audn_capture (db/206) ran `select * from audn_snapshot_eligibility_v where id = p_id`
-- once per inserted snapshot row. That view sits on audn_identity_resolution_v, whose CTEs are
-- MATERIALIZED over every row of audn_post_metric_snapshots, so each insert cost ~0.3 s at 13k rows
-- and grew with the table. PostgREST cancels a statement at 8 s; batches of 60+ rows were silently
-- lost (RISE snapshots stopped 2026-11-07).
--
-- This adds audn_snapshot_eligibility_one(p_id): the same expressions as the two views, for one
-- snapshot row, with the identity lookup scoped to that row's client and post (one statement, so
-- the exact and the alias read see one identity state). The capture function changes in exactly
-- one line (the lookup). No view, table, trigger, grant or policy on audn_post_metric_snapshots
-- is touched.
--
-- Proof on live data 2026-11-15 (queries in the .test.sql file):
--   * all 13,673 snapshot rows: view row = function row on all 21 columns, 0 differ
--     (eligible_for_rank true on both 699, false on both 12,974, 0 disagree either way)
--   * 30 controlled fixture rows (every resolution branch, missing publish times, age boundaries),
--     all 21 columns: 0 differ
--   * trigger A/B in one rolled-back transaction, 125 rows under old then new: 0 output differences
--   * 100-row insert as service_role with statement_timeout 8s: old = cancelled, new = 1.3 s
--
-- If any definition the proof ran against has changed, the guard below aborts.

begin;

-- Serialize against anyone else changing these definitions, without needing their cooperation.
-- 1. ACCESS SHARE on the views (taken first: tables before the function row) blocks a concurrent
--    CREATE OR REPLACE VIEW / DROP, which need ACCESS EXCLUSIVE, until commit. It conflicts with
--    nothing a reader or writer of the tables does.
-- 2. Re-granting a privilege service_role already holds rewrites the capture function's catalog
--    row, so this transaction holds that row until commit: a concurrent CREATE OR REPLACE / ALTER /
--    DROP of the function waits and then fails with "tuple concurrently updated". A GRANT can only
--    touch the ACL, never the body, the security flag or the settings, so it cannot hide a change
--    the guard is there to catch. (SELECT ... FOR UPDATE on pg_proc is not permitted to this role.)
-- The guard runs AFTER both, so what it checks is what stays true until commit.
set local lock_timeout = '10s';
lock table public.audn_snapshot_eligibility_v, public.audn_identity_resolution_v,
           public.audn_canonical_post_identity_v, public.audn_post_identity_v in access share mode;
grant execute on function public.editorial_project_audn_capture(bigint) to service_role;

do $guard$
declare got text;
begin
  got := md5(pg_get_functiondef('public.editorial_project_audn_capture(bigint)'::regprocedure));
  if got is distinct from '1462cf7cdece0b8f71662609b1035f3a' then
    raise exception 'editorial_project_audn_capture changed since the proof (md5 %): re-read and re-prove', got;
  end if;
  got := md5(pg_get_viewdef('public.audn_snapshot_eligibility_v'::regclass, true));
  if got is distinct from 'edf114d7c0afe31c0b548f5d65557a79' then
    raise exception 'audn_snapshot_eligibility_v changed since the proof (md5 %): re-read and re-prove', got;
  end if;
  got := md5(pg_get_viewdef('public.audn_identity_resolution_v'::regclass, true));
  if got is distinct from '293a0782e5cba99666b1a6d0b0ac34e0' then
    raise exception 'audn_identity_resolution_v changed since the proof (md5 %): re-read and re-prove', got;
  end if;
  -- The helper relies on this view returning at most one row per (client_id, post id).
  got := md5(pg_get_viewdef('public.audn_canonical_post_identity_v'::regclass, true));
  if got is distinct from '8164ae9f87f800f7aab7e7e0afa8e8fe' then
    raise exception 'audn_canonical_post_identity_v changed since the proof (md5 %): re-read and re-prove', got;
  end if;
  got := md5(pg_get_viewdef('public.audn_post_identity_v'::regclass, true));
  if got is distinct from 'e4174c463b1e9947b4362a9522950f95' then
    raise exception 'audn_post_identity_v changed since the proof (md5 %): re-read and re-prove', got;
  end if;
end $guard$;

create or replace function public.audn_snapshot_eligibility_one(p_id bigint)
returns table (
  id bigint, client_id text, post_social_id text, cycle_id text, captured_at timestamptz,
  published_at timestamptz, actual_age_days numeric, declared_actual_age_days numeric,
  target_age_days integer, declared_target_age_days integer,
  impressions integer, reactions integer, comments integer, shares integer,
  source text, coverage jsonb, age_ok boolean, eligible_for_rank boolean,
  canonical_post_id text, resolution_status text, unresolved_reason text)
language plpgsql
set search_path to public
as $function$
#variable_conflict use_column
-- One-row twin of audn_snapshot_eligibility_v (which is audn_identity_resolution_v
-- over every snapshot row). Same expressions, but the identity lookup is scoped to
-- this snapshot's client and post, so the cost does not grow with the snapshot table.
declare
  s public.audn_post_metric_snapshots%rowtype;
  v_kind text; v_digits text;
  v_exact_id text; v_exact_pub timestamptz; v_exact_status text;
  v_alias_n integer; v_alias_id text; v_alias_pub timestamptz;
  v_canon text; v_status text; v_pub timestamptz; v_reason text; v_age numeric;
begin
  select m.* into s from public.audn_post_metric_snapshots m where m.id = p_id;
  if not found then return; end if;
  v_kind := public.audn_urn_kind(s.post_social_id);
  v_digits := public.audn_urn_digits(s.post_social_id);

  -- Both identity reads run in ONE statement, so they see one identity state (the view reads
  -- both from one materialized identity cache).
  -- exact_i: the view groups by (client_id, post_social_id), so at most one row.
  -- alias_i: only an untyped all-digit id can alias; otherwise the aggregate runs over zero
  -- rows (count 0, mins null), exactly as the view's lateral does.
  select ex.canonical_post_id, ex.published_at, ex.identity_status,
         al.candidate_count, al.canonical_post_id, al.published_at
    into v_exact_id, v_exact_pub, v_exact_status, v_alias_n, v_alias_id, v_alias_pub
    from (select 1) one
    left join lateral (
      select i.canonical_post_id, i.published_at, i.identity_status
        from public.audn_canonical_post_identity_v i
       where i.client_id = s.client_id and i.identity_post_social_id = s.post_social_id) ex on true
    cross join lateral (
      select count(*)::integer as candidate_count, min(i.canonical_post_id) as canonical_post_id,
             min(i.published_at) as published_at
        from public.audn_canonical_post_identity_v i
       where v_kind is null and v_digits is not null
         and i.client_id = s.client_id and i.activity_digits = v_digits
         and i.identity_status = 'resolved') al;

  v_canon := case
      when v_exact_id is not null and v_exact_status = 'resolved' then v_exact_id
      when v_kind is null and v_alias_n = 1 then v_alias_id
      else null end;
  v_status := case
      when v_exact_id is not null and v_exact_status = 'conflict' then 'ambiguous'
      when v_exact_id is not null then 'exact'
      when v_kind is not null then 'unresolved'
      when v_alias_n = 1 then 'resolved_activity'
      when v_alias_n > 1 then 'ambiguous'
      else 'unresolved' end;
  v_pub := coalesce(
      case when v_exact_status = 'resolved' then v_exact_pub else null end,
      case when v_alias_n = 1 then v_alias_pub else null end);
  v_reason := case
      when v_exact_id is not null and v_exact_status = 'conflict' then 'conflicting_identity_rows'
      when v_exact_id is not null then null
      when v_kind is not null then 'typed_urn_requires_exact_identity'
      when v_alias_n > 1 then 'multiple_activity_candidates'
      when v_alias_n = 0 then 'no_identity_candidate'
      else null end;
  v_age := case when v_pub is not null
      then round(extract(epoch from s.captured_at - v_pub) / 86400.0, 6) else null end;

  return query select
    s.id, s.client_id, s.post_social_id, s.cycle_id, s.captured_at,
    v_pub, v_age, s.actual_age_days,
    case when abs(v_age - 7::numeric) <= 1::numeric then 7
         when abs(v_age - 14::numeric) <= 1::numeric then 14
         else null::integer end,
    s.target_age_days,
    s.impressions, s.reactions, s.comments, s.shares, s.source, s.coverage,
    v_age is not null and (abs(v_age - 7::numeric) <= 1::numeric or abs(v_age - 14::numeric) <= 1::numeric),
    (v_status = any (array['exact'::text, 'resolved_activity'::text])) and v_age is not null
      and (abs(v_age - 7::numeric) <= 1::numeric or abs(v_age - 14::numeric) <= 1::numeric)
      and s.reactions is not null,
    v_canon, v_status, v_reason;
end $function$;

revoke all on function public.audn_snapshot_eligibility_one(bigint) from public, anon, authenticated;
grant execute on function public.audn_snapshot_eligibility_one(bigint) to service_role;

create or replace function public.editorial_project_audn_capture(p_id bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; sid text; val numeric; why text; payload jsonb;
declare veto text;
begin
  -- Serialize with the collector UPDATE row lock before reading the capture or
  -- conflict ledger; a concurrent replay must not quarantine zero projection rows
  -- between our conflict check and projection insertion.
  perform 1 from public.audn_post_metric_snapshots where id = p_id for update;
  if not found then return; end if;
  -- 2026-11-15: one-row lookup. audn_snapshot_eligibility_v resolves every snapshot
  -- row before filtering (~0.3 s per insert at 13k rows, growing with the table).
  select * into r from public.audn_snapshot_eligibility_one(p_id);
  if not found then return; end if;
  payload := jsonb_build_object('id',r.id,'client_id',r.client_id,'post_social_id',r.post_social_id,
    'cycle_id',r.cycle_id,'captured_at',r.captured_at,'impressions',r.impressions,
    'source',r.source,'coverage',r.coverage,'canonical_post_id',r.canonical_post_id,
    'resolution_status',r.resolution_status,'published_at',r.published_at);
  sid := 'audn:' || r.id::text || ':impressions:v1';
  if r.resolution_status not in ('exact','resolved_activity') or r.canonical_post_id is null then
    why := coalesce(r.unresolved_reason,'unresolved_publication_identity');
  elsif coalesce((r.coverage->>'impressions')::boolean,false) is not true then
    why := 'impressions_not_retained_by_source';
  elsif r.impressions is null then why := 'impressions_missing';
  elsif r.source not in (
    'n8n:F7JHoCI925eSTYar:unipile_post_snapshots',
    'n8n:WdeAmCTQ0ZH65mGs:unipile_post_tracker',
    'n8n:XMuGMZJlcF9pB3Db:own_post_performance_tracker',
    'n8n:rrprmLeoU0pjpEmq:unipile_performance_sync'
  ) then why := 'unreviewed_source_scope';
  else val := r.impressions; end if;
  if exists (select 1 from public.editorial_observation_conflicts c
      where c.client_id=r.client_id and c.source_snapshot_id=r.id
        and c.reconciliation_state='quarantined') then
    veto := 'conflicting_source_replay';
  end if;

  insert into public.editorial_outcome_snapshots
    (client_id,snapshot_id,brief_id,artifact_role,metric,observed_value,unknown_reason,
     denominator,scope,window_start,window_end,captured_at,event_definition,attribution,
     limitation,publication_id)
  values (r.client_id,sid,'retrospective:'||coalesce(r.canonical_post_id,r.post_social_id),
    'own_post','impressions',val,why,case when val is null then null else 'linkedin_impressions' end,
    'audn:'||r.source,r.published_at,r.captured_at,r.captured_at,
    'linkedin_impressions_at_captured_time_v1','direct',
    'Retrospective/unlinked retained capture; projection time is stored separately.',
    coalesce(r.canonical_post_id,r.post_social_id))
  on conflict (client_id,snapshot_id) do nothing;

  insert into public.editorial_observation_projection
    (client_id,source_snapshot_id,outcome_snapshot_id,native_post_id,canonical_post_id,source_payload_hash,
     eligibility_veto_reason)
  values (r.client_id,r.id,sid,r.post_social_id,r.canonical_post_id,md5(payload::text),veto)
  on conflict do nothing;
end $function$;

-- create or replace keeps the existing ACL (postgres, service_role); stated again so a fresh
-- database ends in the same place as db/206.
revoke all on function public.editorial_project_audn_capture(bigint) from public, anon, authenticated;
grant execute on function public.editorial_project_audn_capture(bigint) to service_role;

commit;
