-- Proof queries for 20261115a. Run through the Supabase Management API (one call per block).
-- Every block is read-only or ends in ROLLBACK. Results recorded 2026-11-15 are in the comments.
-- "<helper>" = the function from the migration; in blocks 1 and 2 create it in schema pg_temp.

-- ============================================================================================
-- 1. PARITY ON EVERY REAL ROW, ALL 21 COLUMNS (before the migration).
--    Replace __C__ / __M__ / __R__ : arch 1 0, swishdm 1 0, ivan 1 0, risedtc 3 {0,1,2}.
--    Result: 13,673 rows, rows_differ 0, only_new 0, only_old 0;
--            eligible on both 699, not eligible on both 12,974, disagree 0 / 0;
--            resolved on both 13,551, unresolved on both 122, mismatch 0.
-- ============================================================================================
-- <helper in pg_temp>
with old as materialized (select * from audn_snapshot_eligibility_v where client_id = '__C__' and id % __M__ = __R__),
new as materialized (select f.* from audn_post_metric_snapshots s cross join lateral pg_temp.audn_snapshot_eligibility_one(s.id) f where s.client_id = '__C__' and s.id % __M__ = __R__),
j as (select o.id oid, n.id nid, (o.*)::text is distinct from (n.*)::text as differs,
        o.eligible_for_rank oe, n.eligible_for_rank ne,
        (o.resolution_status in ('exact','resolved_activity') and o.canonical_post_id is not null) ores,
        (n.resolution_status in ('exact','resolved_activity') and n.canonical_post_id is not null) nres
      from old o full join new n on o.id = n.id)
select '__C__' client, __R__ part, count(*) total, count(*) filter (where oid is null) only_new, count(*) filter (where nid is null) only_old,
  count(*) filter (where differs) rows_differ,
  count(*) filter (where oe and ne) elig_both, count(*) filter (where not oe and not ne) inelig_both,
  count(*) filter (where oe and not ne) old_elig_new_not, count(*) filter (where not oe and ne) new_elig_old_not,
  count(*) filter (where ores and nres) resolved_both, count(*) filter (where not ores and not nres) unresolved_both,
  count(*) filter (where ores is distinct from nres) resolved_mismatch
from j;

