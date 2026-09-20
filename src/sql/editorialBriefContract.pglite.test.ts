/* ==========================================================================
   db/105_editorial_brief_contract.sql, executed.

   Same harness shape as src/sql/outreachPerf.pglite.test.ts and
   automation/content-evidence/release/sql-tests.mjs: a throwaway in-process
   PGlite instance that opens no socket, so nothing here can reach production.

   What it proves, in this order:
     1. the migration applies to a fresh instance, applies AGAIN unchanged
        (additive idempotency), rolls back, and applies once more
     2. the rollback removes exactly the objects 105 created and leaves the
        prerequisite objects (client_registry, lane_allowed, operator_gate_ok)
        untouched
     3. anon holds zero EXECUTE and zero table grants on anything 105 created
     4. db/tests/editorial_brief_contract.sql runs clean
     5. a CONTROL: the same assertions file MUST fail against a reader that
        ignores its tenant parameter. An assertions file that passes over a
        broken reader is not testing the boundary it claims to test.

   Prerequisites 105 does not create (the three Supabase roles, client_registry,
   lane_allowed from db/088, operator_gate_ok) are seeded here as minimal
   stand-ins, exactly as the existing content-evidence harness does.
   ========================================================================== */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MIGRATION = 'db/105_editorial_brief_contract.sql'
const ROLLBACK = 'db/105_editorial_brief_contract_rollback.sql'
const ASSERTIONS = 'db/tests/editorial_brief_contract.sql'

const migrationSql = readFileSync(MIGRATION, 'utf8')
const rollbackSql = readFileSync(ROLLBACK, 'utf8')
const assertionsSql = readFileSync(ASSERTIONS, 'utf8')

// The live operator gate hashes p_gate with pgcrypto, which PGlite does not ship. The literal
// stand-in keeps the shape that matters: a null gate returns FALSE, not null, so the null-gate
// assertion cannot pass for the wrong reason.
const BOOTSTRAP = `
create role anon; create role authenticated; create role service_role;

create table public.client_registry (
  client_id text primary key, display_name text, is_active boolean, platform jsonb);

create or replace function public.operator_gate_ok(p_gate text)
returns boolean language sql stable as $$ select coalesce(p_gate, '') = 'clientops' $$;
`

function laneAllowedSlice(): string {
  const src = readFileSync('db/088_lane_allowed.sql', 'utf8')
  const start = src.indexOf('create or replace function public.lane_allowed')
  const tail = 'grant execute on function public.lane_allowed(text) to service_role;'
  const end = src.indexOf(tail)
  if (start < 0 || end < 0) throw new Error('lane_allowed marker not found in db/088')
  return src.slice(start, end + tail.length)
}

async function freshDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(BOOTSTRAP)
  await db.exec(laneAllowedSlice())
  return db
}

async function migratedDb(): Promise<PGlite> {
  const db = await freshDb()
  await db.exec(migrationSql)
  return db
}

const EDITORIAL_TABLES = [
  'editorial_sources', 'editorial_source_curation', 'editorial_input_manifests',
  'editorial_batches', 'editorial_brief_versions', 'editorial_brief_sources',
  'editorial_decisions', 'editorial_brief_artifacts', 'editorial_current_batch',
  'editorial_refresh_requests', 'editorial_outcome_snapshots',
]

// A fresh PGlite plus the full migration replay outruns vitest's 5s default when the whole suite runs in parallel.
describe('db/105 editorial brief contract — migration', { timeout: 60_000 }, () => {
  it('applies, re-applies unchanged, rolls back and applies again', async () => {
    const db = await freshDb()
    await db.exec(migrationSql)

    const first = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public' and tablename like 'editorial\\_%'`)
    expect(first.rows[0].n).toBe(EDITORIAL_TABLES.length)

    // Additive idempotency: a second application changes nothing and raises nothing.
    await db.exec(migrationSql)
    const second = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public' and tablename like 'editorial\\_%'`)
    expect(second.rows[0].n).toBe(first.rows[0].n)

    // A replay never duplicates a trigger either.
    const trig = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relname like 'editorial\\_%' and not t.tgisinternal`)
    expect(trig.rows[0].n).toBe(9)

    await db.exec(rollbackSql)
    const afterRollback = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public' and tablename like 'editorial\\_%'`)
    expect(afterRollback.rows[0].n).toBe(0)

    await db.exec(migrationSql)
    const again = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public' and tablename like 'editorial\\_%'`)
    expect(again.rows[0].n).toBe(EDITORIAL_TABLES.length)
    await db.close?.()
  })

  it('rolls back only what it created — prerequisites survive untouched', async () => {
    const db = await migratedDb()
    await db.exec(`insert into public.client_registry (client_id, display_name, is_active, platform)
      values ('t-alpha', 'Alpha', true,
        '{"measurement":{"roster":[{"account":"a1"}]}}'::jsonb)`)

    await db.exec(rollbackSql)

    // The shared historical objects the rollback must never reach.
    const reg = await db.query<{ n: number }>(`select count(*)::int as n from public.client_registry`)
    expect(reg.rows[0].n).toBe(1)
    const fns = await db.query<{ proname: string }>(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname in ('lane_allowed', 'operator_gate_ok')`)
    expect(fns.rows.map(r => r.proname).sort()).toEqual(['lane_allowed', 'operator_gate_ok'])

    // And nothing 105 created is left behind.
    const left = await db.query<{ proname: string }>(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname like 'editorial\\_%'`)
    expect(left.rows).toEqual([])
    await db.close?.()
  })

  it('grants anon nothing at all', async () => {
    const db = await migratedDb()
    const routines = await db.query<{ routine_name: string }>(
      `select routine_name from information_schema.role_routine_grants where grantee = 'anon'`)
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants where grantee = 'anon'`)
    expect(routines.rows).toEqual([])
    expect(tables.rows).toEqual([])
    await db.close?.()
  })

  it('enables row level security on every table it creates', async () => {
    const db = await migratedDb()
    const rls = await db.query<{ tablename: string }>(
      `select tablename from pg_tables
        where schemaname = 'public' and tablename like 'editorial\\_%' and not rowsecurity`)
    expect(rls.rows).toEqual([])
    await db.close?.()
  })
})

describe('db/tests/editorial_brief_contract.sql', { timeout: 60_000 }, () => {
  it('runs clean against the real migration', async () => {
    const db = await migratedDb()
    await expect(db.exec(assertionsSql)).resolves.toBeDefined()
    await db.close?.()
  })

  it('CONTROL: the same file fails against a tenant-blind reader', async () => {
    const db = await migratedDb()
    // A reader that answers with whatever rows exist, ignoring p_client_id entirely.
    await db.exec(`
      create or replace function public.editorial_read_briefs(
        p_gate text, p_client_id text, p_batch_id text default null,
        p_cursor text default null, p_limit integer default 25)
      returns jsonb language plpgsql stable security definer set search_path to 'public'
      as $bad$
      begin
        if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
        return jsonb_build_object(
          'schema_version', 1, 'client_id', p_client_id, 'batch_id', p_batch_id,
          'state', 'ready', 'total', 1, 'next_cursor', null, 'coverage_gaps', '[]'::jsonb,
          'items', coalesce((select jsonb_agg(v.payload) from public.editorial_brief_versions v),
                            '[]'::jsonb));
      end $bad$;`)
    await expect(db.exec(assertionsSql)).rejects.toThrow()
    await db.close?.()
  })
})
