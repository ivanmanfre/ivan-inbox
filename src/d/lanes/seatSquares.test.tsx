// @vitest-environment jsdom
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QUEUE_EMPTY_FAMILY, type CcClient, type CcPayload } from '../../lib/campaignControl'
import rateLimited from '../../lib/cc-fixtures/rate_limited.json'
import { renderInFrame } from '../test-utils'
import { SeatSquares, seatWarnings } from './SeatSquares'
import { Strip, todayLine } from './v4/Strip'
import type { LanesData } from './useLanesData'

afterEach(() => { cleanup() })

const slot = <T,>(value: T | null, failed: string | null = null) => ({ value, failed })
function data(over: Partial<LanesData> = {}): LanesData {
  const base = Object.fromEntries(['cc', 'perf', 'gov', 'outcomes', 'pipeline', 'replacement', 'viewed', 'counters', 'inbound', 'inboundDaily', 'scans', 'campSends', 'cameBack', 'warm', 'engagers', 'health', 'pauses', 'attempts', 'ready']
    .map(k => [k, slot(null)])) as unknown as LanesData
  return { ...base, ...over }
}
const gov = (client_id: string, daily_used: number) => ({ client_id, daily_used }) as never
const pipe = (client_id: string, sendable: number, sent_7d: number) => ({ client_id, lane: 'x', sendable, sent_7d, sent_30d: 0 })

