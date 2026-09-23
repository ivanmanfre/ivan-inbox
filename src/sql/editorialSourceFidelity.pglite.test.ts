import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeCollectorRow, normalizeVerifiedCall } from '../lib/editorialCollectorBridge'
import { parseSourceItem } from '../lib/editorialSources'
import { prepareSynthesisContext } from '../lib/editorialSynthesisContext'

const sql105 = readFileSync('db/105_editorial_brief_contract.sql', 'utf8')
const sql106 = readFileSync('db/106_editorial_refresh.sql', 'utf8')
const source088 = readFileSync('db/088_lane_allowed.sql', 'utf8')
const laneStart = source088.indexOf('create or replace function public.lane_allowed')
const laneEnd = 'grant execute on function public.lane_allowed(text) to service_role;'
const laneSql = source088.slice(laneStart, source088.indexOf(laneEnd) + laneEnd.length)
const replay = { client_post_metrics: [
  { id:'synthetic-1',client_id:'risedtc',social_id:'post-1',full_text:'Complete synthetic retained body.',published_at:'2026-09-01T00:00:00Z',captured_at:'2026-09-20T00:00:00Z',impressions:10,reactions:2,comments:1,shares:0 },
  { id:'synthetic-2',client_id:'risedtc',social_id:'post-2',full_text:'Synthetic retained excerpt two.',published_at:'2026-09-02T00:00:00Z',captured_at:'2026-09-20T00:00:00Z',impressions:20,reactions:3,comments:2,shares:1 },
  { id:'synthetic-3',client_id:'risedtc',social_id:'post-3',full_text:'Synthetic retained excerpt three.',published_at:'2026-09-03T00:00:00Z',captured_at:'2026-09-20T00:00:00Z',impressions:30,reactions:4,comments:3,shares:2 },
] }
const recovery = { matches: replay.client_post_metrics.map((row,index) => ({ metrics_id:row.id,
  social_id:row.social_id,native_id:`native-${index+1}`,native_chars:row.full_text.length,
  native_sha256:createHash('sha256').update(row.full_text).digest('hex'),exact_prefix_match:true,
  exact_body_match:index===0 })) }

