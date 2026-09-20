-- Tests for db/105_editorial_brief_contract.sql. House style, copied from
-- db/tests/content_evidence.sql: one transaction, pg_temp.assert_true / assert_raises, rollback
-- at the end so the database is unchanged.
--
-- Prerequisites this file does not create and the migration does not either: client_registry,
-- lane_allowed(text) (db/088), operator_gate_ok(text) and the anon/authenticated/service_role
-- roles. Under Supabase they already exist; under PGlite the runner seeds minimal stand-ins
-- first (src/sql/editorialBriefContract.pglite.test.ts).
--
-- Every fixture row is synthetic. No corpus text, no client receipt, no real source id.

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

-- ---------------------------------------------------------------------------
-- Fixtures: two lanes, one batch each, one brief each, sources of every shape
-- ---------------------------------------------------------------------------

insert into public.editorial_input_manifests
  (client_id, input_manifest_hash, source_cutoff, direction_version, decision_cutoff, source_refs)
values
  ('t-alpha', repeat('a', 64), '2026-09-19T00:00:00Z', 'dir-v3', '2026-09-19T00:00:00Z',
   '[{"source_id":"urn:test:alpha:1","seen_version":2}]'::jsonb),
  ('t-beta',  repeat('b', 64), '2026-09-19T00:00:00Z', 'dir-v1', '2026-09-19T00:00:00Z',
   '[]'::jsonb);

insert into public.editorial_batches
  (client_id, batch_id, status, input_manifest_hash, synthesis_method, synthesis_model,
   prompt_version, coverage_gaps)
values
  ('t-alpha', 'bt-1', 'complete', repeat('a', 64), 'local', 'test-model', 'p-v1', '[]'::jsonb),
  ('t-alpha', 'bt-empty', 'empty', repeat('a', 64), 'local', 'test-model', 'p-v1', '[]'::jsonb),
  ('t-beta',  'bt-b1', 'complete', repeat('b', 64), 'local', 'test-model', 'p-v1', '[]'::jsonb);

-- Source 1, ingested twice: two seen_versions of ONE source, never two sources.
insert into public.editorial_sources
  (client_id, source_id, seen_version, source_kind, source_client_scope, source_url, owner,
   source_published_at, published_date_state, captured_at, body_sha256, passage,
   retained_context, limitation, independent, permission_state, snapshot_hash)
values
  ('t-alpha', 'urn:test:alpha:1', 1, 'public_post', 'public', 'https://example.org/alpha-1',
   'Synthetic Author A', '2026-09-01T00:00:00Z', 'known', '2026-09-10T00:00:00Z',
   repeat('1', 64), 'A bounded synthetic excerpt for source one.',
   'Context retained around the excerpt.', 'Single observation, one account.',
   true, 'public_source', 'snap-a1-v1'),
  ('t-alpha', 'urn:test:alpha:1', 2, 'public_post', 'public', 'https://example.org/alpha-1',
   'Synthetic Author A', '2026-09-01T00:00:00Z', 'known', '2026-09-18T00:00:00Z',
   repeat('1', 64), 'A bounded synthetic excerpt for source one.',
   'Context retained around the excerpt.', 'Single observation, one account.',
   true, 'public_source', 'snap-a1-v2');

-- A repost of the same underlying post under a different row id. It is a DERIVED item and names
-- its origin, so it adds no independent corroboration.
insert into public.editorial_sources
  (client_id, source_id, seen_version, source_kind, source_client_scope, source_url, owner,
   source_published_at, published_date_state, captured_at, body_sha256, passage,
   retained_context, limitation, independent, derived_from, permission_state, snapshot_hash)
values
  ('t-alpha', 'urn:test:alpha:1-repost', 1, 'public_post', 'public',
   'https://example.org/alpha-1', 'Synthetic Reposter', '2026-09-03T00:00:00Z', 'known',
   '2026-09-18T00:00:00Z', repeat('1', 64), 'A bounded synthetic excerpt for source one.',
   'Reposted without new observation.', 'A repost is not a second sighting.',
   false, 'urn:test:alpha:1', 'public_source', 'snap-a1-repost');

-- A source with no publication date at all: 'unknown' is the honest answer, and the capture date
-- must never be promoted into the publication field.
insert into public.editorial_sources
  (client_id, source_id, seen_version, source_kind, source_client_scope, excerpt_pointer, owner,
   published_date_state, captured_at, body_sha256, passage, retained_context, limitation,
   independent, permission_state, snapshot_hash)
values
  ('t-alpha', 'urn:test:alpha:nodate', 1, 'call', 't-alpha',
   'editorial_sources:urn:test:alpha:nodate:passage@1', 'Synthetic Speaker',
   'unknown', '2026-09-18T00:00:00Z', repeat('2', 64),
   'A synthetic call line used as a topic justification.',
   'Surrounding synthetic context.', 'Date not recorded by the transcript source.',
   true, 'granted', 'snap-nodate-v1');

-- A 200-day-old post captured yesterday. Nothing about the fresh capture makes it current.
insert into public.editorial_sources
  (client_id, source_id, seen_version, source_kind, source_client_scope, source_url, owner,
   source_published_at, published_date_state, captured_at, body_sha256, passage,
   retained_context, limitation, independent, permission_state, snapshot_hash)
