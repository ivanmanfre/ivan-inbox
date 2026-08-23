import { describe, it, expect } from 'vitest'
import {
  buildInboundLanes, inboundStatus, INBOUND_ORDER,
  type InboundRow, type InboundDailyRow,
} from './inbound'

const NOW = '2026-08-23T12:00:00Z'

const row = (o: Partial<InboundRow>): InboundRow => ({
  client_id: 'risedtc', lane: 'requests',
  total: 0, d24: 0, d7: 0, d30: 0, passed: 0, dropped: 0, last_at: null,
  ...o,
})

describe('inboundStatus', () => {
  // The reason this vocabulary exists at all. An inbound lane on a healthy seat decides
  // 0-3 things a fortnight, so the outbound scale (stale after 7 quiet days) would paint
  // it red permanently and the colour would stop carrying information.
  it('stays live through a fortnight of near-silence', () => {
    expect(inboundStatus('2026-08-10T00:00:00Z', 4, NOW)).toBe('live')
  })
  it('goes quiet, never stale, once the window passes', () => {
    expect(inboundStatus('2026-07-01T00:00:00Z', 4, NOW)).toBe('quiet')
  })

  // The onboarding signal, stated at the strength the data supports: no decisions
  // recorded. It deliberately does NOT claim "never armed" — Rise's cold-DM filter is
  // armed and running and lands here whenever every inbound chat matched a known
  // prospect. Separating the two needs a lane manifest that does not exist yet.
  it('reads off when nothing has been recorded for this client', () => {
    expect(inboundStatus(null, 0, NOW)).toBe('off')
  })
  it('reads off when a timestamp exists but nothing was ever counted', () => {
    expect(inboundStatus('2026-08-22T00:00:00Z', 0, NOW)).toBe('off')
  })
  it('never returns the outbound vocabulary', () => {
    for (const s of [inboundStatus(null, 0, NOW), inboundStatus('2026-08-22T00:00:00Z', 1, NOW)]) {
      expect(s).not.toBe('stale')
      expect(s).not.toBe('slowing')
    }
  })
})

describe('buildInboundLanes', () => {
  it('always emits every lane, so a client that never armed one still shows it', () => {
    const lanes = buildInboundLanes([], [], 'arch', NOW)
    expect(lanes.map(l => l.key)).toEqual(INBOUND_ORDER)
    expect(lanes.every(l => l.status === 'off')).toBe(true)
  })

  it('scopes to one client and ignores the others', () => {
    const rows = [
      row({ client_id: 'risedtc', lane: 'requests', total: 82, d7: 13, passed: 4, dropped: 78, last_at: '2026-08-22T00:07:18Z' }),
      row({ client_id: 'ivan', lane: 'requests', total: 9, d7: 3, passed: 0, dropped: 9, last_at: '2026-08-21T07:07:15Z' }),
    ]
    const rise = buildInboundLanes(rows, [], 'risedtc', NOW).find(l => l.key === 'requests')!
    expect(rise.total).toBe(82)
    expect(rise.passed).toBe(4)
    expect(rise.dropped).toBe(78)
    expect(rise.status).toBe('live')
  })

  it('sums both clients under all', () => {
    const rows = [
      row({ client_id: 'risedtc', total: 82, passed: 4, dropped: 78, last_at: '2026-08-22T00:00:00Z' }),
      row({ client_id: 'ivan', total: 9, passed: 0, dropped: 9, last_at: '2026-08-21T00:00:00Z' }),
    ]
    const all = buildInboundLanes(rows, [], 'all', NOW).find(l => l.key === 'requests')!
    expect(all.total).toBe(91)
    expect(all.dropped).toBe(87)
    // The roll-up must take the NEWEST decision across clients, not the last row it read.
    expect(all.last_at).toBe('2026-08-22T00:00:00Z')
  })

  it('puts both lanes on one shared 14-day axis', () => {
    const daily: InboundDailyRow[] = [
      { client_id: 'risedtc', lane: 'requests', day: '2026-08-20', n: 2 },
      { client_id: 'risedtc', lane: 'requests', day: '2026-08-22', n: 5 },
      { client_id: 'risedtc', lane: 'filtered', day: '2026-08-22', n: 1 },
    ]
    const lanes = buildInboundLanes([], daily, 'risedtc', NOW)
    const [req, filt] = lanes
    // The axis is the set of days that ACTUALLY APPEAR in the result, not a calendar
    // range, so both bars stay the same width and index i is the same date on both.
    // A date nothing happened on anywhere gets no column at all (08-21 here). Same
    // contract as buildLanes on the outbound side; changing one without the other is
    // how two sparklines start lying about the same week.
    expect(req.daily).toHaveLength(2)
    expect(filt.daily).toHaveLength(2)
    expect(req.daily).toEqual([2, 5])
    expect(filt.daily).toEqual([0, 1])
  })

  it('zero-fills a day that another lane owns, so the axes cannot drift apart', () => {
    const daily: InboundDailyRow[] = [
      { client_id: 'risedtc', lane: 'requests', day: '2026-08-21', n: 3 },
      { client_id: 'risedtc', lane: 'filtered', day: '2026-08-22', n: 1 },
    ]
    const [req, filt] = buildInboundLanes([], daily, 'risedtc', NOW)
    expect(req.daily).toEqual([3, 0])
    expect(filt.daily).toEqual([0, 1])
  })
})
