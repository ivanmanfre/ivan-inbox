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
  await db.exec(readFileSync('db/081_outreach_perf_payload.sql', 'utf8'))
  await db.exec(readFileSync('db/092_outreach_perf_viewed_back.sql', 'utf8'))
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
  it('keeps an inactive campaign that still sends and drops one that stopped', async () => {
    const p = await payload('risedtc')
    const flags = await db.query<{ id: string; is_active: boolean }>(
      `select id, is_active from outreach_campaigns where client_id = 'risedtc' order by id`)
    expect(flags.rows.filter(r => !r.is_active).map(r => r.id.slice(-2))).toEqual(['c1', 'c5'])
    // c1 is inactive but sent inside the current window: whole lane stays, baseline rows included
    expect(cell(p, 'cold', 'dm1')).toMatchObject({ n: 112, base_n: 250 })
    // c5 is inactive and only sent 40 days ago: no lane at all
    expect(lane(p, 'partner')).toBeUndefined()
    expect(p.lanes.map(l => l.lane)).toEqual(['cold', 'warm'])
  })
  it('folds country spellings into one bucket before the split', async () => {
    const p = await payload('risedtc')
    const s = lane(p, 'cold')!.splits.filter(x => x.step === 'dm1' && x.dim === 'country')
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ value: 'US', n: 112 })
    const raw = await db.query<{ n: number }>(`select count(distinct country)::int as n from outreach_prospects where campaign_id = '00000000-0000-0000-0000-0000000000c1'`)
    expect(raw.rows[0].n).toBe(3) // 'US', 'United States', 'usa' on disk
  })
  it('maps ivan to client_id null and counts stamp-only replies', async () => {
    const p = await payload('ivan')
    const c = cell(p, 'cold', 'dm1')!
    // 40 seeded + the intervening-nudge prospect, whose stamped reply belongs to the nudge, not DM1
    expect(c.n).toBe(41)
    expect(c.replies).toBe(4)
    expect(c.positive_rate).toBeNull()
    expect(p.reply_basis.stamp_only).toBe(16) // dm1: 4 current + 3 baseline; nudge: 1 current + 8 baseline
  })
  it('scores a stamped reply to the later send, not the earlier DM', async () => {
    const p = await payload('ivan')
    const rows = await db.query<{ n: number }>(
      `select count(*)::int as n from outreach_prospects pr
         join outreach_campaigns c on c.id = pr.campaign_id
        where c.client_id is null and pr.last_reply_at is not null`)
    // 17 Ivan prospects carry a reply stamp (dm1 4 current + 3 baseline, nudge 1 + 8, 1 immature-nudge prospect),
    // but only 4 are credited to a current DM1 send
    expect(rows.rows[0].n).toBe(17)
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
    const c = cell(ivan, 'cold', 'dm1')!
    expect(c.base_n).toBe(60)
    expect(c.rate).toBeGreaterThan(c.base_rate) // 4/41 above a 5% baseline: healthy
    expect(c.status).toBe('ok')
    expect(lane(ivan, 'cold')!.alarms.filter((x: any) => x.step === 'dm1')).toEqual([])
  })
  it('breaks an attribution tie between dims deterministically', async () => {
    const p = await payload('risedtc')
    const s = lane(p, 'cold')!.splits.filter(x => x.step === 'dm1')
    // vertical games is the same 71 prospects as source competitor_engagers, so both dims tie on worst_missing
    expect(s.find(x => x.dim === 'vertical' && x.value === 'games')).toMatchObject({ n: 71, replies: 2 })
    const a = lane(p, 'cold')!.alarms.find((x: any) => x.kind === 'drift' && x.step === 'dm1') as any
    expect(a.suspect_dim).toBe('source') // alphabetical tie-break: source before vertical
    expect(a.suspect_share).toBeLessThanOrEqual(1)
  })
  it('fires drift with no suspect when every split is the whole cell', async () => {
    const p = await payload('risedtc')
    expect(cell(p, 'cold', 'nudge')).toMatchObject({ n: 40, replies: 0, base_n: 60, status: 'drift' })
    const a = lane(p, 'cold')!.alarms.find((x: any) => x.kind === 'drift' && x.step === 'nudge') as any
    expect(a).toMatchObject({ suspect_dim: null, suspect_share: null, split: [] })
    expect(a.prior_rate).toBeCloseTo(0.2, 3)
  })
  it('names no suspect when the only large child leaves fewer than child_floor sends outside it', async () => {
    const p = await payload('risedtc')
    expect(cell(p, 'cold', 'dm3')).toMatchObject({ n: 105, replies: 3, base_n: 200, status: 'drift' })
    const s = lane(p, 'cold')!.splits.filter(x => x.step === 'dm3' && x.dim === 'source')
    expect(s.find(x => x.value === 'mono_source')).toMatchObject({ n: 100, replies: 3 }) // leaves only 5 outside
    expect(s.find(x => x.value === 'tiny_source')).toMatchObject({ n: 5, replies: 0 })   // under the child floor
    const a = lane(p, 'cold')!.alarms.find((x: any) => x.kind === 'drift' && x.step === 'dm3') as any
    expect(a).toMatchObject({ suspect_dim: null, suspect_share: null, split: [] })
    expect(a.prior_rate).toBeCloseTo(0.15, 3)
  })
  it('names no suspect when the only eligible child is above baseline', async () => {
    const p = await payload('risedtc')
    // 13/46 (28.3%) against 40/100 (40.0%): the cell drifts
    expect(cell(p, 'cold', 'inmail')).toMatchObject({ n: 46, replies: 13, base_n: 100, base_replies: 40, status: 'drift' })
    const s = lane(p, 'cold')!.splits.filter(x => x.step === 'inmail' && x.dim === 'source')
    expect(s.find(x => x.value === 'good_source')).toMatchObject({ n: 30, replies: 13 }) // 43.3%, ABOVE the 40% baseline
    expect(s.find(x => x.value === 'bad_a')).toMatchObject({ n: 8, replies: 0 })         // under the child floor
    expect(s.find(x => x.value === 'bad_b')).toMatchObject({ n: 8, replies: 0 })         // under the child floor
    const a = lane(p, 'cold')!.alarms.find((x: any) => x.kind === 'drift' && x.step === 'inmail') as any
    // good_source is the only child clearing both floors and it is MISSING nothing (12 expected, 13 got),
    // so attribution must stay empty rather than name a suspect with a negative share
    expect(a).toMatchObject({ suspect_dim: null, suspect_share: null, split: [] })
    expect(a.prior_rate).toBeCloseTo(0.4, 3)
  })
  it('fires drift on a cell between 20 and 30 sends, the noise floor', async () => {
    const p = await payload('ivan')
    expect(cell(p, 'cold', 'nudge')).toMatchObject({ n: 24, replies: 1, base_n: 26, base_replies: 8, status: 'drift' })
    const a = lane(p, 'cold')!.alarms.find((x: any) => x.kind === 'drift' && x.step === 'nudge') as any
    expect(a).toMatchObject({ prior_n: 26, now_n: 24 })
    expect(a.prior_rate).toBeCloseTo(8 / 26, 3)
    // the floor is 20, not lower: a 12-send cell is still thin
    const rise = await payload('risedtc')
    expect(cell(rise, 'warm', 'nudge')).toMatchObject({ n: 12, status: 'thin' })
    // and the healthy Ivan dm1 cell (41/4 vs 60/3) is still ok
    expect(cell(p, 'cold', 'dm1')!.status).toBe('ok')
  })
})

