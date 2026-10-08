import { describe, expect, it } from 'vitest'
import { soFar, stockAlerts, sendAlerts, MIN_USUAL } from './glanceModel'
import type { ReadyRead } from '../lanes/glance/ready'

const H = 36e5, D = 864e5
const now = Date.parse('2026-10-09T10:00:00Z') // 12:00 Warsaw

describe('glance: low sends compare like with like', () => {
  it('counts today so far against the same hour on the last 7 days', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].flatMap(d => Array.from({ length: 12 }, (_, i) => ({ seat: 'ivan' as const, at: new Date(now - d * D - (i + 1) * 10 * 60e3).toISOString() })))
      .concat([1, 2, 3, 4, 5, 6, 7].flatMap(d => Array.from({ length: 30 }, (_, i) => ({ seat: 'ivan' as const, at: new Date(now - d * D + (i + 1) * 60e3).toISOString() }))))
      .concat([{ seat: 'ivan', at: new Date(now - H).toISOString() }])
    expect(soFar(rows, 'ivan', now)).toEqual({ today: 1, usual: 12 })
    const a = sendAlerts(null, rows, now)
    expect(a.map(x => x.key)).toEqual(['low:ivan'])
    expect(a[0].text).toBe('Ivan: low sends, 1 so far vs 12 usual by now')
  })
  it('stays quiet on a small usual day and on a normal day', () => {
    const few = [1, 2, 3, 4, 5, 6, 7].flatMap(d => Array.from({ length: MIN_USUAL - 1 }, (_, i) => ({ seat: 'arch' as const, at: new Date(now - d * D - (i + 1) * 60e3).toISOString() })))
    expect(sendAlerts(null, few, now)).toEqual([])
    const normal = [0, 1, 2, 3, 4, 5, 6, 7].flatMap(d => Array.from({ length: 10 }, (_, i) => ({ seat: 'risedtc' as const, at: new Date(now - d * D - (i + 1) * 60e3).toISOString() })))
    expect(sendAlerts(null, normal, now)).toEqual([])
  })
})

describe('glance: warm stock', () => {
  const lane = (seat: 'ivan' | 'risedtc' | 'arch', l: string, n: number, off: string | null = null) => ({ seat, lane: l, label: l, n, capped: false, campaignId: null, off })
  it('flags a seat whose warm lane is at 0 or missing, never a lane switched off', () => {
    const r: ReadyRead = { saturdayNy: false, lanes: [lane('ivan', 'engage', 0), lane('ivan', 'cold', 90), lane('risedtc', 'engager', 0, 'Saturday: profile views only'), lane('arch', 'cold_apps', 40)] }
    expect(stockAlerts(r).map(x => x.text)).toEqual(['Ivan: 0 warm engagers ready', 'Arch: 0 warm engagers ready'])
  })
  it('says nothing with stock in every warm lane', () => {
    const r: ReadyRead = { saturdayNy: false, lanes: [lane('ivan', 'engage', 23), lane('risedtc', 'engager', 4), lane('arch', 'engager_warm', 19)] }
    expect(stockAlerts(r)).toEqual([])
  })
})