-- ============================================================================================
-- 2. CONTROLLED FIXTURES, ALL 21 COLUMNS, ROLLED BACK.
--    Typed identity conflict, untyped id with an exact identity, exact identity with no publish
--    time, one alias, one alias with no publish time, two aliases, no identity, typed urn with no
--    identity, non-urn id, unknown client, reactions missing, and capture times on both sides of
--    every age boundary (5d23:59:59, 6d, 7d, 7d+1s, 8d, 8d+1s, 12d23:59:59, 13d, 14d, 15d, 15d+1s)
--    plus one before publication.
--    Result: 30 rows, differ 0; eligible on both 8, not eligible on both 22; branches identical:
--            exact 14, resolved_activity 3, conflicting_identity_rows 5, multiple_activity_candidates 2,
--            no_identity_candidate 3, typed_urn_requires_exact_identity 3.
-- ============================================================================================
-- -- Controlled fixtures, every one compared on all 21 columns, rolled back.
-- update client_post_metrics set published_at='2026-01-01T00:00:00Z' where client_id='ivan' and social_id='urn:li:activity:7526581467863420928'; -- typed identity conflict
-- insert into client_post_metrics (client_id, social_id, published_at, post_url) values
--  ('synthco','8000000000000000001','2026-10-01T00:00:00Z',null),                                                   -- untyped id, exact identity
--  ('synthco','urn:li:activity:8000000000000000002',null,null),                                                     -- exact identity, no publish time
--  ('synthco','urn:li:ugcPost:8000000000000000003','2026-10-01T00:00:00Z','https://www.linkedin.com/posts/x-activity-8000000000000000033-ab'), -- one alias
--  ('synthco','urn:li:ugcPost:8000000000000000004',null,'https://www.linkedin.com/feed/update/urn:li:activity:8000000000000000044/'),          -- one alias, no publish time
--  ('synthco','urn:li:ugcPost:8000000000000000005','2026-10-01T00:00:00Z','https://www.linkedin.com/posts/x-activity-8000000000000000055-ab'), -- two aliases
--  ('synthco','urn:li:share:8000000000000000006','2026-10-02T00:00:00Z','https://www.linkedin.com/posts/y-activity-8000000000000000055-cd');
-- insert into audn_post_metric_snapshots (client_id, post_social_id, cycle_id, captured_at, impressions, reactions, source, coverage)
-- select c, sid, 'synth:fx:'||row_number() over (), cap::timestamptz, 10, rx, 'synth', '{"impressions":true}'::jsonb from (values
--  ('ivan','urn:li:activity:9999999999999999999','2026-11-15T12:00:00Z',1),
--  ('ivan','7508148372348776449','2026-11-15T12:00:00Z',1),
--  ('ivan','not-a-urn','2026-11-15T12:00:00Z',1),
--  ('nobody','urn:li:activity:7526581467863420928','2026-11-15T12:00:00Z',1),
--  ('ivan','urn:li:activity:7526581467863420928','2026-11-15T12:00:00Z',null),
--  ('ivan','7526581467863420928','2026-11-15T12:00:00Z',1),
--  ('ivan','urn:li:ugcPost:7508148372348776449','2026-11-15T12:00:00Z',1),
--  ('synthco','urn:li:activity:8000000000000000002','2026-10-08T00:00:00Z',1),
--  ('synthco','8000000000000000033','2026-10-08T00:00:00Z',1),
--  ('synthco','8000000000000000033','2026-10-15T00:00:00Z',null),
--  ('synthco','8000000000000000044','2026-10-08T00:00:00Z',1),
--  ('synthco','8000000000000000055','2026-10-08T00:00:00Z',1),
--  ('synthco','urn:li:ugcPost:8000000000000000003','2026-10-08T00:00:00Z',1),
--  ('synthco','8000000000000000099','2026-10-08T00:00:00Z',1),
--  ('synthco','8000000000000000001','2026-09-30T00:00:00Z',1),
--  ('synthco','8000000000000000001','2026-10-06T23:59:59Z',1),
--  ('synthco','8000000000000000001','2026-10-07T00:00:00Z',1),
--  ('synthco','8000000000000000001','2026-10-08T00:00:00Z',1),
--  ('synthco','8000000000000000001','2026-10-08T00:00:01Z',null),
--  ('synthco','8000000000000000001','2026-10-09T00:00:00Z',1),
--  ('synthco','8000000000000000001','2026-10-09T00:00:01Z',1),
--  ('synthco','8000000000000000001','2026-10-13T23:59:59Z',1),
--  ('synthco','8000000000000000001','2026-10-14T00:00:00Z',1),
--  ('synthco','8000000000000000001','2026-10-15T00:00:00Z',1),
--  ('synthco','8000000000000000001','2026-10-16T00:00:00Z',1),
--  ('synthco','8000000000000000001','2026-10-16T00:00:01Z',1)
-- ) v(c,sid,cap,rx);
-- with ids as (select id from audn_post_metric_snapshots where cycle_id like 'synth:fx:%' or (client_id='ivan' and post_social_id='urn:li:activity:7526581467863420928')),
-- old as materialized (select v.* from audn_snapshot_eligibility_v v where v.id in (select id from ids)),
-- new as materialized (select f.* from ids cross join lateral pg_temp.audn_snapshot_eligibility_one(ids.id) f)
-- select count(*) total, count(*) filter (where (o.*)::text is distinct from (n.*)::text or o.id is null or n.id is null) differ,
--   count(*) filter (where o.eligible_for_rank and n.eligible_for_rank) elig_both, count(*) filter (where not o.eligible_for_rank and not n.eligible_for_rank) inelig_both,
--   count(*) filter (where o.published_at is null) null_publish_time, count(*) filter (where o.target_age_days = 7) age7, count(*) filter (where o.target_age_days = 14) age14, count(*) filter (where o.actual_age_days < 0) negative_age,
--   (select json_object_agg(k, c) from (select o2.resolution_status||'/'||coalesce(o2.unresolved_reason,'-') k, count(*) c from old o2 group by 1) z) old_branches,
--   (select json_object_agg(k, c) from (select n2.resolution_status||'/'||coalesce(n2.unresolved_reason,'-') k, count(*) c from new n2 group by 1) z) new_branches
-- from old o full join new n on o.id=n.id;
-- rollback;

