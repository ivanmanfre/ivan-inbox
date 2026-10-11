import { describe, expect, it } from 'vitest'
import { parsePlan, planDay } from './contentPlan'

const week = (start: string, which: string) => ({ start, which, target: 4, filled: 4, open: 0, posts: [], planned: [] })
describe('parsePlan', () => {
  it('accepts a full read for the asked lane', () => {
    const r = parsePlan({ ok: true, account: 'risedtc', weeks: [week('2026-10-05', 'this'), week('2026-10-12', 'next'), week('2026-10-19', 'after')], done: [], warnings: [] }, 'risedtc')
    expect(r.weeks).toHaveLength(3)
  })
  it('treats a read with no weeks as a failure, never as an empty plan', () => {
    expect(() => parsePlan({ ok: true, account: 'ivan', weeks: [], done: [], warnings: [] }, 'ivan')).toThrow()
  })
  it('refuses another lane', () => {
    expect(() => parsePlan({ ok: true, account: 'arch', weeks: [], done: [], warnings: [] }, 'ivan')).toThrow()
  })
  it('names the day', () => expect(planDay('2026-10-19')).toBe('Mon 19 Oct'))
})