describe('outreach_perf_payload viewed back (092)', () => {
  it('counts a recipient once however often the view was re-captured, and only on the sending seat inside 14 days', async () => {
    type V = { viewed_n: number; viewed_rate: number | null }
    const before = cell(await payload('risedtc'), 'cold', 'dm1') as unknown as V
    expect(before.viewed_n).toBe(0)
    const sends = await db.query<{ prospect_id: string; sent_at: string }>(`
      select m.prospect_id, m.sent_at from outreach_messages m
      join outreach_prospects pr on pr.id = m.prospect_id join outreach_campaigns c on c.id = pr.campaign_id
      where c.client_id = 'risedtc' and c.name like '%Cold%' and m.direction = 'outbound' and m.message_type = 'dm'
        and coalesce(m.sequence_step, 1) <= 1 and coalesce(m.ai_model, '') <> 'manual_mirror'
        and m.sent_at >= now() - interval '21 days' and m.sent_at <= now() - interval '7 days'
      order by m.sent_at, m.prospect_id limit 4`)
    const [a, b, c, d] = sends.rows
    await db.query(`insert into profile_view_log (seat, prospect_id, viewed_at) values
      ('risedtc', $1, $2::timestamptz + interval '1 day'),
      ('risedtc', $1, $2::timestamptz + interval '2 days'),
      ('ivan',    $3, $4::timestamptz + interval '1 day'),
      ('risedtc', $5, $6::timestamptz - interval '1 day'),
      ('risedtc', $7, $8::timestamptz + interval '15 days')`,
      [a.prospect_id, a.sent_at, b.prospect_id, b.sent_at, c.prospect_id, c.sent_at, d.prospect_id, d.sent_at])
    const p = await payload('risedtc')
    const after = cell(p, 'cold', 'dm1') as unknown as V & { n: number; replies: number }
    expect(after.viewed_n).toBe(1)
    expect(after.viewed_rate).toBeCloseTo(1 / 112, 3)
    // display only: the reply counts and the alarm set are untouched by a view
    expect(after).toMatchObject({ n: 112, replies: 8 })
    const vs = lane(p, 'cold')!.variants.filter(v => v.step === 'dm1') as unknown as V[]
    expect(vs.reduce((n, v) => n + v.viewed_n, 0)).toBe(1)
  })
})
