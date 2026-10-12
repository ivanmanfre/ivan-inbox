import { describe, expect, it } from 'vitest'
import { effectDomain, effectX, logX, ratioX, timeX } from './charts'

describe('ratioX: log2 from half as often to 2x as often', () => {
  it('the ends and the middle', () => {
    expect(ratioX(0.5, 200)).toBe(0)
    expect(ratioX(1, 200)).toBe(100)
    expect(ratioX(2, 200)).toBe(200)
  })
  it('clamps outside the scale', () => {
    expect(ratioX(0.1, 200)).toBe(0)
    expect(ratioX(9, 200)).toBe(200)
    expect(ratioX(0, 200)).toBe(0)
    expect(ratioX(-3, 200)).toBe(0)
  })
  it('is symmetric on a log scale: 0.7071x and 1.4142x sit the same distance from the middle', () => {
    expect(ratioX(Math.SQRT1_2, 200) + ratioX(Math.SQRT2, 200)).toBeCloseTo(200, 6)
  })
  it('never NaN', () => {
    expect(ratioX(NaN, 200)).toBe(100)
    expect(ratioX(Infinity, 200)).toBe(200)
  })
})

describe('logX', () => {
  it('maps lo to 0 and hi to w, monotone in between', () => {
    expect(logX(20, 20, 20000, 300)).toBe(0)
    expect(logX(20000, 20, 20000, 300)).toBeCloseTo(300, 6)
    const xs = [20, 50, 166, 500, 3000, 20000].map(v => logX(v, 20, 20000, 300))
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    expect(new Set(xs).size).toBe(xs.length)
    expect(logX(Math.sqrt(20 * 20000), 20, 20000, 300)).toBeCloseTo(150, 6)
  })
  it('clamps and survives bad input', () => {
    expect(logX(1, 20, 20000, 300)).toBe(0)
    expect(logX(1e9, 20, 20000, 300)).toBe(300)
    expect(logX(0, 20, 20000, 300)).toBe(0)
    expect(logX(-5, 20, 20000, 300)).toBe(0)
    expect(logX(100, 50, 50, 300)).toBe(0)
    expect(logX(NaN, 20, 20000, 300)).toBe(0)
  })
})

describe('effectX and effectDomain', () => {
  it('a linear scale from x0, clamped to the chart', () => {
    expect(effectX(-50, -50, 90, 10, 140)).toBe(10)
    expect(effectX(90, -50, 90, 10, 140)).toBe(150)
    expect(effectX(0, -50, 90, 10, 140)).toBe(60)
    expect(effectX(-99, -50, 90, 10, 140)).toBe(10)
    expect(effectX(500, -50, 90, 10, 140)).toBe(150)
    expect(effectX(5, 7, 7, 10, 140)).toBe(10)
    expect(effectX(NaN, -50, 90, 10, 140)).toBe(10)
  })
  it('the domain always holds zero and every range, in steps of 10', () => {
    expect(effectDomain([{ lo: 3.3, hi: 21.7 }, { lo: 29.5, hi: 76.7 }])).toEqual({ lo: -10, hi: 80 })
    expect(effectDomain([{ lo: -4.1, hi: 14.6 }])).toEqual({ lo: -10, hi: 30 })
    expect(effectDomain([{ lo: -41.7, hi: -3.3 }, { lo: 31.5, hi: 80.7 }])).toEqual({ lo: -50, hi: 90 })
  })
  it('an empty or null set still gives a drawable domain', () => {
    expect(effectDomain([])).toEqual({ lo: -10, hi: 30 })
    expect(effectDomain([{ lo: null, hi: null }])).toEqual({ lo: -10, hi: 30 })
  })
})

describe('timeX', () => {
  it('maps the 12 week window onto the width, clamped', () => {
    expect(timeX('2026-07-20', '2026-07-20', '2026-10-12', 300)).toBe(0)
    expect(timeX('2026-10-12', '2026-07-20', '2026-10-12', 300)).toBe(300)
    expect(timeX('2026-01-01', '2026-07-20', '2026-10-12', 300)).toBe(0)
    expect(timeX('2027-01-01', '2026-07-20', '2026-10-12', 300)).toBe(300)
    expect(timeX('2026-08-31', '2026-07-20', '2026-10-12', 300)).toBeCloseTo(150, -1)
    expect(timeX('nope', '2026-07-20', '2026-10-12', 300)).toBe(0)
  })
})
