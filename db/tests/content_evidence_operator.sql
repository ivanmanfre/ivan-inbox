-- Tests for db/104_operator_content_evidence.sql. House style, matching db/tests/content_evidence
-- .sql: one transaction, pg_temp.assert_true, rollback at the end so the database is unchanged.
--
-- Prerequisites neither migration creates and this file does not either: client_registry,
-- lane_allowed(text) (db/088), operator_gate_ok(text), ops_drafts, client_post_metrics and the
-- anon/authenticated/service_role roles. Under Supabase they already exist; under PGlite the
-- runner creates stand-ins first (automation/content-evidence/release/sql-tests.mjs).
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
  ('o-alpha', 'Alpha', true,
   '{"measurement":{"roster":[{"account":"a1","role":"direct_competitor"}]}}'::jsonb),
  ('o-beta',  'Beta',  true,
   '{"measurement":{"roster":[{"account":"b1","role":"direct_competitor"}]}}'::jsonb),
  ('zz-selftest', 'Selftest', true,
   '{"measurement":{"roster":[{"account":"s1","role":"direct_competitor"}]}}'::jsonb)
on conflict (client_id) do nothing;

-- Alpha: one validated market study, three market posts from two authors, one own control, three
-- market findings. Beta: its own study with one post and one finding, so a leak is visible.
insert into public.client_research_studies
  (client_id, study_id, study_kind, method_version, state, manifest, publication_window_from,
   publication_window_to, observation_cutoff, missing_inputs, content_sha256)
values
  ('o-alpha', 'm-1', 'market', 'test-v2', 'validated',
   '{"author_directory":{"auth-a":"Author A","auth-b":"Author B"}}'::jsonb,
   '2026-01-01', '2026-08-01', now() - interval '1 day',
   '["capture ages are unmatched, so observed values are not age comparable"]'::jsonb, 'alphahash'),
  ('o-beta',  'm-1', 'market', 'test-v2', 'needs_reconciliation',
   '{}'::jsonb, '2026-01-01', '2026-08-01', now() - interval '1 day',
   '[]'::jsonb, 'betahash');

-- Alpha also has an own study, so the two winner sections are genuinely two populations.
insert into public.client_research_studies
  (client_id, study_id, study_kind, method_version, state, observation_cutoff)
values ('o-alpha', 'own-1', 'own', 'test-v2', 'validated', now() - interval '1 day');

insert into public.client_research_study_posts
  (client_id, study_id, canonical_source_id, source_url, author_id, published_at,
   first_captured_at, last_captured_at, post_text, observed_metrics, population)
values
  ('o-alpha', 'm-1', 'urn:a1', 'https://example.org/a1', 'auth-a', '2026-07-01T00:00:00Z',
   '2026-07-05T00:00:00Z', '2026-07-05T00:00:00Z', E'alpha first line\nalpha second line',
   '{"likes":400,"reposts":0}'::jsonb, 'market'),
  ('o-alpha', 'm-1', 'urn:a2', 'https://example.org/a2', 'auth-b', '2026-06-01T00:00:00Z',
   '2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z', 'alpha two body',
   '{"likes":300,"reposts":0}'::jsonb, 'market'),
  ('o-alpha', 'm-1', 'urn:a3', 'https://example.org/a3', 'auth-b', '2026-05-01T00:00:00Z',
   '2026-05-05T00:00:00Z', '2026-05-05T00:00:00Z', 'alpha three body',
   '{"likes":200,"reposts":0}'::jsonb, 'market'),
  ('o-beta',  'm-1', 'urn:b1', 'https://example.org/b1', 'auth-z', '2026-07-01T00:00:00Z',
   '2026-07-05T00:00:00Z', '2026-07-05T00:00:00Z', 'beta body',
   '{"likes":900,"reposts":9}'::jsonb, 'market');

-- One own control for alpha. It is counted and it never joins the market population.
insert into public.client_research_study_posts
  (client_id, study_id, canonical_source_id, author_id, post_text, observed_metrics,
   population, is_own_control, inclusion, exclusion_reason)