describe('Lanes 3 seat squares', () => {
  it('the out-of-leads warning uses scoped interest stock and flow, not the old campaign pipeline', () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    const d = data({ pipeline: slot([pipe('risedtc', 300, 14), pipe('ivan', 0, 70)]),
      ready: slot({ saturdayNy: false, lanes: [
        { seat: 'risedtc', lane: 'competitor_engager', label: 'Competitor engagers', n: 0, capped: false, campaignId: null, off: null },
        { seat: 'ivan', lane: 'own_post_engager', label: 'Warm engagers', n: 300, capped: false, campaignId: null, off: null },
      ] }),
      replacement: slot([{ client_id: 'risedtc', lane: 'competitor_engager', day: '2026-09-27', qualified_in: 0, sent_out: 14 },
        { client_id: 'ivan', lane: 'own_post_engager', day: '2026-09-27', qualified_in: 0, sent_out: 70 }]),
    })
    expect(seatWarnings(d, 'risedtc', now)).toEqual(['Out of leads: under a day of supply left'])
    expect(seatWarnings(d, 'ivan', now)).toEqual([])
  })

  it('a Premium-only seat (no Sales Nav, NO_SN) gets no Sales Nav warning; a broken Sales Nav still does', () => {
    const health = (sn: string) => slot({ updated_at: '', seats: [{ id: 'x', name: 'Jonathan Kiekbusch', account: 'OK', sn, degraded: false, link: null }] })
    expect(seatWarnings(data({ health: health('NO_SN') }), 'swishdm')).toEqual([])
    expect(seatWarnings(data({ health: health('SN_DISCONNECTED') }), 'swishdm')).toEqual(['Sales Nav not working'])
  })

  it('three squares, the chosen one pressed; clicking another chooses it; unknown numbers are "?" never 0', () => {
    const pick = vi.fn()
    renderInFrame(<SeatSquares seats={['ivan', 'risedtc', 'arch', 'swishdm']} seat="ivan" pick={pick} d={data()} now={Date.now()} />)
    const tabs = [...document.querySelectorAll('[data-pick]')]
    expect(tabs.map(t => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
    expect(document.querySelector('[data-seat="arch"] .dl-sqr')!.textContent).toBe('?invites todayinvites?DMs todayDMs?InMail todayInMail')
    fireEvent.click(document.querySelector('[data-pick="arch"]')!)
    expect(pick).toHaveBeenCalledWith('arch')
  })
})

/* Ivan 10-19: "still this shitty alert instead of the stats". SwishDM read "Queue empty" over
   "Out of leads: under a day of supply left" and no numbers: the v4 strip showed the warning INSTEAD of
   today's counts, and the warning repeated the state word. */
describe('a seat square always shows its numbers; a warning never repeats the state word', () => {
  const fx = rateLimited as unknown as CcPayload
  const arch = fx.clients.find(c => c.client_id === 'arch')!
  const NOW = Date.parse(fx.monitor.last_tick_at!) + 60_000
  const swish = (family: string, status: CcClient['status'] = 'incident'): CcClient =>
    ({ ...arch, client_id: 'swishdm', status, incidents: [{ ...arch.incidents![0], failure_family: family, state: 'updated', cause: undefined }] })
  const today = (ch: string, sent: number) => ({ sent, failed: 0, blocked: 0, channel: ch, phantom: 0, interval: 'today', attempted: sent, client_id: 'swishdm', source_lane: '__all__' })
  const cc = (client: CcClient, withRows: boolean): CcPayload => ({
    ...fx, clients: [client],
    ranges: { ...fx.ranges, daily: [], rows: withRows ? [today('invitation', 24), today('dm', 2), today('inmail', 3)] as never : [] },
  })
  const supply = { pipeline: slot([pipe('swishdm', 0, 7)]), gov: slot([gov('swishdm', 3)]) }

  it('drops "Out of leads" when the state word already says Queue empty', () => {
    const d = data({ cc: slot(cc(swish(QUEUE_EMPTY_FAMILY), true)), ...supply })
    expect(seatWarnings(d, 'swishdm', NOW)).toEqual([])
  })

  it('does not infer source supply from the mixed SwishDM monitor, and keeps real problems', () => {
    const health = slot({ updated_at: '', seats: [{ id: 'x', name: 'Jonathan Kiekbusch', account: 'DISCONNECTED', sn: 'NO_SN', degraded: true, link: 'https://x' }] })
    const healthy = data({ cc: slot(cc(swish(QUEUE_EMPTY_FAMILY, 'healthy'), true)), ...supply })
    expect(seatWarnings(healthy, 'swishdm', NOW)).toEqual([])
    const broken = data({ cc: slot(cc(swish(QUEUE_EMPTY_FAMILY), true)), ...supply, health })
    expect(seatWarnings(broken, 'swishdm', NOW)).toEqual(['LinkedIn disconnected'])
  })

  it('the strip tab shows 24 invites, 2 DMs, 3 InMail for an empty-queue seat, with no repeated warning', () => {
    const d = data({ cc: slot(cc(swish(QUEUE_EMPTY_FAMILY), true)), ...supply })
    renderInFrame(<Strip seats={['swishdm']} seat="swishdm" pick={() => {}} d={d} now={NOW} />)
    const tab = document.querySelector('[data-seat="swishdm"]')!
    expect(tab.textContent).toContain('Queue empty')
    expect(tab.querySelector('.dl4-tab-line')!.textContent).toBe('24 invites · 2 DMs · 3 InMail today')
    expect(document.querySelector('[data-seat-warning]')).toBeNull()
    expect(document.body.textContent).not.toContain('Out of leads')
    expect(document.querySelector('.dl4-pill.dl4-warn')).toBeNull()
  })

  it('the strip leaves no supply warning when SwishDM source stock is unknown', () => {
    const d = data({ cc: slot(cc(swish(QUEUE_EMPTY_FAMILY, 'healthy'), true)), ...supply })
    renderInFrame(<Strip seats={['swishdm']} seat="swishdm" pick={() => {}} d={d} now={NOW} />)
    const tab = document.querySelector('[data-seat="swishdm"]')!
    expect(tab.querySelector('.dl4-tab-line')!.textContent).toBe('24 invites · 2 DMs · 3 InMail today')
    expect(tab.querySelector('.dl4-tab-note')).toBeNull()
  })

  it('a missing number is "?", and the row is never hidden', () => {
    expect(todayLine(null)).toBe('? invites · ? DMs · ? InMail today')
    expect(todayLine({ inv: 24, dm: null, inmail: 3 }, 120)).toBe('24 invites · ? DMs · 3 InMail today · 120 credits')
    const d = data({ cc: slot(cc(swish(QUEUE_EMPTY_FAMILY), false)), ...supply })
    renderInFrame(<SeatSquares seats={['swishdm']} seat="swishdm" pick={() => {}} d={d} now={NOW} />)
    expect(document.querySelector('[data-seat="swishdm"] .dl-sqr')!.textContent).toBe('?invites todayinvites?DMs todayDMs?InMail todayInMail')
  })
})