async function setup() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.client_registry(client_id text primary key,display_name text,is_active boolean,platform jsonb);
    create or replace function public.operator_gate_ok(p_gate text) returns boolean language sql stable
      as $$ select coalesce(p_gate,'')='clientops' $$;`)
  await db.exec(laneSql)
  await db.exec(sql105)
  await db.exec(sql106)
  await db.exec(`insert into public.client_registry(client_id,display_name,is_active,platform) values
    ('risedtc','RISE',true,'{"measurement":{"roster":[{"account":"rise"}]}}'),
    ('arch','ARCH',true,'{"measurement":{"roster":[{"account":"arch"}]}}')`)
  return db
}

async function insertSnapshot(db: PGlite, source: Record<string, unknown>) {
  const columns = Object.keys(source)
  await db.query(`insert into public.editorial_sources(${columns.join(',')})
    values(${columns.map((_, index) => `$${index + 1}`).join(',')})`,
  columns.map(key => {
    const value = source[key]
    return value && typeof value === 'object' ? JSON.stringify(value) : value
  }))
}

async function importSnapshots(db: PGlite, sources: Record<string, unknown>[]) {
  const current = await db.query<{ source_id: string; snapshot_hash: string }>(
    `select source_id,snapshot_hash from public.editorial_sources where client_id='risedtc'`)
  const seen = new Set(current.rows.map(row => `${row.source_id}:${row.snapshot_hash}`))
  const fresh = sources.filter(source => !seen.has(`${source.source_id}:${source.snapshot_hash}`))
  for (const source of fresh) await insertSnapshot(db, source)
  return fresh.length
}

describe('limited retained RISE source fidelity replay', { timeout: 60_000 }, () => {
  it('round-trips retained captures through adapter, SQL, reader and model input without replay duplicates', async () => {
    const retained = recovery.matches
    const rows = replay.client_post_metrics.filter(row => retained.some(match => match.metrics_id === row.id))
    expect(rows).toHaveLength(3)
    const inputHash = createHash('sha256').update(JSON.stringify(replay)).digest('hex')
    expect(inputHash).toMatch(/^[a-f0-9]{64}$/)
    const normalized = await Promise.all(rows.map(async row => {
      const match = retained.find(item => item.metrics_id === row.id)!
      return normalizeCollectorRow('risedtc', 'client_post_metrics', {
        ...row,
        body_state: match.exact_body_match === true ? 'full' : 'excerpt',
        body_provenance: `retained_native_recovery:${String(match.native_sha256)}`,
        native_body_recovery: { source_id: String(match.social_id), native_id: String(match.native_id),
          body_chars: Number(match.native_chars), body_sha256: String(match.native_sha256),
          exact_prefix_match: match.exact_prefix_match === true, exact_body_match: match.exact_body_match === true },
      }, '2026-09-21T18:00:00.000Z')
    }))
    expect(normalized.map(source => source.candidate_fields?.body_state).sort()).toEqual(['excerpt', 'excerpt', 'full'])

    const db = await setup()
    const firstInsertCount = await importSnapshots(db, normalized)
    const hashesAfterFirst = await db.query<{ source_id: string; snapshot_hash: string; seen_version: number; candidate_fields: Record<string, unknown> }>(
      `select source_id,snapshot_hash,seen_version,candidate_fields from public.editorial_sources where client_id='risedtc' order by source_id`)
    const secondInsertCount = await importSnapshots(db, normalized)
    const hashesAfterSecond = await db.query<{ source_id: string; snapshot_hash: string; seen_version: number }>(
      `select source_id,snapshot_hash,seen_version from public.editorial_sources where client_id='risedtc' order by source_id`)
    expect(firstInsertCount).toBe(3)
    expect(secondInsertCount).toBe(0)
    expect(hashesAfterSecond.rows).toEqual(hashesAfterFirst.rows.map(({ candidate_fields: _fields, ...identity }) => identity))

    const reader = await db.query<{ payload: Record<string, unknown> }>(
      `select public.editorial_read_research('clientops','risedtc','{}'::jsonb,null,50) payload`)
    const wireItems = reader.rows[0].payload.items as unknown[]
    const parsed = wireItems.map(item => parseSourceItem(item, 'risedtc'))
    expect(parsed.every(item => item.ok)).toBe(true)
    const sources = parsed.flatMap(item => item.ok ? [item.item] : [])
    const model = prepareSynthesisContext({ sources: sources as never, outcomes: [],
      render: parts => [{ role: 'user', content: JSON.stringify(parts) }] })
    const rendered = JSON.parse(model.messages[0].content) as { selected: Array<{ source_id: string; candidate_fields: Record<string, unknown> }> }
    for (const source of normalized) {
      const adapterFields = source.candidate_fields as Record<string, unknown>
      const stored = hashesAfterFirst.rows.find(row => row.source_id === source.source_id)!.candidate_fields
      const readable = sources.find(item => item.source_id === source.source_id)!
      const supplied = rendered.selected.find(item => item.source_id === source.source_id)!.candidate_fields
      expect(stored.observed_metrics).toEqual(adapterFields.observed_metrics)
      expect(readable.observed_metrics).toEqual(adapterFields.observed_metrics)
      expect(supplied.observed_metrics).toEqual(adapterFields.observed_metrics)
      expect(supplied.metric_source).toBe(adapterFields.metric_source)
      expect(supplied.metric_denominator).toBe(adapterFields.metric_denominator)
      expect(supplied.observation_window).toEqual(adapterFields.observation_window)
      expect(supplied.body_state).toBe(adapterFields.body_state)
      expect(supplied.source_identity).toEqual(adapterFields.source_identity)
    }

    const privateCall = await normalizeVerifiedCall('risedtc', [{ candidate_id: 'private-candidate',
      transcript_id: 'private-transcript', transcript_date: '2026-09-20T00:00:00Z', transcript_sha256: 'b'.repeat(64),
      transcript_text_sha256: 'c'.repeat(64), transcript_json_sha256: 'd'.repeat(64),
      excerpt: 'A private verified passage.', excerpt_sha256: 'c'.repeat(64), permission_state: 'granted',
      participants: null, transcript_source: 'local-test', speaker_name: 'Buyer Name', speaker_role: 'third_party',
      attribution_state: 'verified', segment_index: 1, segment_start: '00:00:10', segment_end: null,
      quote_start: 0, quote_end: 27 }])
    await insertSnapshot(db, privateCall)
    const archReader = await db.query<{ payload: Record<string, unknown> }>(
      `select public.editorial_read_research('clientops','arch','{}'::jsonb,null,50) payload`)
    expect(archReader.rows[0].payload.items).toEqual([])
    expect(JSON.stringify(archReader.rows[0].payload)).not.toContain('private-transcript')
  })
})