values
  ('o-alpha', 'm-1', 'urn:ctl', 'own-seat', 'our own control post', '{"likes":9999}'::jsonb,
   'own_control', true, 'excluded', 'own_control');

-- The own study's own post, so an own_result finding has something to point at.
insert into public.client_research_study_posts
  (client_id, study_id, canonical_source_id, author_id, published_at, post_text,
   observed_metrics, population, is_own_control, inclusion, exclusion_reason)
values
  ('o-alpha', 'own-1', 'urn:own1', 'own-seat', '2026-08-01T00:00:00Z', 'our own published post',
   '{"reach":1200}'::jsonb, 'own_control', true, 'excluded', 'own_control');

insert into public.client_research_findings
  (client_id, study_id, finding_id, kind, metric_id, observed_value, baseline_value, baseline_n,
   lift, formula, method_version, source_ids, limitations, validation_state)
values
  ('o-alpha', 'm-1', 'f1', 'market', 'public_weighted', 400, 50, 24, 8,
   'likes + 3 * reposts', 'test-v2', '["urn:a1"]'::jsonb,
   '["retrospective descriptive attention only"]'::jsonb, 'computed'),
  ('o-alpha', 'm-1', 'f2', 'market', 'public_weighted', 300, 50, 24, 6,
   'likes + 3 * reposts', 'test-v2', '["urn:a2"]'::jsonb, '[]'::jsonb, 'computed'),
  ('o-alpha', 'm-1', 'f3', 'market', 'public_weighted', 200, 50, 24, 4,
   'likes + 3 * reposts', 'test-v2', '["urn:a3"]'::jsonb, '[]'::jsonb, 'computed'),
  ('o-beta',  'm-1', 'fb1', 'market', 'public_weighted', 900, 50, 24, 18,
   'likes + 3 * reposts', 'test-v2', '["urn:b1"]'::jsonb, '[]'::jsonb, 'computed');

insert into public.client_research_findings
  (client_id, study_id, finding_id, kind, metric_id, observed_value, baseline_value, baseline_n,
   lift, formula, method_version, source_ids, validation_state)
values
  ('o-alpha', 'own-1', 'fo1', 'own_result', 'reach', 1200, 800, 21, null,
   'reach', 'test-v2', '["urn:own1"]'::jsonb, 'computed');

