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

describe('you vs one account', () => {
  const you = { n: 40, per_wk: 3.1, median: 1, smart: 4, imp_median: 80 }
  const acc = (who: string, role: string, smart: number | null, per_wk = 2): import('./benchmark').BenchAccount =>
    ({ who, role, n: 20, per_wk, median: smart, smart, media: 'text', best: null })

  it('pickCompare keeps a saved pick, else the strongest competitor, else the strongest account', async () => {
    const { pickCompare } = await import('./benchmark')
    const rows = [acc('Sweep Guy', 'sweep', 900), acc('Rival A', 'direct_competitor', 100), acc('Rival B', 'direct_competitor', 300)]
    expect(pickCompare(rows, 'Rival A')?.who).toBe('Rival A')
    expect(pickCompare(rows, 'Gone')?.who).toBe('Rival B')
    expect(pickCompare(rows, null)?.who).toBe('Rival B')
    expect(pickCompare([acc('Only', 'sweep', 5)], null)?.who).toBe('Only')
    expect(pickCompare([], null)).toBeNull()
  })

  it('pairPct puts both bars on one scale and floors a positive bar at 2%', async () => {
    const { pairPct } = await import('./benchmark')
    expect(pairPct(1, 100)).toEqual({ you: 2, them: 100 })
    expect(pairPct(50, 100)).toEqual({ you: 50, them: 100 })
    expect(pairPct(0, 0)).toEqual({ you: 0, them: 0 })
    expect(pairPct(null, 10)).toEqual({ you: 0, them: 100 })
  })

  it('compareRows names the gap in plain words on every row', async () => {
    const { compareRows, compareSummary } = await import('./benchmark')
    const rows = compareRows(you, acc('Rival B', 'direct_competitor', 300, 1))
    expect(rows.map(r => r.label)).toEqual(['Posts per week', 'Median post', 'Typical post'])
    expect(rows[0].note).toBe('you post 3.1× more often')
    expect(rows[1].note).toBe('they get 300.0×')
    expect(rows[2].note).toBe('they get 75.0×')
    expect(compareSummary(you, acc('Rival B', 'direct_competitor', 300, 1), 'You'))
      .toBe('Rival B posts 1 a week, you 3.1. Their typical post gets 300, yours 4 (they get 75.0×).')
  })
})

describe('baselines', () => {
  const dist = { n: 59, p50: 1, p75: 2, p90: 5, best: 68, n_imp: 59, k50: 9.1, k75: 21.3, k90: 38.9 }

  it('withholds percentiles under the floor and says why', async () => {
    const { baselineSentence, distLine } = await import('./benchmark')
    expect(distLine(dist, 20)).toBe('1 · 2 · 5')
    expect(distLine({ ...dist, n: 9 }, 20)).toBeNull()
    expect(baselineSentence({ ...dist, n: 9 }, 20))
      .toBe('9 posts with metrics. Under 20 a percentile is noise, so this lane shows counts only.')
    expect(baselineSentence({ ...dist, n: 0 }, 20, 'You')).toBe('No posts with metrics in this window.')
    expect(baselineSentence(dist, 20, 'You'))
      .toBe('Half of you posts land at or under 1 engagement. One in ten clears 5. Best in the window 68.')
  })

  it('pctLabel names the band and liftLabel names the gap', async () => {
    const { liftLabel, pctLabel } = await import('./benchmark')
    expect(pctLabel(100)).toBe('top 1%')
    expect(pctLabel(92)).toBe('top 8%')
    expect(pctLabel(60)).toBe('top 40%')
    expect(pctLabel(53)).toBe('about typical')
    expect(pctLabel(41)).toBe('about typical')
    expect(pctLabel(10)).toBe('bottom 10%')
    expect(pctLabel(0)).toBe('bottom 1%')
    expect(pctLabel(null)).toBeNull()
    expect(liftLabel({ lift: 3.42, author_n: 30 })).toBe('3.4× their median')
    expect(liftLabel({ lift: 1, author_n: 30 })).toBe('their normal post')
    expect(liftLabel({ lift: 0.5, author_n: 30 })).toBe('2.0× under their median')
    expect(liftLabel({ lift: null, author_n: 3 })).toBeNull()
  })

  it('per1k is withheld when too few posts carry impressions', async () => {
    const { per1kLine } = await import('./benchmark')
    expect(per1kLine(dist, 20)).toBe('9 · 21 · 39 per 1,000 impressions')
    expect(per1kLine({ ...dist, n_imp: 4 }, 20)).toBeNull()
    expect(per1kLine({ ...dist, k50: null }, 20)).toBeNull()
  })
})
