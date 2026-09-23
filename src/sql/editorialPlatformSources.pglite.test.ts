import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-ignore Local acquisition normalizer is intentionally plain ESM.
import { normalizePlatformSource, PLATFORM_QUERY_CONFIGS } from '../../automation/content-evidence/platform-sources.mjs'
import { selectSynthesisSources } from '../lib/editorialSelection'

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
  await db.exec(`create view public.editorial_eligible_outcome_snapshots_v as
    select * from public.editorial_outcome_snapshots`)
  await db.exec(sql106)
  await db.exec(`insert into public.client_registry(client_id,display_name,is_active,platform) values
    ('ivan','Ivan',true,'{"measurement":{"roster":[{"account":"ivan"}]}}'),
    ('risedtc','RISE',true,'{"measurement":{"roster":[{"account":"rise"}]}}'),
    ('arch','ARCH',true,'{"measurement":{"roster":[{"account":"arch"}]}}')`)
  return db
}

describe('platform source to frozen Refresh manifest', { timeout: 60_000 }, () => {
  it('delivers eligible X and Reddit rows for every registered client through the real manifest and selector', async () => {
    const db = await setup()
    for (const clientId of ['ivan', 'risedtc', 'arch'] as const) {
      for (const platform of ['x', 'reddit'] as const) {
        const x = platform === 'x'
        const source = await normalizePlatformSource({ clientId, platform,
          queryConfigId: PLATFORM_QUERY_CONFIGS[clientId][platform].id, observedAt: '2026-09-22T10:00:00Z',
          row: { id: `${clientId}-${platform}`, url: x
            ? `https://x.com/example/status/${clientId}` : `https://reddit.com/r/example/comments/${clientId}`,
            text: `${clientId} ${platform} retained original body`, created_at: '2026-09-21T10:00:00Z',
            permission_state: 'public_source', provider: 'apify', provider_run_id: `run-${clientId}-${platform}`,
            query_input: { query: `${clientId} topic`, sort: 'Latest' },
            ...(x ? { likes: 1, replies: 0, reposts: 0, quotes: 0, views: 10 } : { score: 1, comments: 0 }) } })
        const entries = Object.entries(source)
        const columns = entries.map(([key]) => `"${key}"`).join(',')
        const values = entries.map(([, value]) => typeof value === 'object' && value !== null ? JSON.stringify(value) : value)
        const casts = entries.map(([key], index) => `$${index + 1}${['gap_state', 'candidate_fields'].includes(key) ? '::jsonb' : ''}`).join(',')
        await db.query(`insert into public.editorial_sources(${columns}) values(${casts})`, values)
      }
      const adopted = await db.query<{ result: any }>(`select public.editorial_adopt_direction(
        'clientops',$1,null,'{"audience":"operators"}'::jsonb,'test','test',$2) result`, [clientId, `adopt-${clientId}`])
      const version = adopted.rows[0].result.active_version
      const begun = await db.query<{ result: any }>(`select public.editorial_begin_refresh(
        'clientops',$1,$2,$3) result`, [clientId, version, `refresh-${clientId}`])
      const batchId = begun.rows[0].result.batch_id
      const manifest = await db.query<{ source_refs: Array<{ source_id: string; seen_version: number }> }>(`
        select m.source_refs from public.editorial_input_manifests m join public.editorial_batches b
          on b.client_id=m.client_id and b.input_manifest_hash=m.input_manifest_hash
        where b.client_id=$1 and b.batch_id=$2`, [clientId, batchId])
      expect(manifest.rows[0].source_refs.map(ref => ref.source_id).sort()).toEqual([
        `reddit:${clientId}-reddit`, `x:${clientId}-x`])
      const rows = await db.query<any>(`select * from public.editorial_sources where client_id=$1`, [clientId])
      const selected = selectSynthesisSources(rows.rows, 24)
      expect(selected.selected.map(row => row.candidate_fields.source_identity.platform).sort()).toEqual(['reddit', 'x'])
    }
  })
})
