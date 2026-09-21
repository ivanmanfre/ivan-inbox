import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeCollectorRow } from '../lib/editorialCollectorBridge'

const sql105 = readFileSync('db/105_editorial_brief_contract.sql', 'utf8')
const sql106 = readFileSync('db/106_editorial_refresh.sql', 'utf8')
const src088 = readFileSync('db/088_lane_allowed.sql', 'utf8')
const start = src088.indexOf('create or replace function public.lane_allowed')
const tail = 'grant execute on function public.lane_allowed(text) to service_role;'
const laneSlice = src088.slice(start, src088.indexOf(tail) + tail.length)

async function setup() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.client_registry (client_id text primary key, display_name text, is_active boolean, platform jsonb);
    create or replace function public.operator_gate_ok(p_gate text) returns boolean language sql stable
      as $$ select coalesce(p_gate,'')='clientops' $$;`)
  await db.exec(laneSlice)
  await db.exec(sql105)
  await db.exec(sql106)
  await db.exec(sql106)
  await db.exec(`insert into public.client_registry(client_id,display_name,is_active,platform) values
    ('ivan','Ivan',true,'{"measurement":{"roster":[{"account":"ivan"}]}}'),
    ('risedtc','RISE',true,'{"measurement":{"roster":[{"account":"rise"}]}}')`)
  return db
}

describe('106 editorial refresh transaction', { timeout: 60_000 }, () => {
  it('requires explicit direction; deduplicates requests and unchanged inputs; preserves usable pointer after empty output', async () => {
    const db = await setup()
    const lease1 = await db.query<{ v: boolean }>(`select public.editorial_claim_bridge('clientops','ivan','first') v`)
    const lease2 = await db.query<{ v: boolean }>(`select public.editorial_claim_bridge('clientops','ivan','second') v`)
    expect(lease1.rows[0].v).toBe(true)
    expect(lease2.rows[0].v).toBe(false)
    await db.query(`select public.editorial_release_bridge('clientops','ivan','first')`)
    const lease3 = await db.query<{ v: boolean }>(`select public.editorial_claim_bridge('clientops','ivan','second') v`)
    expect(lease3.rows[0].v).toBe(true)
    await db.query(`select public.editorial_release_bridge('clientops','ivan','second')`)
    const denied = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','ivan','draft-note','r0') result`)
    expect(denied.rows[0].result.conflict.reason).toBe('stale_direction_version')
    const adopted = await db.query<{ result: any }>(`select public.editorial_adopt_direction('clientops','ivan',null,
      '{"audience":"operators","topic":"source-backed"}'::jsonb,'reviewed seed','explicit acceptance','a1') result`)
    const version = adopted.rows[0].result.active_version
    const begin = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','ivan',$1,'r1') result`, [version])
    const receipt = begin.rows[0].result
    expect(receipt.status).toBe('running')
    expect(receipt.starts_acquisition).toBe(false)
    const replay = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','ivan',$1,'r1') result`, [version])
    expect(replay.rows[0].result.refresh_id).toBe(receipt.refresh_id)
    expect(replay.rows[0].result.deduplicated).toBe(true)
    const inFlight = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','ivan',$1,'r2') result`, [version])
    expect(inFlight.rows[0].result.conflict.reason).toBe('in_flight')
    const finished = await db.query<{ result: any }>(`select public.editorial_finish_refresh('clientops','ivan',$1,'[]'::jsonb,
      'local-test','v1','[]'::jsonb,null) result`, [receipt.refresh_id])
    expect(finished.rows[0].result.status).toBe('empty')
    expect(finished.rows[0].result.last_usable_batch_id).toBeNull()
    const retry = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','ivan',$1,'r3') result`, [version])
    expect(retry.rows[0].result.status).toBe('running')
    const other = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','risedtc',$1,'r4') result`, [version])
    expect(other.rows[0].result.conflict.reason).toBe('stale_direction_version')
  })

  it('keeps a candidate snapshot hash stable across read clocks when native capture time is unavailable', async () => {
    const candidate = { id: 'candidate-next', raw_context: 'Derived summary; source body unavailable.',
      evidence: 'A candidate suggests a topic.', editorial_assessment: 'Provisional',
      editorial_strength: 'unknown', angle_options: [] }
    const a = await normalizeCollectorRow('ivan', 'lm_idea_candidates', candidate, '2026-09-21T01:00:00Z')
    const b = await normalizeCollectorRow('ivan', 'lm_idea_candidates', candidate, '2026-09-22T01:00:00Z')
    expect(a.snapshot_hash).toBe(b.snapshot_hash)
    expect(a.captured_at).not.toBe(b.captured_at)
    expect(a.gap_state?.reason).toBe('partial')
    expect(a.body_sha256).toBeNull()
  })
})
