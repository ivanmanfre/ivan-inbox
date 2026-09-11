import { describe, expect, it } from 'vitest'
import {
  HEAT_FLOOR, formatRows, heatIndex, heatScale, num, peakLine, ratioLine, subLine, type Benchmark,
} from './benchmark'

const heat = [
  { dow: 0, h: 9, n: 5, avg: 120 },
  { dow: 5, h: 22, n: 2, avg: 900 }, // under the floor: must never be the peak
  { dow: 2, h: 12, n: 12, avg: 40 },
]

describe('benchmark arithmetic', () => {
  it('num prints a dash for nothing and thousands with commas', () => {
    expect(num(null)).toBe('–')
    expect(num(undefined)).toBe('–')
    expect(num(2263.5)).toBe('2,264')
  })

  it('ratioLine says who gets more, and nothing when a side is zero', () => {
    expect(ratioLine(97, 1)).toBe('they get 97.0×')
    expect(ratioLine(10, 20)).toBe('you get 2.0×')
    expect(ratioLine(97, 0)).toBeNull()
    expect(ratioLine(null, 5)).toBeNull()
  })

  it('peakLine ignores cells under the floor', () => {
    expect(HEAT_FLOOR).toBe(3)
    expect(peakLine(heat)).toBe('Peak Mon 9:00 (120 on 5 posts). Busiest Wed 12:00 (12 posts).')
    expect(peakLine([{ dow: 5, h: 22, n: 2, avg: 900 }])).toBe('Too few posts per cell to name a peak.')
  })

  it('heatScale is 0 under the floor and 1 at the strongest cell above it', () => {
    const s = heatScale(heat)
    const idx = heatIndex(heat)
    expect(s(idx.get('5-22'))).toBe(0)
    expect(s(idx.get('0-9'))).toBe(1)
    expect(s(idx.get('2-12'))).toBeCloseTo(40 / 120)
    expect(s(undefined)).toBe(0)
  })

  it('formatRows drops empty formats, sorts strongest first, floors the bar width', () => {
    const rows = formatRows({
      text: { theirs: 150, n: 10 },
      video: { theirs: 400, n: 6 },
      carousel: { theirs: null, n: 0 },
      article: { theirs: 4, n: 3 },
    })
    expect(rows.map(r => r.media)).toEqual(['video', 'text', 'article'])
    expect(rows[0].pct).toBe(100)
    expect(rows[2].pct).toBe(2)
  })

  it('subLine names the window in plain words', () => {
    const b = {
      days: 90,
      window: { first: '2025-11-16', last: '2026-09-08', posts: 2035, posts90: 682, accounts90: 15 },
    } as Benchmark
    expect(subLine(b)).toBe('15 accounts · 682 of their posts in the last 90 days · collected 2025-11-16 to 2026-09-08')
  })
})
