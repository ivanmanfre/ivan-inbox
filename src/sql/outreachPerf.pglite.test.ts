import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

type Cell = { step: string; n: number; replies: number; rate: number; base_n: number; base_rate: number; status: string; positive_rate: number | null }
type Lane = { lane: string; campaigns: string[]; cells: Cell[]; variants: { step: string; variant: string; n: number; replies: number; rate: number; others_n: number; status: string }[]; splits: { step: string; dim: string; value: string; n: number; replies: number }[]; alarms: unknown[]; table: unknown[] }
type Payload = { ok: boolean; lanes: Lane[]; reply_basis: { threaded: number; stamp_only: number } }

let db: PGlite
async function payload(client: string): Promise<Payload> {
  const r = await db.query<{ p: Payload }>('select outreach_perf_payload($1, 90) as p', [client])
  return r.rows[0].p
}
const lane = (p: Payload, name: string) => p.lanes.find(l => l.lane === name)
const cell = (p: Payload, l: string, step: string) => lane(p, l)?.cells.find(c => c.step === step)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync('src/sql/fixtures/outreach-perf.sql', 'utf8'))
  await db.exec(readFileSync('db/056_lane_quiet_on_linkedin.sql', 'utf8'))
  // Supabase ships anon/authenticated/service_role; PGlite does not, and 069 grants to them.
  await db.exec(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;`)
  await db.exec(readFileSync('db/069_outreach_perf_payload.sql', 'utf8'))
})

describe('outreach_perf_payload counts', () => {
  it('counts matured DM sends per lane and step, excluding immature, mirrors, archived', async () => {
    const p = await payload('risedtc')
    expect(p.ok).toBe(true)
    // cold DM1 current = 71 + 40 + 1 reaction-prospect = 112 sends, 8 replies (reaction excluded)
    const cold = cell(p, 'cold', 'dm1')!
    expect(cold.n).toBe(112)
    expect(cold.replies).toBe(8)
    expect(cold.base_n).toBe(250)
    expect(cold.base_rate).toBeCloseTo(0.16, 3)
    expect(cold.positive_rate).toBeCloseTo(8 / 112, 3)
    expect(lane(p, 'cold')!.campaigns).toEqual(['RiseDTC — Cold (DTC Sales Nav)'])
  })
  it('marks an under-floor cell thin and never drift', async () => {
    const p = await payload('risedtc')
    const nudge = cell(p, 'warm', 'nudge')!
    expect(nudge.n).toBe(12)
    expect(nudge.status).toBe('thin')
  })
  it('hides archived campaigns entirely', async () => {
    const p = await payload('arch')
    expect(p.lanes).toEqual([])
  })
  it('maps ivan to client_id null and counts stamp-only replies', async () => {
    const p = await payload('ivan')
    const c = cell(p, 'cold', 'dm1')!
    // 40 seeded + the intervening-nudge prospect, whose stamped reply belongs to the nudge, not DM1
    expect(c.n).toBe(41)
    expect(c.replies).toBe(4)
    expect(c.positive_rate).toBeNull()
    expect(p.reply_basis.stamp_only).toBe(4)
  })
  it('scores a stamped reply to the later send, not the earlier DM', async () => {
    const p = await payload('ivan')
    const rows = await db.query<{ n: number }>(
      `select count(*)::int as n from outreach_prospects pr
         join outreach_campaigns c on c.id = pr.campaign_id
        where c.client_id is null and pr.last_reply_at is not null`)
    // 5 Ivan prospects carry a reply stamp, but only 4 are credited to a DM1 send
    expect(rows.rows[0].n).toBe(5)
    expect(cell(p, 'cold', 'dm1')!.replies).toBe(4)
  })
  it('pairs sibling variants with each other as others', async () => {
    const p = await payload('risedtc')
    const v = lane(p, 'warm')!.variants.filter(x => x.step === 'dm1')
    expect(v.find(x => x.variant === 'rise_dm1_b')).toMatchObject({ n: 40, replies: 12, others_n: 35, status: 'ok' })
    expect(v.find(x => x.variant === 'rise_dm1_c')).toMatchObject({ n: 35, replies: 1, others_n: 40, status: 'sibling' })
  })
  it('splits the current window by source with counts', async () => {
    const p = await payload('risedtc')
    const s = lane(p, 'cold')!.splits.filter(x => x.step === 'dm1' && x.dim === 'source')
    expect(s.find(x => x.value === 'competitor_engagers')).toMatchObject({ n: 71, replies: 2 })
    expect(s.find(x => x.value === 'own_engagers')).toMatchObject({ n: 41, replies: 6 })
  })
})

describe('outreach_perf_payload alarms', () => {
  it('fires drift on RISE cold DM1 and blames source competitor_engagers', async () => {
    const p = await payload('risedtc')
    const cold = lane(p, 'cold')!
    expect(cell(p, 'cold', 'dm1')!.status).toBe('drift')
    const a = cold.alarms.find((x: any) => x.kind === 'drift' && x.step === 'dm1') as any
    expect(a).toBeTruthy()
    expect(a.now_n).toBe(112)
    expect(a.prior_rate).toBeCloseTo(0.16, 3)
    expect(a.suspect_dim).toBe('source')
    expect(a.split.find((s: any) => s.value === 'competitor_engagers')).toMatchObject({ n: 71, replies: 2 })
    expect(a.suspect_share).toBeGreaterThan(0.5)
  })
  it('fires sibling on RISE warm DM1 variant C against B', async () => {
    const p = await payload('risedtc')
    const warm = lane(p, 'warm')!
    expect(warm.variants.find(v => v.variant === 'rise_dm1_c')!.status).toBe('sibling')
    expect(warm.variants.find(v => v.variant === 'rise_dm1_b')!.status).toBe('ok')
    const a = warm.alarms.find((x: any) => x.kind === 'sibling') as any
    expect(a.variant).toBe('rise_dm1_c')
    expect(a.prior_rate).toBeCloseTo(12 / 40, 3)
  })
  it('never fires on a thin cell or a healthy cell', async () => {
    const p = await payload('risedtc')
    expect(cell(p, 'warm', 'nudge')!.status).toBe('thin')
    expect(cell(p, 'warm', 'dm1')!.status).not.toBe('drift')
    const ivan = await payload('ivan')
    expect(cell(ivan, 'cold', 'dm1')!.status).toBe('thin') // no baseline rows
    expect(lane(ivan, 'cold')!.alarms).toEqual([])
  })
})