-- ============================================================================================
-- 3. TRIGGER A/B IN ONE TRANSACTION (old function, then new function, same rows, rolled back).
--    118 real posts across all 4 clients + 7 synthetic rows. Compares what each trigger wrote
--    (editorial_outcome_snapshots + editorial_observation_projection).
--    Result: pairs 125, unpaired 0, outputs_differ 0, value on both 69, no value on both 56.
-- ============================================================================================
-- begin; <ab_insert tag old>; <helper + new capture function>; <ab_insert tag new>; <comparison>; rollback;
-- ab_insert:
--   insert into public.audn_post_metric_snapshots (client_id, post_social_id, cycle_id, captured_at, impressions, reactions, comments, shares, source, coverage)
--   select client_id, post_social_id, 'ab-test:__TAG__', '2026-11-15T12:00:00Z', impressions, reactions, comments, shares, source, coverage
--   from (select distinct on (client_id, post_social_id) * from public.audn_post_metric_snapshots where client_id in ('risedtc','ivan','arch','swishdm') and cycle_id not like 'ab-test:%' order by client_id, post_social_id, id desc) x
--   where (hashtext(post_social_id) % 4) = 0;
--   insert into public.audn_post_metric_snapshots (client_id, post_social_id, cycle_id, captured_at, impressions, reactions, source, coverage) values
--    ('ivan','urn:li:activity:9999999999999999999','ab-test:__TAG__','2026-11-15T12:00:00Z',10,1,'synth','{"impressions":true}'),
--    ('ivan','7508148372348776449','ab-test:__TAG__','2026-11-15T12:00:00Z',10,1,'n8n:XMuGMZJlcF9pB3Db:own_post_performance_tracker','{"impressions":true}'),
--    ('ivan','not-a-urn','ab-test:__TAG__','2026-11-15T12:00:00Z',10,1,'synth','{"impressions":true}'),
--    ('nobody','urn:li:activity:7526581467863420928','ab-test:__TAG__','2026-11-15T12:00:00Z',10,1,'synth','{"impressions":true}'),
--    ('ivan','urn:li:activity:7526581467863420928','ab-test:__TAG__','2026-11-15T12:00:00Z',null,null,'n8n:XMuGMZJlcF9pB3Db:own_post_performance_tracker','{"impressions":false}'),
--    ('ivan','urn:li:ugcPost:7508148372348776449','ab-test:__TAG__','2026-11-15T12:00:00Z',10,1,'synth','{"impressions":true}'),
--    ('risedtc','99999999999999999999','ab-test:__TAG__','2026-11-15T12:00:00Z',10,1,'n8n:WdeAmCTQ0ZH65mGs:unipile_post_tracker','{"impressions":true}');
-- comparison:
--   with w as (
--     select s.cycle_id, s.client_id, s.post_social_id,
--       o.observed_value, o.unknown_reason, o.denominator, o.scope, o.window_start, o.window_end, o.brief_id, o.publication_id,
--       p.native_post_id, p.canonical_post_id, p.eligibility_veto_reason, (p.source_snapshot_id is not null) has_proj, (o.snapshot_id is not null) has_outcome
--     from public.audn_post_metric_snapshots s
--     left join public.editorial_outcome_snapshots o on o.client_id = s.client_id and o.snapshot_id = 'audn:'||s.id||':impressions:v1'
--     left join public.editorial_observation_projection p on p.client_id = s.client_id and p.source_snapshot_id = s.id
--     where s.cycle_id in ('ab-test:old','ab-test:new')
--   ), a as (select * from w where cycle_id='ab-test:old'), b as (select * from w where cycle_id='ab-test:new')
--   select count(*) pairs, count(*) filter (where a.post_social_id is null or b.post_social_id is null) unpaired,
--     count(*) filter (where (to_jsonb(a) - 'cycle_id') is distinct from (to_jsonb(b) - 'cycle_id')) outputs_differ,
--     count(*) filter (where a.observed_value is not null and b.observed_value is not null) value_both,
--     count(*) filter (where a.observed_value is null and b.observed_value is null) no_value_both,
--     count(*) filter (where (a.observed_value is null) <> (b.observed_value is null)) value_mismatch,
--     count(*) filter (where a.has_proj and b.has_proj) proj_both, count(*) filter (where a.has_outcome and b.has_outcome) outcome_both,
--     (select json_object_agg(coalesce(unknown_reason,'(has value)'), n) from (select unknown_reason, count(*) n from b group by 1) z) new_reasons,
--     (select json_object_agg(coalesce(unknown_reason,'(has value)'), n) from (select unknown_reason, count(*) n from a group by 1) z) old_reasons
--   from a full join b on a.client_id=b.client_id and a.post_social_id=b.post_social_id;
--   rollback;