-- Three weekly shortlist rows for alpha. THE PACKAGE SHAPE BELOW IS THE WRITER'S REAL ONE, copied
-- from $OUT/EVIDENCE-PACKAGE-SHAPE.json (which automation/weekly-topics/writer.js generated from
-- its own save path), not a shape this test invented: top level of context, sibling of audn,
-- client_fact_refs as {source_id, kind, label} objects, needs_material a string reason or null,
-- label carrying 'evidence_backed' or 'experiment', experiment_reason present only on the latter.
-- Row k1 is an evidence_backed row with one resolved client fact. Row k2 is an experiment with
-- none. Row k3 is the OLDER nested shape, kept so the reader's fallback path is exercised too.
insert into public.ops_drafts (client_id, kind, body, context, created_at)
values
  ('o-alpha', 'audn_recommendation', 'body one',
   jsonb_build_object(
     'cycle_id', 'weekly:2026-09-28',
     'audn', jsonb_build_object(
       'title', 'A concrete topic',
       'weekly', jsonb_build_object('week_start', '2026-09-28', 'topic_key', 'k1')),
     'evidence_package', jsonb_build_object(
       'schema_version', 1,
       'source_finding_ids', jsonb_build_array('f1'),
       'source_posts', jsonb_build_array('urn:a1'),
       'client_fact_refs', jsonb_build_array(jsonb_build_object(
         'source_id', 'founder-1',
         'kind', 'authorized_call_transcript',
         'label', 'We review every proposed reply before anyone can send it.')),
       'objective', 'attention_reach',
       'test_metric', 'weighted reactions at 7 and 14 days against the account''s own usual',
       'metric_id', 'new-policy-v1',
       'comparison_rule', 'author_own_baseline_multiple',
       'observation_window', jsonb_build_object('days', 7),
       'adaptation_history', '[]'::jsonb,
       'needs_material', null,
       'limitations', jsonb_build_array('Descriptive, not causal.'),
       'label', 'evidence_backed')),
   now() - interval '3 hours'),
  ('o-alpha', 'audn_recommendation', 'body two',
   jsonb_build_object(
     'cycle_id', 'weekly:2026-09-28',
     'audn', jsonb_build_object(
       'title', 'A second topic',
       'weekly', jsonb_build_object('week_start', '2026-09-28', 'topic_key', 'k2')),
     'evidence_package', jsonb_build_object(
       'schema_version', 1,
       'source_finding_ids', '[]'::jsonb,
       'source_posts', '[]'::jsonb,
       'client_fact_refs', '[]'::jsonb,
       'objective', 'buyer_response',
       'test_metric', 'weighted reactions at 7 and 14 days against the account''s own usual',
       'metric_id', null,
       'comparison_rule', 'author_own_baseline_multiple',
       'observation_window', jsonb_build_object('days', 7),
       'adaptation_history', '[]'::jsonb,
       'needs_material', 'no permitted client material is available for this source; source-only, transferability unresolved',
       'limitations', jsonb_build_array('Source-only example with unresolved transferability.'),
       'label', 'experiment',
       'experiment_reason', 'Unsupported by the measured floor: lift 0.20 is below the production floor of 4. Offered as a test.')),
   now() - interval '2 hours'),
  ('o-alpha', 'audn_recommendation', 'body three',
   jsonb_build_object(
     'cycle_id', 'weekly:2026-09-28',
     'audn', jsonb_build_object(
       'title', 'A third topic under the older shape',
       'weekly', jsonb_build_object('week_start', '2026-09-28', 'topic_key', 'k3'),
       'evidence_package', jsonb_build_object(
         'schema_version', 1,
         'source_finding_ids', jsonb_build_array('f2'),
         'client_fact_refs', '[]'::jsonb,
         'objective', 'conversion',
         'needs_material', '[]'::jsonb,
         'label', 'evidence_backed'))),
   now() - interval '1 hour');

-- Beta gets its own shortlist row so a leak in either direction is visible.
insert into public.ops_drafts (client_id, kind, body, context, created_at)
values
  ('o-beta', 'audn_recommendation', 'beta body',
   jsonb_build_object('cycle_id', 'weekly:2026-09-28', 'audn', jsonb_build_object(
     'title', 'Beta only topic',
     'weekly', jsonb_build_object('week_start', '2026-09-28', 'topic_key', 'bk1'))),
   now() - interval '1 hour');

do $$
declare
  v_alpha  jsonb;
  v_beta   jsonb;
  v_rec    uuid;
  v_pub    uuid;
  v_n      integer;