values
  ('t-alpha', 'urn:test:alpha:old', 1, 'public_post', 'public', 'https://example.org/alpha-old',
   'Synthetic Author B', now() - interval '200 days', 'known', now() - interval '1 day',
   repeat('3', 64), 'A bounded synthetic excerpt from an old post.',
   'Context retained.', 'Two hundred days old at capture.', true, 'public_source', 'snap-old-v1');

-- A permission-denied source: the pointer is retained and the body is withheld.
insert into public.editorial_sources
  (client_id, source_id, seen_version, source_kind, source_client_scope, excerpt_pointer, owner,
   published_date_state, captured_at, retained_context, limitation, independent,
   permission_state, gap_state, snapshot_hash)
values
  ('t-alpha', 'urn:test:alpha:denied', 1, 'asset', 't-alpha',
   'editorial_sources:urn:test:alpha:denied:passage@1', 'Synthetic Asset Owner',
   'unknown', '2026-09-18T00:00:00Z', 'Pointer retained, body withheld.',
   'Permission for the excerpt was refused.', true, 'denied',
   '{"reason":"permission_denied","detail":"the owner refused the excerpt"}'::jsonb,
   'snap-denied-v1');

insert into public.editorial_sources
  (client_id, source_id, seen_version, source_kind, source_client_scope, source_url, owner,
   source_published_at, published_date_state, captured_at, body_sha256, passage,
   retained_context, limitation, independent, permission_state, snapshot_hash)
values
  ('t-beta', 'urn:test:beta:1', 1, 'public_post', 'public', 'https://example.org/beta-1',
   'Synthetic Author Z', '2026-09-02T00:00:00Z', 'known', '2026-09-10T00:00:00Z',
   repeat('9', 64), 'A bounded synthetic excerpt that belongs to beta alone.',
   'Beta context.', 'Beta limitation.', true, 'public_source', 'snap-b1-v1');

insert into public.editorial_brief_versions
  (client_id, brief_id, version, batch_id, kind, status, content_hash, source_cutoff,
   direction_version, payload, claim_ledger, readiness, missing_material, authored_by_seat)
values
  ('t-alpha', 'br-alpha-1', 1, 'bt-1', 'post', 'proposed', repeat('c', 64),
   '2026-09-19T00:00:00Z', 'dir-v3',
   '{"purpose":{"objective":"synthetic"},"editorial_direction":{"topic":"synthetic topic"}}'::jsonb,
   '[{"claim_id":"cl-01","status":"interpretation"}]'::jsonb,
   'ready_to_draft', '[]'::jsonb, 'Seat One'),
  ('t-alpha', 'br-alpha-1', 2, 'bt-1', 'post', 'proposed', repeat('d', 64),
   '2026-09-19T00:00:00Z', 'dir-v3',
   '{"purpose":{"objective":"synthetic v2"},"editorial_direction":{"topic":"synthetic topic"}}'::jsonb,
   '[]'::jsonb, 'needs_material', '["a synthetic missing asset"]'::jsonb, 'Seat One'),
  ('t-beta', 'br-beta-1', 1, 'bt-b1', 'post', 'proposed', repeat('e', 64),
   '2026-09-19T00:00:00Z', 'dir-v1',
   '{"purpose":{"objective":"beta only"},"editorial_direction":{"topic":"beta topic"}}'::jsonb,
   '[]'::jsonb, 'needs_material', '["beta missing"]'::jsonb, 'Seat One');

insert into public.editorial_brief_sources
  (client_id, brief_id, version, evidence_id, relation, source_id, seen_version)
values
  ('t-alpha', 'br-alpha-1', 1, 'ev-01', 'supports_claim', 'urn:test:alpha:1', 2),
  ('t-alpha', 'br-alpha-1', 1, 'ev-02', 'supports_buyer_concern', 'urn:test:alpha:1', 2),
  ('t-alpha', 'br-alpha-1', 1, 'ev-03', 'supports_claim', 'urn:test:alpha:1-repost', 1),
  ('t-alpha', 'br-alpha-1', 1, 'ev-04', 'supports_buyer_concern', 'urn:test:alpha:nodate', 1);

insert into public.editorial_outcome_snapshots
  (client_id, snapshot_id, brief_id, brief_version, metric, observed_value, denominator, scope,
   captured_at, event_definition, attribution, limitation)
values
  ('t-alpha', 'snap-out-1', 'br-alpha-1', 1, 'impressions', 1200, 'one post, one account',
   'single post', '2026-09-19T00:00:00Z', 'platform impression', 'direct',
   'No age-matched comparison available.');

insert into public.editorial_outcome_snapshots
  (client_id, snapshot_id, brief_id, brief_version, metric, observed_value, unknown_reason,
   denominator, scope, captured_at, event_definition, attribution, limitation)
values
  ('t-alpha', 'snap-out-2', 'br-alpha-1', 1, 'landing_opt_ins', null,
   'no opt-in telemetry exists for this route', null, 'route', '2026-09-19T00:00:00Z',
   'opt-in event', 'unknown', 'Telemetry missing, not zero.');