-- ============================================================================================
-- 4. TIMING THE WAY THE TRACKERS HIT IT (PostgREST = service_role + 8 s statement timeout).
--    The Management API runs as postgres with no timeout, so the role and timeout are set here.
--    Old function: 100 rows -> "canceling statement due to statement timeout"; 10 rows -> 2.8 s.
--    New function: risedtc 100 rows 1.297 s (60 untyped ids), ivan 100 rows 0.772 s,
--                  arch 23 rows 0.141 s, swishdm 19 rows 0.097 s. Every row got its projection.
-- ============================================================================================
-- begin; <for the new path: helper + new capture function from the migration>
-- select set_config('t.t0', clock_timestamp()::text, true);
-- set local role service_role;
-- set local statement_timeout = '8s';
-- insert into public.audn_post_metric_snapshots (client_id, post_social_id, cycle_id, captured_at, impressions, reactions, comments, shares, source, coverage)
-- select client_id, post_social_id, 'timing-test:20261115:__C__', now(), impressions, reactions, comments, shares, source, coverage
-- from (select distinct on (post_social_id) * from public.audn_post_metric_snapshots where client_id = '__C__' order by post_social_id, id desc) x
-- order by id desc limit __N__
-- on conflict (client_id, post_social_id, cycle_id) do update set captured_at = excluded.captured_at;
-- reset role;
-- select '__C__' client, '__MODE__' mode,
--   round(extract(epoch from clock_timestamp() - current_setting('t.t0')::timestamptz)::numeric, 3) insert_secs,
--   (select count(*) from public.audn_post_metric_snapshots where cycle_id = 'timing-test:20261115:__C__') rows_inserted,
--   (select count(*) filter (where audn_urn_kind(post_social_id) is null) from public.audn_post_metric_snapshots where cycle_id = 'timing-test:20261115:__C__') untyped_rows,
--   (select count(*) from public.editorial_observation_projection p join public.audn_post_metric_snapshots s on s.id = p.source_snapshot_id where s.cycle_id = 'timing-test:20261115:__C__') projections,
--   (select count(*) from public.editorial_outcome_snapshots o join public.audn_post_metric_snapshots s on o.snapshot_id = 'audn:'||s.id||':impressions:v1' where s.cycle_id = 'timing-test:20261115:__C__' and o.observed_value is not null) outcomes_with_value;
-- rollback;
