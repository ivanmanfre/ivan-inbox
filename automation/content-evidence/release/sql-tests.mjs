#!/usr/bin/env node
// Transactional tests for db/103 + db/104 against a throwaway in-process PGlite instance.
// Never touches production: PGlite is in-memory and opens no socket.
//
//   node automation/content-evidence/release/sql-tests.mjs
//
// What it proves, in this order:
//   1. both migrations apply to a fresh instance, and apply AGAIN to the same instance with no
//      error and no change (additive idempotency)
//   2. anon holds zero EXECUTE and zero SELECT privileges on anything either migration created
//   3. db/tests/content_evidence.sql (db/103's own assertions) runs clean
//   4. db/tests/content_evidence_operator.sql (db/104's assertions) runs clean
//   5. a control: the same operator assertions file MUST fail when the reader is replaced with a
//      body that ignores its tenant parameter. An assertions file that passes against a broken
//      reader is not testing the boundary it claims to test.
//
// Prerequisites the migrations do not create (roles, client_registry, lane_allowed from db/088,
// operator_gate_ok, ops_drafts, client_post_metrics) are seeded here as minimal stand-ins, the
// same way Run 1's and Run 2's harnesses did for the same 103 migration.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

const BOOTSTRAP = `
create role anon; create role authenticated; create role service_role;

create table public.client_registry (
  client_id text primary key, display_name text, is_active boolean, platform jsonb);

-- The operator gate, in the shape every RPC since db/032 calls it. The live body is
--   select exists (select 1 from integration_config where key = 'operator_panel_gate_hash'
--                   and value = encode(digest(coalesce(p_gate, ''), 'sha256'), 'hex'))
-- which needs pgcrypto, so a fixed literal stands in here. The coalesce is copied deliberately:
-- the live gate returns FALSE for a null gate rather than null, and a stand-in that returned null
-- would make the null-gate assertion pass for the wrong reason.
create or replace function public.operator_gate_ok(p_gate text)
returns boolean language sql stable as $$ select coalesce(p_gate, '') = 'clientops' $$;

create table public.ops_drafts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null, kind text not null, slack_channel text, body text,
  context jsonb, created_at timestamptz not null default now(),
  approved_at timestamptz, sent_at timestamptz, send_blocked_reason text);

create table public.client_post_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id text not null, social_id text, post_url text, title text,
  published_at timestamptz, captured_at timestamptz,
  impressions integer, reactions integer, comments integer, shares integer, meta jsonb);
`;

function readSlice(relPath, startMarker, endMarker) {
  const src = readFileSync(path.join(ROOT, relPath), 'utf8');
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start < 0 || end < 0) throw new Error(`marker not found in ${relPath}`);
  return src.slice(start, end + endMarker.length);
}

async function loadPglite() {
  for (const candidate of [
    path.join(ROOT, 'node_modules/@electric-sql/pglite/dist/index.js'),
  ]) {
    try { return (await import(pathToFileURL(candidate).href)).PGlite; } catch { /* next */ }
  }
  throw new Error('no @electric-sql/pglite available; run npm ci first');
}

const MIGRATIONS = ['db/103_content_evidence.sql', 'db/104_operator_content_evidence.sql'];

async function freshDb(PGlite) {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(readSlice('db/088_lane_allowed.sql',
    'create or replace function public.lane_allowed',
    'grant execute on function public.lane_allowed(text) to service_role;'));
  for (const m of MIGRATIONS) await db.exec(readFileSync(path.join(ROOT, m), 'utf8'));
  return db;
}