do $$
declare
  v_page     jsonb;
  v_beta     jsonb;
  v_brief    jsonb;
  v_receipt  jsonb;
  v_receipt2 jsonb;
  v_link     jsonb;
  v_link2    jsonb;
  v_n        integer;
  v_before   integer;
  v_after    integer;
  v_defs     text;
  v_t        text;
begin
  -- ------------------------------------------------------------------
  -- 1. RLS is on every new table, and anon/authenticated hold nothing.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(
    (select count(*) = 11 from pg_tables
      where schemaname = 'public'
        and tablename in ('editorial_sources', 'editorial_source_curation',
          'editorial_input_manifests', 'editorial_batches', 'editorial_brief_versions',
          'editorial_brief_sources', 'editorial_decisions', 'editorial_brief_artifacts',
          'editorial_current_batch', 'editorial_refresh_requests', 'editorial_outcome_snapshots')
        and rowsecurity),
    'RLS is enabled on all eleven editorial tables');

  foreach v_t in array array['editorial_sources', 'editorial_source_curation',
    'editorial_input_manifests', 'editorial_batches', 'editorial_brief_versions',
    'editorial_brief_sources', 'editorial_decisions', 'editorial_brief_artifacts',
    'editorial_current_batch', 'editorial_refresh_requests', 'editorial_outcome_snapshots']
  loop
    perform pg_temp.assert_true(
      not has_table_privilege('anon', 'public.' || v_t, 'select')
      and not has_table_privilege('anon', 'public.' || v_t, 'insert')
      and not has_table_privilege('authenticated', 'public.' || v_t, 'select')
      and not has_table_privilege('authenticated', 'public.' || v_t, 'insert'),
      'anon and authenticated hold no direct privilege on ' || v_t);
    perform pg_temp.assert_true(
      has_table_privilege('service_role', 'public.' || v_t, 'select'),
      'service_role can read ' || v_t);
  end loop;

  perform pg_temp.assert_raises(
    'set local role anon; select 1 from public.editorial_brief_versions limit 1',
    'anon select on editorial_brief_versions is refused');
  reset role;

  -- ------------------------------------------------------------------
  -- 2. Function grants: the five browser RPCs to authenticated, the internals to nobody.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(
    has_function_privilege('authenticated', 'public.editorial_read_briefs(text, text, text, text, integer)', 'execute')
    and has_function_privilege('authenticated', 'public.editorial_read_brief(text, text, text, integer)', 'execute')
    and has_function_privilege('authenticated', 'public.editorial_read_research(text, text, jsonb, text, integer)', 'execute')
    and has_function_privilege('authenticated', 'public.editorial_read_brief_outcomes(text, text, text)', 'execute')
    and has_function_privilege('authenticated', 'public.editorial_record_decision(text, text, text, text, integer, integer, text, text, text, text)', 'execute'),
    'the five contract RPCs are executable by authenticated');

  perform pg_temp.assert_true(
    not has_function_privilege('anon', 'public.editorial_read_briefs(text, text, text, text, integer)', 'execute')
    and not has_function_privilege('anon', 'public.editorial_read_brief(text, text, text, integer)', 'execute')
    and not has_function_privilege('anon', 'public.editorial_read_research(text, text, jsonb, text, integer)', 'execute')
    and not has_function_privilege('anon', 'public.editorial_read_brief_outcomes(text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.editorial_record_decision(text, text, text, text, integer, integer, text, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.editorial_guard(text, text)', 'execute')
    and not has_function_privilege('anon', 'public.editorial_brief_json(text, text, integer)', 'execute')
    and not has_function_privilege('anon', 'public.editorial_link_artifact(text, text, text, integer, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.editorial_promote_batch(text, text, text)', 'execute'),
    'anon can execute nothing this migration created');

  perform pg_temp.assert_true(
    not has_function_privilege('authenticated', 'public.editorial_brief_json(text, text, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.editorial_guard(text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.editorial_link_artifact(text, text, text, integer, text, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.editorial_promote_batch(text, text, text)', 'execute'),
    'the internal reader, the guard, the artifact link and the promotion are not browser doors');

  -- ------------------------------------------------------------------
  -- 3. NO PATH TO THE LEGACY PROMOTERS. Read the deployed bodies, not the intent.
  -- ------------------------------------------------------------------
  select string_agg(pg_get_functiondef(p.oid), E'\n') into v_defs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'editorial\_%';

  perform pg_temp.assert_true(v_defs is not null and length(v_defs) > 0,
    'the editorial function bodies are readable');
  perform pg_temp.assert_true(
    v_defs not like '%lm_idea_candidates%'
    and v_defs not like '%client_ideas%'
    and v_defs not like '%carousel_drafts%'
    and v_defs not like '%ops_drafts%'
    and v_defs not like '%scheduled_posts%'
    and v_defs not like '%client_post_metrics%',
    'no editorial function names any legacy queue, draft or promotion table');

  -- A curation value can never satisfy a legacy pickup predicate.
  perform pg_temp.assert_true(
    not exists (select 1 from unnest(array['unseen','seen','pinned','dismissed']) s
                 where s in ('staged', 'approved', 'live', 'queued_for_generation')),
    'no curation state is a legacy idea status');

  -- ------------------------------------------------------------------
  -- 4. Authorization then scope, and a cross-tenant read returns nothing.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_raises(
    'select public.editorial_read_briefs(''wrong-gate'', ''t-alpha'')',
    'a bad gate is refused before anything is read');
  perform pg_temp.assert_raises(
    'select public.editorial_read_briefs(''clientops'', null)',
    'a null client is refused');
  perform pg_temp.assert_raises(
    'select public.editorial_read_briefs(''clientops'', ''t-nobody'')',
    'an unregistered client id is rejected before any query');
  perform pg_temp.assert_true(public.lane_allowed('zz-selftest'),
    'lane_allowed returns TRUE for the selftest lane, so it is authorization and not scope');
  perform pg_temp.assert_raises(
    'select public.editorial_read_briefs(''clientops'', ''zz-selftest'')',
    'the selftest lane has no editorial population');

  v_page := public.editorial_read_briefs('clientops', 't-alpha', 'bt-1');
  v_beta := public.editorial_read_briefs('clientops', 't-beta', 'bt-b1');
  perform pg_temp.assert_true(v_page->>'client_id' = 't-alpha',
    'the page answers for the client asked for');
  perform pg_temp.assert_true(
    not (v_page::text like '%br-beta-1%') and not (v_page::text like '%beta only%'),
    'no beta brief, id or body appears anywhere in the alpha page');
  perform pg_temp.assert_true(
    not (v_beta::text like '%br-alpha-1%') and not (v_beta::text like '%synthetic topic%'),
    'no alpha brief appears anywhere in the beta page');

  -- A beta caller asking for an alpha batch gets an explicit empty page, not alpha's rows and
  -- not an error that confirms the batch exists somewhere else.
  perform pg_temp.assert_true(
    (public.editorial_read_briefs('clientops', 't-beta', 'bt-1')->>'state') = 'empty'
    and (public.editorial_read_briefs('clientops', 't-beta', 'bt-1')->>'total')::int = 0,
    'a cross-tenant batch id returns an explicit empty page');

  -- A brief id that belongs to the other tenant is not-found, and the reason does not say which
  -- tenant holds it.
  v_brief := public.editorial_read_brief('clientops', 't-beta', 'br-alpha-1', 1);
  perform pg_temp.assert_true((v_brief->>'found')::boolean = false
    and v_brief->>'reason' = 'no_such_brief',
    'a cross-tenant brief read is a plain not-found');
  perform pg_temp.assert_true(not (v_brief::text like '%synthetic topic%'),
    'the not-found result leaks none of the other tenant''s content');

  perform pg_temp.assert_true(
    (public.editorial_read_research('clientops', 't-beta')::text not like '%urn:test:alpha%'),
    'the beta research page contains no alpha source');
  perform pg_temp.assert_true(
    (public.editorial_read_brief_outcomes('clientops', 't-beta', 'br-alpha-1')->>'state') = 'empty',
    'a cross-tenant outcome read is empty, never the other tenant''s observations');

  -- ------------------------------------------------------------------
  -- 5. Typed identity: the exact version, never the newest one.
  -- ------------------------------------------------------------------
  v_brief := public.editorial_read_brief('clientops', 't-alpha', 'br-alpha-1', 1);
  perform pg_temp.assert_true((v_brief->>'found')::boolean = true
    and (v_brief->'brief'->'identity'->>'version')::int = 1
    and v_brief->'brief'->'identity'->>'content_hash' = repeat('c', 64),
    'version 1 is returned with version 1''s own content hash');
  perform pg_temp.assert_true(
    (public.editorial_read_brief('clientops', 't-alpha', 'br-alpha-1', 1)
      ->'brief'->'identity'->>'content_hash') = repeat('c', 64),
    'the content hash is stable across two reads');

  v_brief := public.editorial_read_brief('clientops', 't-alpha', 'br-alpha-1', 9);
  perform pg_temp.assert_true((v_brief->>'found')::boolean = false
    and v_brief->>'reason' = 'no_such_version',
    'a version that does not exist is not-found, never a silent fallback to the newest');

  -- ------------------------------------------------------------------
  -- 6. Empty / missing corpus: an explicit empty page, never a throw and never a fabrication.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(
    (public.editorial_read_briefs('clientops', 't-alpha', 'bt-does-not-exist')->>'state') = 'empty'
    and jsonb_array_length(
      public.editorial_read_briefs('clientops', 't-alpha', 'bt-does-not-exist')->'items') = 0
    and nullif(btrim(coalesce(
      public.editorial_read_briefs('clientops', 't-alpha', 'bt-does-not-exist')->>'message', '')), '')
      is not null,
    'an unknown batch id is an explicit empty page with a stated reason');

  perform pg_temp.assert_true(
    (public.editorial_read_research('clientops', 't-beta')->>'state') = 'ready'
    and (public.editorial_read_research('clientops', 't-beta')->>'total')::int = 1,
    'beta reads its own single source and nothing else');

  -- ------------------------------------------------------------------
  -- 7. Source provenance: publication vs capture, unknown stays unknown, hash is stable.
  -- ------------------------------------------------------------------
  v_page := public.editorial_read_research('clientops', 't-alpha');
  perform pg_temp.assert_true(
    (select (i->>'source_published_date') = 'unknown'
       from jsonb_array_elements(v_page->'items') i
      where i->>'source_id' = 'urn:test:alpha:nodate'),
    'a source with no publication date reports ''unknown'', not its ingest timestamp');
  perform pg_temp.assert_true(
    (select (i->>'source_published_date') <> (i->>'captured_date')
       from jsonb_array_elements(v_page->'items') i
      where i->>'source_id' = 'urn:test:alpha:1'),
    'the capture date never substitutes for the publication date');
  perform pg_temp.assert_true(
    (select (i->>'snapshot_hash') = 'snap-a1-v2'
       from jsonb_array_elements(v_page->'items') i
      where i->>'source_id' = 'urn:test:alpha:1'),
    'the newest seen_version is served and its snapshot hash is the stored one');
  perform pg_temp.assert_true(
    v_page::text = public.editorial_read_research('clientops', 't-alpha')::text,
    're-reading the same research page returns the identical snapshot');

  -- A 200-day-old post captured yesterday is historical. A fresh ingest never refreshes currency.
  perform pg_temp.assert_true(
    (select (i->>'currency_state') = 'historical' and (i->>'age_days')::int >= 199
       from jsonb_array_elements(v_page->'items') i
      where i->>'source_id' = 'urn:test:alpha:old'),
    'a 200-day-old post captured yesterday reports its real age and is not current');

  -- ------------------------------------------------------------------
  -- 8. Duplicate evidence and reposts add no corroboration.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true((v_page->>'independent_source_count')::int = 3,
    'the independent count is 3: the repost is derived and the denied source is gapped');
  select count(*) into v_n from public.editorial_sources
   where client_id = 't-alpha' and source_id = 'urn:test:alpha:1';
  perform pg_temp.assert_true(v_n = 2,
    'a second ingestion is a second seen_version of one source');
  perform pg_temp.assert_true(
    (select count(*) = 1 from jsonb_array_elements(v_page->'items') i
      where i->>'source_id' = 'urn:test:alpha:1'),
    'two seen_versions of one source appear once on the research page');
  perform pg_temp.assert_raises(
    'insert into public.editorial_sources
       (client_id, source_id, seen_version, source_kind, source_url, owner,
        published_date_state, captured_at, body_sha256, passage, independent, snapshot_hash)
     values (''t-alpha'', ''urn:test:alpha:derived'', 1, ''public_post'',
             ''https://example.org/x'', ''Someone'', ''unknown'', now(), ''deadbeef'',
             ''p'', false, ''snap-x'')',
    'a derived source with no named origin is rejected');

  -- ------------------------------------------------------------------
  -- 9. Permission gap: the pointer is retained, the body is withheld, other lanes unaffected.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_true(
    (select (i->'gap_state'->>'reason') = 'permission_denied'
        and (i->>'passage') is null
        and (i->'source_ref'->>'excerpt_pointer') is not null
       from jsonb_array_elements(v_page->'items') i
      where i->>'source_id' = 'urn:test:alpha:denied'),
    'a denied source keeps its pointer, withholds its body and states the reason');
  perform pg_temp.assert_true(
    (public.editorial_read_research('clientops', 't-beta')->>'state') = 'ready',
    'one lane''s permission failure does not affect another lane');
  perform pg_temp.assert_raises(
    'insert into public.editorial_sources
       (client_id, source_id, seen_version, source_kind, source_url, owner,
        published_date_state, captured_at, independent, snapshot_hash)
     values (''t-alpha'', ''urn:test:alpha:nobody'', 1, ''public_post'',
             ''https://example.org/y'', ''Someone'', ''unknown'', now(), true, ''snap-y'')',
    'a source with neither a retained body nor an explicit gap is rejected');

  -- ------------------------------------------------------------------
  -- 10. Append-only and immutability, on every table that claims it.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_raises(
    'update public.editorial_brief_versions set status = ''shortlisted''
      where client_id = ''t-alpha'' and brief_id = ''br-alpha-1'' and version = 1',
    'a brief version cannot be updated in place');
  perform pg_temp.assert_raises(
    'update public.editorial_sources set passage = ''edited''
      where client_id = ''t-alpha'' and source_id = ''urn:test:alpha:1'' and seen_version = 1',
    'a source snapshot cannot be edited');
  perform pg_temp.assert_raises(
    'update public.editorial_outcome_snapshots set observed_value = 0
      where client_id = ''t-alpha'' and snapshot_id = ''snap-out-2''',
    'an unknown outcome cannot be quietly turned into a zero');
  perform pg_temp.assert_raises(
    'update public.editorial_input_manifests set direction_version = ''dir-v9''
      where client_id = ''t-alpha''',
    'an input manifest is fixed once written');
  perform pg_temp.assert_raises(
    'update public.editorial_batches set batch_id = ''bt-renamed''
      where client_id = ''t-alpha'' and batch_id = ''bt-1''',
    'a batch identity cannot be re-pointed');

  -- A batch may still advance its lifecycle: that is the one thing it is allowed to do.
  update public.editorial_batches set completed_at = now()
   where client_id = 't-alpha' and batch_id = 'bt-1';
  perform pg_temp.assert_true(true, 'a batch may advance its lifecycle fields');

  -- A NEW VERSION is how a brief changes.
  insert into public.editorial_brief_versions
    (client_id, brief_id, version, batch_id, kind, status, content_hash, source_cutoff,
     direction_version, payload, revises_brief_id, revises_version, changed_evidence,
     readiness, missing_material)
  values
    ('t-alpha', 'br-alpha-2', 1, 'bt-1', 'post', 'proposed', repeat('f', 64),
     '2026-09-19T00:00:00Z', 'dir-v3', '{"purpose":{"objective":"a revision"}}'::jsonb,
     'br-alpha-1', 1, 'A new synthetic observation replaced the first one.',
     'needs_material', '["still missing"]'::jsonb);
  perform pg_temp.assert_true(
    (select revises_version = 1 from public.editorial_brief_versions
      where client_id = 't-alpha' and brief_id = 'br-alpha-2' and version = 1),
    'a revision points at the exact earlier version it replaces');
  perform pg_temp.assert_raises(
    'insert into public.editorial_brief_versions
       (client_id, brief_id, version, batch_id, kind, content_hash, source_cutoff,
        direction_version, payload, revises_brief_id, revises_version)
     values (''t-alpha'', ''br-alpha-3'', 1, ''bt-1'', ''post'', repeat(''a'', 64),
             ''2026-09-19T00:00:00Z'', ''dir-v3'', ''{}''::jsonb, ''br-alpha-1'', 1)',
    'a revision with no changed-evidence explanation is rejected');

  -- ------------------------------------------------------------------
  -- 11. Decision ledger: idempotent, append-only, and concurrency-safe.
  -- ------------------------------------------------------------------
  v_receipt := public.editorial_record_decision(
    'clientops', 't-alpha', 'brief', 'br-alpha-1', 2, 2, 'shortlist',
    'the strongest synthetic option this week', 'candidate', 'req-001');
  perform pg_temp.assert_true(v_receipt->>'outcome' = 'recorded'
    and (v_receipt->>'promoted')::boolean = false,
    'a first decision is recorded and promotes nothing');

  v_receipt2 := public.editorial_record_decision(
    'clientops', 't-alpha', 'brief', 'br-alpha-1', 2, 2, 'shortlist',
    'the strongest synthetic option this week', 'candidate', 'req-001');
  perform pg_temp.assert_true(
    v_receipt2->>'decision_id' = v_receipt->>'decision_id'
    and v_receipt2->>'outcome' = 'duplicate',
    'a replayed request returns the same decision identity');
  select count(*) into v_n from public.editorial_decisions
   where client_id = 't-alpha' and request_id = 'req-001';
  perform pg_temp.assert_true(v_n = 1, 'the replay wrote no second row');

  -- A stale expected_version conflicts and overwrites nothing.
  v_receipt2 := public.editorial_record_decision(
    'clientops', 't-alpha', 'brief', 'br-alpha-1', 1, 1, 'reject',
    'a decision taken against the old version', 'angle', 'req-002');
  perform pg_temp.assert_true(v_receipt2->>'outcome' = 'conflict'
    and (v_receipt2->>'observed_version')::int = 2
    and v_receipt2->'conflict'->>'reason' is not null,
    'a stale expected_version returns an explicit conflict carrying the current version');
  perform pg_temp.assert_true(
    (public.editorial_read_brief('clientops', 't-alpha', 'br-alpha-1', 2)
      ->'brief'->>'effective_status') = 'shortlisted',
    'the conflicting rejection did not overwrite the recorded shortlist');

  perform pg_temp.assert_raises(
    'update public.editorial_decisions set reason = ''rewritten''
      where client_id = ''t-alpha'' and request_id = ''req-001''',
    'a recorded decision cannot be rewritten');

  perform pg_temp.assert_raises(
    'select public.editorial_record_decision(''clientops'', ''t-alpha'', ''brief'',
       ''br-alpha-1'', 2, 2, ''shortlist'', '''', ''candidate'', ''req-003'')',
    'a decision with no reason is refused');

  -- A skipped card writes nothing at all.
  select count(*) into v_n from public.editorial_decisions where client_id = 't-alpha';
  perform pg_temp.assert_true(v_n = 2,
    'exactly two decision rows exist: the shortlist and the conflict, and no skip row');

  -- A cross-tenant decision cannot reach the other tenant's brief.
  perform pg_temp.assert_raises(
    'select public.editorial_record_decision(''clientops'', ''t-beta'', ''brief'',
       ''br-alpha-1'', 1, 1, ''reject'', ''trying to reach alpha'', ''candidate'', ''req-x'')',
    'a decision on another tenant''s brief is refused');

  -- ------------------------------------------------------------------
  -- 12. Idempotent artifact link: one role per brief version, one draft on a retry.
  -- ------------------------------------------------------------------
  v_link := public.editorial_link_artifact(
    'clientops', 't-alpha', 'br-alpha-1', 1, 'post_draft', 'draft-001', 'lnk-001');
  perform pg_temp.assert_true((v_link->>'idempotent_replay')::boolean = false
    and v_link->>'artifact_id' = 'draft-001',
    'the first link records the artifact identity');

  v_link2 := public.editorial_link_artifact(
    'clientops', 't-alpha', 'br-alpha-1', 1, 'post_draft', 'draft-002', 'lnk-002');
  perform pg_temp.assert_true((v_link2->>'idempotent_replay')::boolean = true
    and v_link2->>'artifact_id' = 'draft-001',
    'a retry returns the SAME draft identity and never mints a second one');
  select count(*) into v_n from public.editorial_brief_artifacts
   where client_id = 't-alpha' and brief_id = 'br-alpha-1' and version = 1;
  perform pg_temp.assert_true(v_n = 1, 'only one artifact row exists for that role');

  perform pg_temp.assert_raises(
    'insert into public.editorial_brief_artifacts
       (client_id, brief_id, version, artifact_role, artifact_id, request_id)
     values (''t-alpha'', ''br-alpha-1'', 1, ''post_draft'', ''draft-003'', ''lnk-003'')',
    'a duplicate (client, brief, version, role) link is refused by the key itself');

  -- A different version of the same brief is a different request, by design.
  v_link2 := public.editorial_link_artifact(
    'clientops', 't-alpha', 'br-alpha-1', 2, 'post_draft', 'draft-004', 'lnk-004');
  perform pg_temp.assert_true(v_link2->>'artifact_id' = 'draft-004',
    'a changed brief version takes an explicit new request');

  -- ------------------------------------------------------------------
  -- 13. Promotion is atomic and a failed refresh keeps the last usable batch.
  -- ------------------------------------------------------------------
  perform public.editorial_promote_batch('clientops', 't-alpha', 'bt-1');
  perform pg_temp.assert_true(
    (select batch_id = 'bt-1' from public.editorial_current_batch where client_id = 't-alpha'),
    'a complete batch becomes the current pointer');

  v_receipt := public.editorial_promote_batch('clientops', 't-alpha', 'bt-empty');
  perform pg_temp.assert_true((v_receipt->>'promoted')::boolean = false
    and v_receipt->>'current_batch_id' = 'bt-1',
    'an empty batch is refused and the last usable batch is kept');
  perform pg_temp.assert_true(
    (select batch_id = 'bt-1' from public.editorial_current_batch where client_id = 't-alpha'),
    'the pointer did not move');
  perform pg_temp.assert_raises(
    'update public.editorial_current_batch set batch_id = ''bt-empty''
      where client_id = ''t-alpha''',
    'the trigger refuses a non-promotable batch even on a direct write');

  -- The default read with no batch id follows the promoted pointer.
  perform pg_temp.assert_true(
    (public.editorial_read_briefs('clientops', 't-alpha')->>'batch_id') = 'bt-1',
    'a read with no batch id follows the promoted pointer');

  -- ------------------------------------------------------------------
  -- 14. Reads are side-effect free.
  -- ------------------------------------------------------------------
  select (select count(*) from public.editorial_decisions)
       + (select count(*) from public.editorial_source_curation)
       + (select count(*) from public.editorial_brief_artifacts)
       + (select count(*) from public.editorial_sources)
       + (select count(*) from public.editorial_brief_versions)
    into v_before;

  perform public.editorial_read_research('clientops', 't-alpha');
  perform public.editorial_read_briefs('clientops', 't-alpha', 'bt-1');
  perform public.editorial_read_brief('clientops', 't-alpha', 'br-alpha-1', 1);
  perform public.editorial_read_brief_outcomes('clientops', 't-alpha', 'br-alpha-1');

  select (select count(*) from public.editorial_decisions)
       + (select count(*) from public.editorial_source_curation)
       + (select count(*) from public.editorial_brief_artifacts)
       + (select count(*) from public.editorial_sources)
       + (select count(*) from public.editorial_brief_versions)
    into v_after;
  perform pg_temp.assert_true(v_before = v_after,
    'four reads created no curation row, no seen record and no generation request');

  -- ------------------------------------------------------------------
  -- 15. Curation is its own vocabulary, and it promotes nothing.
  -- ------------------------------------------------------------------
  perform public.editorial_set_source_curation(
    'clientops', 't-alpha', 'urn:test:alpha:1', 'pinned');
  perform pg_temp.assert_true(
    (select state = 'pinned' and seen_version = 2 from public.editorial_source_curation
      where client_id = 't-alpha' and source_id = 'urn:test:alpha:1'),
    'pinning records the state against the current seen_version');
  perform pg_temp.assert_raises(
    'update public.editorial_source_curation set state = ''dismissed'', reason = null
      where client_id = ''t-alpha'' and source_id = ''urn:test:alpha:1''',
    'a dismissal with no reason is refused');
  perform pg_temp.assert_raises(
    'select public.editorial_set_source_curation(''clientops'', ''t-alpha'',
       ''urn:test:beta:1'', ''pinned'')',
    'a source that does not belong to this lane cannot be curated by it');
  perform pg_temp.assert_raises(
    'select public.editorial_set_source_curation(''clientops'', ''t-alpha'',
       ''urn:test:alpha:1'', ''approved'')',
    'a legacy status value is not a curation state');

  -- ------------------------------------------------------------------
  -- 16. Outcome reads: unknown stays unknown, never zero.
  -- ------------------------------------------------------------------
  v_receipt := public.editorial_read_brief_outcomes('clientops', 't-alpha', 'br-alpha-1');
  perform pg_temp.assert_true(
    (select (o->>'observed_value') = 'unknown'
       from jsonb_array_elements(v_receipt->'observations') o
      where o->>'snapshot_id' = 'snap-out-2'),
    'a missing observation reports ''unknown'' and never 0');
  perform pg_temp.assert_true(
    (select (o->>'observed_value')::numeric = 1200 and (o->>'denominator') <> 'unknown'
       from jsonb_array_elements(v_receipt->'observations') o
      where o->>'snapshot_id' = 'snap-out-1'),
    'a real observation keeps its value and its denominator');
  perform pg_temp.assert_true(jsonb_array_length(v_receipt->'unknowns') = 1,
    'the unknown carries its stated reason');
  perform pg_temp.assert_raises(
    'insert into public.editorial_outcome_snapshots
       (client_id, snapshot_id, brief_id, metric, observed_value, scope)
     values (''t-alpha'', ''snap-bad'', ''br-alpha-1'', ''clicks'', 42, ''x'')',
    'an observed value with no denominator is rejected');
  perform pg_temp.assert_raises(
    'insert into public.editorial_outcome_snapshots
       (client_id, snapshot_id, brief_id, metric, observed_value, scope)
     values (''t-alpha'', ''snap-bad2'', ''br-alpha-1'', ''clicks'', null, ''x'')',
    'a null observation with no stated reason is rejected');

  -- ------------------------------------------------------------------
  -- 17. Schema rules that stand on their own.
  -- ------------------------------------------------------------------
  perform pg_temp.assert_raises(
    'insert into public.editorial_brief_versions
       (client_id, brief_id, version, kind, content_hash, source_cutoff, direction_version,
        payload, readiness, missing_material)
     values (''t-alpha'', ''br-bad'', 1, ''post'', repeat(''a'', 64), now(), ''dir-v3'',
             ''{}''::jsonb, ''ready_to_draft'', ''["something missing"]''::jsonb)',
    'a brief cannot be ready to draft while it lists missing material');
  perform pg_temp.assert_raises(
    'insert into public.editorial_brief_versions
       (client_id, brief_id, version, kind, content_hash, source_cutoff, direction_version, payload)
     values (''t-alpha'', ''br-bad2'', 1, ''post'', ''not-a-hash'', now(), ''dir-v3'', ''{}''::jsonb)',
    'a content hash that is not a 64-character hex digest is refused');
  perform pg_temp.assert_raises(
    'insert into public.editorial_batches
       (client_id, batch_id, status, input_manifest_hash)
     values (''t-alpha'', ''bt-partial-bad'', ''partial'', repeat(''a'', 64))',
    'a partial batch with no stated coverage gap is refused');
  perform pg_temp.assert_raises(
    'insert into public.editorial_batches
       (client_id, batch_id, status, input_manifest_hash)
     values (''t-alpha'', ''bt-failed-bad'', ''failed'', repeat(''a'', 64))',
    'a failed batch with no reason is refused');
  perform pg_temp.assert_raises(
    'insert into public.editorial_sources
       (client_id, source_id, seen_version, source_kind, source_client_scope, source_url, owner,
        published_date_state, captured_at, body_sha256, passage, independent, snapshot_hash)
     values (''t-alpha'', ''urn:test:foreign'', 1, ''public_post'', ''t-beta'',
             ''https://example.org/z'', ''Someone'', ''unknown'', now(), ''abc'', ''p'', true, ''s'')',
    'a source scoped to another tenant cannot be stored in this lane');
  perform pg_temp.assert_raises(
    'insert into public.editorial_sources
       (client_id, source_id, seen_version, source_kind, source_url, owner,
        source_published_at, published_date_state, captured_at, body_sha256, passage,
        independent, snapshot_hash)
     values (''t-alpha'', ''urn:test:pubstate'', 1, ''public_post'', ''https://example.org/w'',
             ''Someone'', null, ''known'', now(), ''abc'', ''p'', true, ''s'')',
    'a publication date declared known cannot be null');
  perform pg_temp.assert_raises(
    'insert into public.editorial_sources
       (client_id, source_id, seen_version, source_kind, source_url, owner,
        published_date_state, captured_at, body_sha256, passage, independent, snapshot_hash,
        candidate_fields)
     values (''t-alpha'', ''urn:test:cand'', 1, ''candidate'', ''https://example.org/c'',
             ''Someone'', ''unknown'', now(), ''abc'', ''p'', true, ''s'',
             ''{"evidence":"e"}''::jsonb)',
    'a candidate source missing four of its five fields is refused');
  perform pg_temp.assert_raises(
    'insert into public.editorial_brief_sources
       (client_id, brief_id, version, evidence_id, relation, source_id, seen_version)
     values (''t-alpha'', ''br-alpha-1'', 1, ''ev-bad'', ''supports_claim'',
             ''urn:test:beta:1'', 1)',
    'a brief cannot link a source that belongs to another tenant');
  perform pg_temp.assert_raises(
    'insert into public.editorial_brief_sources
       (client_id, brief_id, version, evidence_id, relation, source_id, seen_version)
     values (''t-alpha'', ''br-alpha-1'', 1, ''ev-bad2'', ''looks_relevant'',
             ''urn:test:alpha:1'', 2)',
    'an untyped relation is refused');

  raise notice 'editorial_brief_contract: all assertions passed';
end $$;

rollback;
