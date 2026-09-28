import { describe, expect, it } from 'vitest'
import { mixOf, type SeatSends } from './sendsByLane'

const NOW = Date.parse('2026-09-28T10:00:00Z') // 12:00 Warsaw
const at = (iso: string) => iso

describe('invites sent, by lane', () => {
  const arch: SeatSends = { campaigns: { c1: 'ARCH. Influencer Agency — Cold' }, rows: [
    { campaign_id: 'c1', sent_at: at('2026-09-28T06:10:00Z'), lane: 'company_expansion', vertical: 'apps' },
    { campaign_id: 'c1', sent_at: at('2026-09-28T06:20:00Z'), lane: 'company_expansion', vertical: 'games' },
    { campaign_id: 'c1', sent_at: at('2026-09-28T06:30:00Z'), lane: 'company_expansion', vertical: 'apps' },
    { campaign_id: 'c1', sent_at: at('2026-09-28T07:00:00Z'), lane: 'engager_warm', vertical: 'games' },
    { campaign_id: 'c1', sent_at: at('2026-09-28T07:30:00Z'), lane: 'hiring_signal', vertical: null },
    // 23:30 UTC on the 27th is already the 28th in Warsaw
    { campaign_id: 'c1', sent_at: at('2026-09-27T22:30:00Z'), lane: 'engager_warm', vertical: 'd2c' },
    { campaign_id: 'c1', sent_at: at('2026-09-25T08:00:00Z'), lane: 'company_expansion', vertical: 'pc' },
    { campaign_id: 'c1', sent_at: at('2026-09-10T08:00:00Z'), lane: 'company_expansion', vertical: 'pc' },
  ] }

  it('Arch today: lanes largest first, each split by the vertical the sender chose (Warsaw day)', () => {
    const m = mixOf(arch, 'arch', 'today', NOW)
    expect(m.total).toBe(6)
    expect(m.lanes.map(l => [l.label, l.n])).toEqual([['Colleagues of good leads', 3], ['Warm engagers', 2], ['Hiring signal', 1]])
    expect(m.lanes[0].verts).toEqual([{ key: 'games', n: 1 }, { key: 'apps', n: 2 }])
    expect(m.lanes[1].verts).toEqual([{ key: 'games', n: 1 }, { key: 'd2c', n: 1 }])
    expect(m.lanes[2].verts).toEqual([{ key: 'none', n: 1 }])
  })

  it('7 days counts the last 7 Warsaw days, never older', () => {
    expect(mixOf(arch, 'arch', '7d', NOW).total).toBe(7)
  })

  it('Ivan and Rise: the campaign is the lane, no vertical split', () => {
    const rise: SeatSends = { campaigns: { a: 'RiseDTC — Competitor Engagers', b: 'RiseDTC — Company Expansion' }, rows: [
      { campaign_id: 'a', sent_at: at('2026-09-28T08:00:00Z'), lane: null, vertical: null },
      { campaign_id: 'a', sent_at: at('2026-09-28T08:10:00Z'), lane: null, vertical: null },
      { campaign_id: 'b', sent_at: at('2026-09-28T08:20:00Z'), lane: 'company_expansion', vertical: null },
    ] }
    const m = mixOf(rise, 'risedtc', 'today', NOW)
    expect(m.byVertical).toBe(false)
    expect(m.lanes.map(l => [l.label, l.n])).toEqual([['Competitor Engagers', 2], ['Company Expansion', 1]])
  })
})