const results = [];
const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${detail ? ' -- ' + detail : ''}`);
};

async function main() {
  const PGlite = await loadPglite();

  // 1. idempotency
  const db = await freshDb(PGlite);
  const before = await db.query(`select count(*)::int as n from public.integration_config`);
  try {
    for (const m of MIGRATIONS) await db.exec(readFileSync(path.join(ROOT, m), 'utf8'));
    const after = await db.query(`select count(*)::int as n from public.integration_config`);
    record('second application of 103 and 104 is a no-op',
      after.rows[0].n === before.rows[0].n, `config rows ${before.rows[0].n} -> ${after.rows[0].n}`);
  } catch (error) {
    record('second application of 103 and 104 is a no-op', false, error.message.split('\n')[0]);
  }

  // The default rollout switch is present and empty.
  const sw = await db.query(
    `select value from public.integration_config where key = 'weekly_evidence_selector_clients'`);
  record('rollout switch defaults to no client enabled',
    sw.rows.length === 1 && sw.rows[0].value === '[]', JSON.stringify(sw.rows));

  // An operator who has already enabled clients is never reset by a replay.
  await db.exec(`update public.integration_config set value = '["risedtc"]'
                  where key = 'weekly_evidence_selector_clients'`);
  for (const m of MIGRATIONS) await db.exec(readFileSync(path.join(ROOT, m), 'utf8'));
  const sw2 = await db.query(
    `select value from public.integration_config where key = 'weekly_evidence_selector_clients'`);
  record('a replay never resets an already-enabled rollout switch', sw2.rows[0].value === '["risedtc"]');
  await db.exec(`update public.integration_config set value = '[]'
                  where key = 'weekly_evidence_selector_clients'`);

  // 2. anon holds nothing
  const fn = await db.query(
    `select routine_name from information_schema.role_routine_grants where grantee = 'anon'`);
  const tbl = await db.query(
    `select table_name from information_schema.role_table_grants where grantee = 'anon'`);
  record('anon has zero execute and zero table grants',
    fn.rows.length === 0 && tbl.rows.length === 0,
    JSON.stringify({ routines: fn.rows, tables: tbl.rows }));
  await db.close?.();

  // 3 + 4. the two assertion files, each on its own fresh instance
  for (const testFile of ['db/tests/content_evidence.sql', 'db/tests/content_evidence_operator.sql']) {
    const t = await freshDb(PGlite);
    try {
      await t.exec(readFileSync(path.join(ROOT, testFile), 'utf8'));
      record(`${testFile} runs clean`, true);
    } catch (error) {
      record(`${testFile} runs clean`, false, error.message.split('\n')[0]);
    }
    await t.close?.();
  }

  // 5. control: a reader that ignores its tenant parameter must make the SAME file fail
  const bad = await freshDb(PGlite);
  await bad.exec(`
    create or replace function public.operator_content_evidence(p_gate text, p_client_id text)
    returns jsonb language plpgsql stable security definer set search_path to 'public'
    as $bad$
    begin
      if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
      return jsonb_build_object(
        'schema_version', 1, 'client_id', p_client_id, 'week_start', null,
        'freshness', jsonb_build_object('as_of', null, 'stale_after_days', 14, 'is_stale', false),
        'this_week', jsonb_build_object('coverage_line', '', 'candidates', '[]'::jsonb, 'missing_inputs', '[]'::jsonb),
        'winners', jsonb_build_object('market', coalesce((
            select jsonb_agg(jsonb_build_object('finding_id', f.finding_id, 'author_url', f.client_id))
              from public.client_research_findings f), '[]'::jsonb), 'own', '[]'::jsonb),
        'inputs', jsonb_build_object('study_state', 'validated', 'stored_posts', null,
          'eligible_posts', null, 'eligible_authors', null, 'publication_window', null,
          'last_successful_collection', null, 'connected_consumers', '[]'::jsonb,
          'sufficient_for_this_question', true, 'sufficiency_reason', null, 'gaps', '[]'::jsonb),
        'results', jsonb_build_object('choices', '[]'::jsonb, 'prior_failures', '[]'::jsonb));
    end $bad$;`);
  let controlRejected = false;
  try {
    await bad.exec(readFileSync(path.join(ROOT, 'db/tests/content_evidence_operator.sql'), 'utf8'));
  } catch {
    controlRejected = true;
  }
  record('control: a tenant-blind reader is rejected by the same assertions file', controlRejected);
  await bad.close?.();

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} sql checks passed`);
  return failed.length === 0 ? 0 : 1;
}

process.exit(await main());
