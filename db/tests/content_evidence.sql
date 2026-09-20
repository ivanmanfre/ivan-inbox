-- Tests for db/103_content_evidence.sql. House style: one transaction, pg_temp.assert_true,
-- rollback at the end so the database is unchanged.
--
-- Prerequisites the migration does not create and this file does not either: client_registry,
-- lane_allowed(text) (db/088) and the anon/authenticated/service_role roles. Under Supabase they
-- already exist; under PGlite the harness creates them first (see the runner recorded in
-- OUTPUT/03-integration/db-harness.md).
--
-- Every fixture row is synthetic. No corpus text, no reactor identity, no client receipt.

begin;

create or replace function pg_temp.assert_true(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'assertion failed: %', p_message; end if;
end $$;

create or replace function pg_temp.assert_raises(p_sql text, p_message text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'assertion failed: % (statement succeeded and should not have)', p_message;
end $$;

-- Two tenants, both allowed lanes, so lane_allowed() is not what separates them.
insert into public.client_registry (client_id, display_name, is_active, platform) values
  ('t-alpha', 'Alpha', true,
   '{"measurement":{"roster":[{"account":"a1","role":"direct_competitor"}]}}'::jsonb),
  ('t-beta',  'Beta',  true,
   '{"measurement":{"roster":[{"account":"b1","role":"direct_competitor"}]}}'::jsonb),
  ('zz-selftest', 'Selftest', true,
   '{"measurement":{"roster":[{"account":"s1","role":"direct_competitor"}]}}'::jsonb)
on conflict (client_id) do nothing;

insert into public.client_research_studies
  (client_id, study_id, study_kind, method_version, state, observation_cutoff, content_sha256)
values
  ('t-alpha', 'st-1', 'market', 'test-v1', 'validated', '2026-09-01T00:00:00Z', 'alphahash'),
  ('t-beta',  'st-1', 'market', 'test-v1', 'validated', '2026-09-01T00:00:00Z', 'betahash');

insert into public.client_research_study_posts
  (client_id, study_id, canonical_source_id, source_url, author_id, published_at,
   first_captured_at, observed_metrics, population)
values
  ('t-alpha', 'st-1', 'urn:a1', 'https://example.org/a1', 'author-a', '2026-08-01T00:00:00Z',
   '2026-08-20T00:00:00Z', '{"likes":40,"reposts":0}'::jsonb, 'market'),
  ('t-alpha', 'st-1', 'urn:a2', 'https://example.org/a2', 'author-b', '2026-08-02T00:00:00Z',
   '2026-08-20T00:00:00Z', '{"likes":12,"reposts":0}'::jsonb, 'market'),
  ('t-beta',  'st-1', 'urn:b1', 'https://example.org/b1', 'author-z', '2026-08-03T00:00:00Z',
   '2026-08-20T00:00:00Z', '{"likes":99,"reposts":9}'::jsonb, 'market');

insert into public.client_research_study_posts
  (client_id, study_id, canonical_source_id, author_id, population, is_own_control,
   inclusion, exclusion_reason)
values
  ('t-alpha', 'st-1', 'urn:ctl-1', 'own-seat', 'own_control', true, 'excluded', 'own_control');

insert into public.client_research_findings
  (client_id, study_id, finding_id, kind, metric_id, observed_value, baseline_value, baseline_n,
   lift, formula, method_version, source_ids, validation_state)
values
  ('t-alpha', 'st-1', 'f1', 'market', 'public_weighted', 40, 10, 21, 4,
   'likes + 3 * reposts', 'test-v1', '["urn:a1"]'::jsonb, 'computed');

do $$
declare
  v_pack   jsonb;
  v_beta   jsonb;
  v_n      integer;
begin
  -- ------------------------------------------------------------------
  -- 1. anon cannot read the new tables at all.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(
    (select count(*) = 3 from pg_tables
      where schemaname = 'public'
        and tablename in ('client_research_studies', 'client_research_study_posts',
                          'client_research_findings')
        and rowsecurity),
    'RLS is enabled on all three evidence tables');

  perform pg_temp.assert_true(
    not has_table_privilege('anon', 'public.client_research_studies', 'select')
    and not has_table_privilege('anon', 'public.client_research_study_posts', 'select')
    and not has_table_privilege('anon', 'public.client_research_findings', 'select'),
    'anon has no select privilege on any evidence table');

  perform pg_temp.assert_true(
    not has_table_privilege('authenticated', 'public.client_research_studies', 'select')
    and not has_table_privilege('authenticated', 'public.client_research_study_posts', 'select')
    and not has_table_privilege('authenticated', 'public.client_research_findings', 'select'),
    'authenticated has no direct table access either; reads go through the function');

  perform pg_temp.assert_true(
    has_table_privilege('service_role', 'public.client_research_studies', 'select'),
    'service_role can read the studies table');

  -- The privilege is what blocks the read; prove it by attempting one as anon.
  perform pg_temp.assert_raises(
    'set local role anon; select 1 from public.client_research_studies limit 1',
    'anon select on client_research_studies is refused');
  reset role;

  -- ------------------------------------------------------------------
  -- 2. The service read is revoked from anon BY NAME (default privileges grant it otherwise).
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(
    not has_function_privilege('anon', 'public.content_evidence_pack(text, date)', 'execute'),
    'anon cannot execute content_evidence_pack');
  perform pg_temp.assert_true(
    not has_function_privilege('authenticated', 'public.content_evidence_pack(text, date)', 'execute'),
    'authenticated cannot execute the service-only reader');
  perform pg_temp.assert_true(
    has_function_privilege('service_role', 'public.content_evidence_pack(text, date)', 'execute'),
    'service_role can execute content_evidence_pack');

  -- ------------------------------------------------------------------
  -- 3. Cross-tenant negative control: one exact client, and nothing of the other's.
  -- ------------------------------------------------------------------
  v_pack := public.content_evidence_pack('t-alpha', date '2026-09-21');
  v_beta := public.content_evidence_pack('t-beta',  date '2026-09-21');

  perform pg_temp.assert_true(v_pack->>'client_id' = 't-alpha', 'the pack answers for the client asked for');
  perform pg_temp.assert_true(jsonb_array_length(v_pack->'posts') = 2,
    't-alpha sees exactly its own two market posts');
  perform pg_temp.assert_true(
    not (v_pack::text like '%urn:b1%') and not (v_pack::text like '%author-z%'),
    'no t-beta row, id or author appears anywhere in the t-alpha pack');
  perform pg_temp.assert_true(
    not (v_beta::text like '%urn:a1%') and not (v_beta::text like '%urn:a2%'),
    'no t-alpha row appears anywhere in the t-beta pack');
  perform pg_temp.assert_true(jsonb_array_length(v_beta->'findings') = 0,
    't-beta has no findings of its own and does not borrow alpha''s');

  -- A lane that does not exist is refused, not answered with an empty pack.
  perform pg_temp.assert_raises(
    'select public.content_evidence_pack(''t-nobody'', date ''2026-09-21'')',
    'an unknown seat is refused');
  perform pg_temp.assert_raises(
    'select public.content_evidence_pack(null, date ''2026-09-21'')',
    'a null client is refused');

  -- lane_allowed passes for the selftest lane; scope still refuses it.
  perform pg_temp.assert_true(public.lane_allowed('zz-selftest'),
    'lane_allowed returns TRUE for the selftest lane, so it is authorization and not scope');
  perform pg_temp.assert_raises(
    'select public.content_evidence_pack(''zz-selftest'', date ''2026-09-21'')',
    'the selftest lane has no evidence population');

  -- ------------------------------------------------------------------
  -- 4. Own controls are counted, never mixed into the market population.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true((v_pack->>'own_controls')::int = 1,
    'the own control is counted separately');
  perform pg_temp.assert_true(not (v_pack->'posts')::text like '%urn:ctl-1%',
    'the own control is not in the market post list');
  perform pg_temp.assert_raises(
    'insert into public.client_research_study_posts
       (client_id, study_id, canonical_source_id, population, is_own_control)
     values (''t-alpha'', ''st-1'', ''urn:ctl-bad'', ''market'', true)',
    'an own-control row cannot be stored in the market population');

  -- ------------------------------------------------------------------
  -- 5. Re-running the import is idempotent: the key is the identity.
  -- ------------------------------------------------------------------
  insert into public.client_research_study_posts
    (client_id, study_id, canonical_source_id, source_url, author_id, published_at,
     first_captured_at, observed_metrics, population)
  values
    ('t-alpha', 'st-1', 'urn:a1', 'https://example.org/a1', 'author-a', '2026-08-01T00:00:00Z',
     '2026-08-27T00:00:00Z', '{"likes":61,"reposts":1}'::jsonb, 'market')
  on conflict (client_id, study_id, canonical_source_id) do nothing;

  select count(*) into v_n from public.client_research_study_posts
   where client_id = 't-alpha' and study_id = 'st-1' and canonical_source_id = 'urn:a1';
  perform pg_temp.assert_true(v_n = 1,
    'a second capture of the same post creates no second post row');

  select count(*) into v_n from public.client_research_study_posts
   where client_id = 't-alpha' and study_id = 'st-1' and population = 'market';
  perform pg_temp.assert_true(v_n = 2, 'the market population is unchanged by the reimport');

  perform pg_temp.assert_true(
    (public.content_evidence_pack('t-alpha', date '2026-09-21')->'posts') = (v_pack->'posts'),
    'the pack is byte-identical after an idempotent reimport');

  insert into public.client_research_findings
    (client_id, study_id, finding_id, kind, metric_id, observed_value, baseline_value, baseline_n,
     lift, formula, method_version, source_ids, validation_state)
  values
    ('t-alpha', 'st-1', 'f1', 'market', 'public_weighted', 40, 10, 21, 4,
     'likes + 3 * reposts', 'test-v1', '["urn:a1"]'::jsonb, 'computed')
  on conflict (client_id, study_id, finding_id) do nothing;
  select count(*) into v_n from public.client_research_findings
   where client_id = 't-alpha' and study_id = 'st-1';
  perform pg_temp.assert_true(v_n = 1, 'a reimported finding creates no duplicate');

  -- ------------------------------------------------------------------
  -- 6. A foreign-tenant row is rejected outright.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_raises(
    'insert into public.client_research_study_posts
       (client_id, study_id, canonical_source_id, population)
     values (''t-beta'', ''st-1-alpha-only'', ''urn:x'', ''market'')',
    'a post pointing at a study that does not exist for that tenant is rejected');

  perform pg_temp.assert_raises(
    'insert into public.client_research_study_posts
       (client_id, study_id, canonical_source_id, population)
     values (''t-gamma'', ''st-1'', ''urn:y'', ''market'')',
    'a post for a tenant with no study of that id is rejected by the composite foreign key');

  perform pg_temp.assert_raises(
    'insert into public.client_research_findings
       (client_id, study_id, finding_id, kind, metric_id, formula, method_version, source_ids)
     values (''t-gamma'', ''st-1'', ''f-x'', ''market'', ''m'', ''f'', ''v'', ''["urn:a1"]''::jsonb)',
    'a finding for a foreign tenant is rejected by the composite foreign key');

  -- ------------------------------------------------------------------
  -- 7. The contract rules the schema enforces on its own.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_raises(
    'insert into public.client_research_studies
       (client_id, study_id, study_kind, method_version, state, observation_cutoff,
        unresolved_discrepancies)
     values (''t-alpha'', ''st-bad'', ''market'', ''v1'', ''validated'',
             ''2026-09-01T00:00:00Z'', ''[{"metric_id":"public_weighted"}]''::jsonb)',
    'a study cannot be validated while a numerical discrepancy is unresolved');

  perform pg_temp.assert_true(
    (select jsonb_array_length(unresolved_discrepancies) = 0
       from public.client_research_studies
      where client_id = 't-alpha' and study_id = 'st-1'),
    'the validated fixture study genuinely carries no unresolved discrepancy');

  perform pg_temp.assert_raises(
    'insert into public.client_research_study_posts
       (client_id, study_id, canonical_source_id, population, inclusion)
     values (''t-alpha'', ''st-1'', ''urn:noreason'', ''excluded'', ''excluded'')',
    'an excluded post without a reason is rejected');

  perform pg_temp.assert_raises(
    'insert into public.client_research_findings
       (client_id, study_id, finding_id, kind, metric_id, observed_value, baseline_value,
        formula, method_version, source_ids)
     values (''t-alpha'', ''st-1'', ''f-nolift'', ''market'', ''public_weighted'', 40, 10,
             ''likes'', ''v1'', ''["urn:a1"]''::jsonb)',
    'a market finding over a positive baseline must carry its lift');

  -- A zero baseline gives no finite multiplier, so a null lift is correct there.
  insert into public.client_research_findings
    (client_id, study_id, finding_id, kind, metric_id, observed_value, baseline_value, baseline_n,
     lift, formula, method_version, source_ids)
  values
    ('t-alpha', 'st-1', 'f-zerobase', 'market', 'public_weighted', 40, 0, 21, null,
     'likes + 3 * reposts', 'test-v1', '["urn:a2"]'::jsonb);
  perform pg_temp.assert_true(true, 'a zero baseline stores a null lift rather than infinity');

  perform pg_temp.assert_raises(
    'insert into public.client_research_findings
       (client_id, study_id, finding_id, kind, metric_id, formula, method_version, source_ids)
     values (''t-alpha'', ''st-1'', ''f-pat'', ''pattern'', ''m'', ''f'', ''v'', ''["urn:a1"]''::jsonb)',
    'a pattern finding without comparators is rejected');

  perform pg_temp.assert_raises(
    'insert into public.client_research_findings
       (client_id, study_id, finding_id, kind, metric_id, formula, method_version, source_ids)
     values (''t-alpha'', ''st-1'', ''f-aud'', ''audience'', ''m'', ''f'', ''v'', ''["urn:a1"]''::jsonb)',
    'an audience finding without sample method, size, unknowns and classifier version is rejected');

  perform pg_temp.assert_raises(
    'insert into public.client_research_findings
       (client_id, study_id, finding_id, kind, metric_id, formula, method_version, source_ids)
     values (''t-alpha'', ''st-1'', ''f-empty'', ''market'', ''m'', ''f'', ''v'', ''[]''::jsonb)',
    'a finding with no source id is rejected');

  -- ------------------------------------------------------------------
  -- 8. A client with no validated study gets a stated gap, not a silent zero.
  -- ------------------------------------------------------------------
  update public.client_research_studies set state = 'needs_reconciliation'
   where client_id = 't-beta' and study_id = 'st-1';
  v_beta := public.content_evidence_pack('t-beta', date '2026-09-21');
  perform pg_temp.assert_true(v_beta->'study' = 'null'::jsonb,
    'an unreconciled study is not served as a validated one');
  perform pg_temp.assert_true(
    (v_beta->'coverage'->>'validated_market_study')::boolean = false
    and jsonb_array_length(v_beta->'missing_inputs') = 1,
    'the gap is named in missing_inputs instead of returning an empty success');

  raise notice 'content_evidence: all assertions passed';
end $$;

rollback;