begin
  -- ------------------------------------------------------------------
  -- 1. Grants: the browser role can call it, anon cannot, and no table opened up.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(
    not has_function_privilege('anon', 'public.operator_content_evidence(text, text)', 'execute'),
    'anon cannot execute operator_content_evidence');
  perform pg_temp.assert_true(
    has_function_privilege('authenticated', 'public.operator_content_evidence(text, text)', 'execute'),
    'authenticated can execute the gated reader, exactly like operator_market_outliers');
  perform pg_temp.assert_true(
    has_function_privilege('service_role', 'public.operator_content_evidence(text, text)', 'execute'),
    'service_role can execute the gated reader');
  perform pg_temp.assert_true(
    not has_table_privilege('anon', 'public.client_research_studies', 'select')
    and not has_table_privilege('authenticated', 'public.client_research_findings', 'select'),
    '104 opened no direct table access to anon or authenticated');

  -- ------------------------------------------------------------------
  -- 2. The gate is checked before anything else.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_raises(
    'select public.operator_content_evidence(''wrong-gate'', ''o-alpha'')',
    'a wrong gate is refused');
  perform pg_temp.assert_raises(
    'select public.operator_content_evidence(null, ''o-alpha'')',
    'a null gate is refused');
  -- A wrong gate is refused even for a lane that does not exist, so the gate is not reachable
  -- around by guessing a tenant.
  perform pg_temp.assert_raises(
    'select public.operator_content_evidence(''wrong-gate'', ''o-nobody'')',
    'a wrong gate is refused before the tenant is even considered');

  -- ------------------------------------------------------------------
  -- 3. The tenant parameter is mandatory and exact.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_raises(
    'select public.operator_content_evidence(''clientops'', null)',
    'a null client is refused');
  perform pg_temp.assert_raises(
    'select public.operator_content_evidence(''clientops'', ''   '')',
    'a blank client is refused');
  perform pg_temp.assert_raises(
    'select public.operator_content_evidence(''clientops'', ''o-nobody'')',
    'an unknown seat is refused');
  perform pg_temp.assert_true(public.lane_allowed('zz-selftest'),
    'lane_allowed returns TRUE for the selftest lane, so it is authorization and not scope');
  perform pg_temp.assert_raises(
    'select public.operator_content_evidence(''clientops'', ''zz-selftest'')',
    'the selftest lane has no evidence population');

  v_alpha := public.operator_content_evidence('clientops', 'o-alpha');
  v_beta  := public.operator_content_evidence('clientops', 'o-beta');

  perform pg_temp.assert_true(v_alpha->>'client_id' = 'o-alpha',
    'the reader answers for the client asked for');
  perform pg_temp.assert_true(
    not (v_alpha::text like '%urn:b1%') and not (v_alpha::text like '%auth-z%')
    and not (v_alpha::text like '%Beta only topic%') and not (v_alpha::text like '%beta body%'),
    'no o-beta row, id, author or topic appears anywhere in the o-alpha payload');
  perform pg_temp.assert_true(
    not (v_beta::text like '%urn:a1%') and not (v_beta::text like '%auth-a%')
    and not (v_beta::text like '%A concrete topic%'),
    'no o-alpha row appears anywhere in the o-beta payload');

  -- ------------------------------------------------------------------
  -- 4. The four sections are present and shaped as the reader expects.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(
    v_alpha ? 'this_week' and v_alpha ? 'winners' and v_alpha ? 'inputs' and v_alpha ? 'results'
    and v_alpha ? 'freshness' and (v_alpha->>'schema_version')::int = 1,
    'the payload carries schema_version, freshness and all four views');
  perform pg_temp.assert_true(
    jsonb_typeof(v_alpha->'winners'->'market') = 'array'
    and jsonb_typeof(v_alpha->'winners'->'own') = 'array'
    and jsonb_typeof(v_alpha->'this_week'->'candidates') = 'array'
    and jsonb_typeof(v_alpha->'results'->'choices') = 'array'
    and jsonb_typeof(v_alpha->'results'->'prior_failures') = 'array'
    and jsonb_typeof(v_alpha->'inputs'->'gaps') = 'array',
    'every list is an array, never null');

  -- ------------------------------------------------------------------
  -- 5. Client control posts never enter the market totals or the market winners.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true((v_alpha->'inputs'->>'stored_posts')::int = 4,
    'stored posts counts every retained row in the market study, controls included');
  perform pg_temp.assert_true((v_alpha->'inputs'->>'eligible_posts')::int = 3,
    'eligible posts counts the market population only');
  perform pg_temp.assert_true((v_alpha->'inputs'->>'eligible_authors')::int = 2,
    'eligible authors counts authors of the market population only');
  perform pg_temp.assert_true(not (v_alpha->'winners'->'market')::text like '%urn:ctl%'
    and not (v_alpha->'winners'->'market')::text like '%own-seat%',
    'the own control is nowhere in the market winners');
  perform pg_temp.assert_true(not (v_alpha->'winners'->'market')::text like '%9999%',
    'the own control''s count never appears as a market number');

  -- ------------------------------------------------------------------
  -- 6. Market and own results are two disjoint sections, and own carries no lift.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(jsonb_array_length(v_alpha->'winners'->'market') = 3,
    'all three market findings are shown');
  perform pg_temp.assert_true(jsonb_array_length(v_alpha->'winners'->'own') = 1,
    'the own result is shown in its own section');
  perform pg_temp.assert_true(not (v_alpha->'winners'->'own'->0) ? 'lift',
    'an own result never carries a market multiple');
  perform pg_temp.assert_true((v_alpha->'winners'->'market'->0->>'lift')::numeric = 8,
    'market winners are ordered by their multiple, largest first');
  perform pg_temp.assert_true(v_alpha->'winners'->'market'->0->>'author' = 'Author A',
    'the author name is resolved from the study''s own author directory');
  perform pg_temp.assert_true(v_alpha->'winners'->'market'->0->>'first_line' = 'alpha first line',
    'the first line is the first line, not the whole body');
  perform pg_temp.assert_true((v_alpha->'winners'->'market'->0->>'legacy')::boolean = false,
    'a reconciled study is not labelled legacy');
  perform pg_temp.assert_true((v_beta->'winners'->'market'->0->>'legacy')::boolean = true,
    'an unreconciled study labels every row it produces');

  -- ------------------------------------------------------------------
  -- 7. Nulls stay null and a real zero stays zero.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(
    jsonb_typeof(v_alpha->'winners'->'market'->1->'limitation') = 'null',
    'a finding with no stated limitation reports null rather than an empty string');
  update public.client_research_findings set observed_value = 0, lift = 0
   where client_id = 'o-alpha' and finding_id = 'f3';
  perform pg_temp.assert_true(
    (public.operator_content_evidence('clientops', 'o-alpha')
      ->'winners'->'market'->2->>'observed_value')::numeric = 0,
    'a measured zero is stored and returned as zero');
  update public.client_research_findings set observed_value = 200, lift = 4
   where client_id = 'o-alpha' and finding_id = 'f3';

  -- ------------------------------------------------------------------
  -- 8. Study state and reader state are separate, and the reader returns no reader state.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(v_alpha->'inputs'->>'study_state' = 'validated',
    'the stored study state is reported as itself');
  perform pg_temp.assert_true(v_beta->'inputs'->>'study_state' = 'needs_reconciliation',
    'an unreconciled study reports its own state rather than being hidden');
  perform pg_temp.assert_true(not v_alpha->'inputs' ? 'state',
    'the reader never returns a ready/partial/empty/stale/failed state of its own');
  perform pg_temp.assert_true(
    v_alpha->'inputs'->>'sufficient_for_this_question' = 'true'
    and jsonb_typeof(v_alpha->'inputs'->'sufficiency_reason') = 'null',
    'three findings from two authors in a validated study is sufficient for this question');
  perform pg_temp.assert_true(
    v_beta->'inputs'->>'sufficient_for_this_question' = 'false'
    and v_beta->'inputs'->>'sufficiency_reason' is not null,
    'an insufficient lane says why, rather than showing a bare false');

  -- A larger count never automatically means ready: one author, many findings, still not enough.
  perform pg_temp.assert_true(
    (select count(*) from public.client_research_findings
      where client_id = 'o-alpha' and study_id = 'm-1') = 3,
    'the alpha fixture really does carry three findings');

  -- ------------------------------------------------------------------
  -- 9. The four Inputs answers come from real columns.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(
    v_alpha->'inputs'->'publication_window'->>'from' = '2026-01-01'
    and v_alpha->'inputs'->'publication_window'->>'to' = '2026-08-01',
    'the publication window is the study''s own stored window');
  perform pg_temp.assert_true(
    (v_alpha->'inputs'->>'last_successful_collection') like '2026-07-05%',
    'the last successful collection is the newest stored capture');
  perform pg_temp.assert_true(
    v_alpha->'inputs'->'connected_consumers' = jsonb_build_array('Strategy evidence view'),
    'with the rollout switch empty the weekly writer is not listed as a consumer');
  perform pg_temp.assert_true(
    jsonb_array_length(v_alpha->'inputs'->'gaps') = 1,
    'the study''s own missing inputs are the Inputs gaps');

  update public.integration_config set value = '["o-alpha"]'
   where key = 'weekly_evidence_selector_clients';
  perform pg_temp.assert_true(
    public.operator_content_evidence('clientops', 'o-alpha')->'inputs'->'connected_consumers'
      ? 'Weekly recommendation writer',
    'a client named in the rollout switch lists the weekly writer as a consumer');
  perform pg_temp.assert_true(
    not (public.operator_content_evidence('clientops', 'o-beta')->'inputs'->'connected_consumers'
      ? 'Weekly recommendation writer'),
    'a client the switch does not name is still on the legacy path');
  update public.integration_config set value = 'not json at all'
   where key = 'weekly_evidence_selector_clients';
  perform pg_temp.assert_true(
    public.operator_content_evidence('clientops', 'o-alpha')->'inputs'->'connected_consumers'
      = jsonb_build_array('Strategy evidence view'),
    'a malformed switch value enables nobody rather than breaking the screen');
  update public.integration_config set value = '[]'
   where key = 'weekly_evidence_selector_clients';

  -- ------------------------------------------------------------------
  -- 10. This week reads its own shortlist and its own evidence package.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(v_alpha->>'week_start' = '2026-09-28',
    'the pack answers for the newest addressed week');
  perform pg_temp.assert_true(jsonb_array_length(v_alpha->'this_week'->'candidates') = 3,
    'all three unapproved choices are shown');

  -- The package the writer really saves lives at the TOP LEVEL of context. Reading only the
  -- nested path would make every one of these cards read "No measured source is recorded".
  perform pg_temp.assert_true(
    v_alpha->'this_week'->'candidates'->0->>'evidence_sentence' = '400 against a usual 50 across 24 posts',
    'the evidence sentence is built from the finding the top-level package names');
  perform pg_temp.assert_true(
    v_alpha->'this_week'->'candidates'->0->>'source_url' = 'https://example.org/a1'
    and v_alpha->'this_week'->'candidates'->0->>'source_label' like 'Author A, %',
    'the card opens the exact source post');
  perform pg_temp.assert_true(
    v_alpha->'this_week'->'candidates'->0->'detail'->>'full_source_text' is not null
    and v_alpha->'this_week'->'candidates'->0->'detail'->>'method_version' = 'test-v2',
    'the calculation detail carries the full source text and the method version');

  -- client_fact_refs are objects. The LABEL is shown and the raw source_id never is.
  perform pg_temp.assert_true(
    v_alpha->'this_week'->'candidates'->0->>'client_material'
      = 'We review every proposed reply before anyone can send it.',
    'client material is the approved fact''s label');
  perform pg_temp.assert_true(
    not ((v_alpha->'this_week'->'candidates'->0)::text like '%founder-1%'),
    'a raw client fact id never reaches the screen');
  perform pg_temp.assert_true(
    (v_alpha->'this_week'->'candidates'->0->>'needs_material')::boolean = false
    and (v_alpha->'this_week'->'candidates'->0->>'is_experiment')::boolean = false,
    'a resolved evidence-backed row needs no material and is not an experiment');
  perform pg_temp.assert_true(
    v_alpha->'this_week'->'candidates'->0->>'objective' = 'attention_reach',
    'the objective is the value the writer saved, not a translation of it');

  -- label = 'experiment' is the flag. An experiment that rendered without its label was the
  -- defect the pre-release audit found.
  perform pg_temp.assert_true(
    (v_alpha->'this_week'->'candidates'->1->>'is_experiment')::boolean = true,
    'label = experiment marks the card as an experiment');
  perform pg_temp.assert_true(
    v_alpha->'this_week'->'candidates'->1->>'experiment_reason' like 'Unsupported by the measured floor%',
    'the experiment carries the reason the selector gave');
  perform pg_temp.assert_true(
    (v_alpha->'this_week'->'candidates'->1->>'needs_material')::boolean = true
    and v_alpha->'this_week'->'candidates'->1->>'needs_material_reason' like 'no permitted client material%',
    'a string needs_material reason reads as needing material, and the reason is carried');
  perform pg_temp.assert_true(
    jsonb_typeof(v_alpha->'this_week'->'candidates'->1->'client_material') = 'null',
    'an empty client_fact_refs array shows no client material rather than an empty string');
  perform pg_temp.assert_true(
    v_alpha->'this_week'->'candidates'->1->>'evidence_sentence'
        = 'No measured source is recorded for this choice.',
    'a choice with no measured source says so rather than being padded');
  perform pg_temp.assert_true(
    v_alpha->'this_week'->'candidates'->1->>'test_metric' like '%reactions at 7 and 14 days%',
    'test_metric is the declared measurement plan in plain words, never a policy id');

  -- The older nested shape still reads, so a row written before the move is not blanked.
  perform pg_temp.assert_true(
    v_alpha->'this_week'->'candidates'->2->>'evidence_sentence' = '300 against a usual 50 across 24 posts',
    'a package saved under the older nested path is still read');
  perform pg_temp.assert_true(
    (v_alpha->'this_week'->'candidates'->2->>'needs_material')::boolean = false,
    'an empty array needs_material still reads as false');
  perform pg_temp.assert_true(
    v_alpha->'this_week'->>'coverage_line' = '2 authors and 3 eligible posts are stored for this lane.',
    'the coverage line counts the market population');

  -- ------------------------------------------------------------------
  -- 11. Results: an approved choice with no publication stays pending.
  -- ------------------------------------------------------------------
  select id into v_rec from public.ops_drafts
   where client_id = 'o-alpha' and context->'audn'->'weekly'->>'topic_key' = 'k1';
  update public.ops_drafts set approved_at = now() where id = v_rec;
  perform pg_temp.assert_true(
    (select c->>'status' from jsonb_array_elements(
       public.operator_content_evidence('clientops', 'o-alpha')->'results'->'choices') c
      where c->>'id' = v_rec::text) = 'awaiting_publication',
    'an approved choice with nothing published stays awaiting_publication');
  perform pg_temp.assert_true(
    (select (c->>'incomplete_measurement')::boolean from jsonb_array_elements(
       public.operator_content_evidence('clientops', 'o-alpha')->'results'->'choices') c
      where c->>'id' = v_rec::text) = true,
    'a pending choice is an incomplete measurement, never a zero result');
  -- Results reads the package from the same top-level path This week does.
  perform pg_temp.assert_true(
    (select c->>'source_finding_id' from jsonb_array_elements(
       public.operator_content_evidence('clientops', 'o-alpha')->'results'->'choices') c
      where c->>'id' = v_rec::text) = 'f1',
    'the Results row traces to the finding the top-level package names');
  perform pg_temp.assert_true(
    (select c->>'objective' from jsonb_array_elements(
       public.operator_content_evidence('clientops', 'o-alpha')->'results'->'choices') c
      where c->>'id' = v_rec::text) = 'attention_reach',
    'the Results row carries the saved objective rather than the attention fallback');

  -- A publication for THIS tenant, linked through the stored outcome_link slot.
  insert into public.client_post_metrics
    (client_id, social_id, post_url, published_at, captured_at, reactions, impressions)
  values ('o-alpha', 'urn:li:activity:1', 'https://example.org/own1',
          now() - interval '8 days', now() - interval '1 day', 42, 1000)
  returning id into v_pub;

  update public.ops_drafts
     set context = jsonb_set(context, '{audn,outcome_link}',
       jsonb_build_object('publication_id', v_pub::text, 'link_status', 'explicit'))
   where id = v_rec;

  perform pg_temp.assert_true(
    (select c->>'status' from jsonb_array_elements(
       public.operator_content_evidence('clientops', 'o-alpha')->'results'->'choices') c
      where c->>'id' = v_rec::text) = 'evaluated',
    'a seven-day capture on a linked publication evaluates the test');
  perform pg_temp.assert_true(
    (select (c->'outcome'->>'observed_value')::int from jsonb_array_elements(
       public.operator_content_evidence('clientops', 'o-alpha')->'results'->'choices') c
      where c->>'id' = v_rec::text) = 42,
    'the observed outcome is the stored count');

  -- A capture far outside both standing windows is still being measured, never evaluated.
  update public.client_post_metrics set captured_at = now() - interval '7 days',
         published_at = now() - interval '40 days' where id = v_pub;
  perform pg_temp.assert_true(
    (select c->>'status' from jsonb_array_elements(
       public.operator_content_evidence('clientops', 'o-alpha')->'results'->'choices') c
      where c->>'id' = v_rec::text) = 'measuring',
    'a capture at an age no standing window covers leaves the test measuring');

  -- A publication belonging to ANOTHER tenant is never reachable, even by its exact id.
  insert into public.client_post_metrics
    (client_id, social_id, post_url, published_at, captured_at, reactions)
  values ('o-beta', 'urn:li:activity:2', 'https://example.org/beta1',
          now() - interval '8 days', now() - interval '1 day', 777)
  returning id into v_pub;
  update public.ops_drafts
     set context = jsonb_set(context, '{audn,outcome_link}',
       jsonb_build_object('publication_id', v_pub::text, 'link_status', 'explicit'))
   where id = v_rec;
  v_alpha := public.operator_content_evidence('clientops', 'o-alpha');
  perform pg_temp.assert_true(not (v_alpha::text like '%777%'),
    'a link pointing at another tenant''s publication returns nothing of that tenant');
  perform pg_temp.assert_true(
    (select c->>'status' from jsonb_array_elements(v_alpha->'results'->'choices') c
      where c->>'id' = v_rec::text) = 'awaiting_publication',
    'a cross-tenant link resolves to no publication, so the choice stays pending');

  -- ------------------------------------------------------------------
  -- 12. A passed-over choice carries the operator's own reason.
  -- ------------------------------------------------------------------
  update public.ops_drafts
     set context = context || jsonb_build_object('weekly_decision',
       jsonb_build_object('decision', 'rejected', 'reason', 'We already covered this in August.'))
   where client_id = 'o-alpha' and context->'audn'->'weekly'->>'topic_key' = 'k2';
  v_alpha := public.operator_content_evidence('clientops', 'o-alpha');
  perform pg_temp.assert_true(jsonb_array_length(v_alpha->'results'->'prior_failures') = 1,
    'a passed-over choice is listed with its reason');
  perform pg_temp.assert_true(
    v_alpha->'results'->'prior_failures'->0->>'reason' = 'We already covered this in August.',
    'the reason shown is the reason the operator gave');
  perform pg_temp.assert_true(
    (select count(*) from jsonb_array_elements(v_beta->'results'->'prior_failures')) = 0,
    'another tenant''s passed-over choice is not listed here');

  -- ------------------------------------------------------------------
  -- 13. A lane with no study at all gets a stated gap, not a silent zero.
  -- ------------------------------------------------------------------
  delete from public.client_research_findings where client_id = 'o-beta';
  delete from public.client_research_study_posts where client_id = 'o-beta';
  delete from public.client_research_studies where client_id = 'o-beta';
  v_beta := public.operator_content_evidence('clientops', 'o-beta');
  perform pg_temp.assert_true(v_beta->'inputs'->>'study_state' = 'missing',
    'no study reads as missing');
  perform pg_temp.assert_true(
    jsonb_typeof(v_beta->'inputs'->'stored_posts') = 'null'
    and jsonb_typeof(v_beta->'inputs'->'eligible_posts') = 'null',
    'an unknown count is null rather than a zero that reads as a measured emptiness');
  perform pg_temp.assert_true(
    v_beta->'inputs'->'gaps'->>0 = 'No market study is stored for this lane yet.'
    and v_beta->'this_week'->>'coverage_line' = 'No market study is stored for this lane yet.',
    'the gap is named in words');
  perform pg_temp.assert_true(jsonb_array_length(v_beta->'winners'->'market') = 0,
    'a lane with no study shows no market winners');

  -- ------------------------------------------------------------------
  -- 14. Freshness is the study's own observation cutoff.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(
    (v_alpha->'freshness'->>'stale_after_days')::int = 14
    and (v_alpha->'freshness'->>'is_stale')::boolean = false,
    'a study observed yesterday is not stale');
  update public.client_research_studies set observation_cutoff = now() - interval '60 days'
   where client_id = 'o-alpha' and study_id = 'm-1';
  perform pg_temp.assert_true(
    (public.operator_content_evidence('clientops', 'o-alpha')->'freshness'->>'is_stale')::boolean = true,
    'a study observed sixty days ago is stale');

  raise notice 'content_evidence_operator: all assertions passed';
end $$;

rollback;
