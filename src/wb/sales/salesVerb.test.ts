import { describe, expect, it } from 'vitest'
import { salesVerbFor } from './index'

/* E3 · the one document this call row is for, revealed where the clocks are.
   The six chips are untouched; this is the hierarchy over them. */
describe('salesVerbFor', () => {
  it('offers the report on a call that has happened and has one', () => {
    expect(salesVerbFor({ past: true, hasReport: true, hasPack: true })).toBe('report')
    expect(salesVerbFor({ past: true, hasReport: true, hasPack: false })).toBe('report')
  })

  it('offers nothing on a past call with no report — there is no verb to invent', () => {
    expect(salesVerbFor({ past: true, hasReport: false, hasPack: true })).toBe(null)
  })

  it('offers the card on a call still to come with a matched pack', () => {
    expect(salesVerbFor({ past: false, hasReport: false, hasPack: true })).toBe('card')
  })

  it('offers nothing on an unmatched call — the row says "no pack yet" and means it', () => {
    expect(salesVerbFor({ past: false, hasReport: false, hasPack: false })).toBe(null)
  })

  it('stands down inside the hour, so the live Join is the only accent on the row', () => {
    expect(salesVerbFor({ past: false, hasReport: false, hasPack: true, joinLive: true })).toBe(null)
    expect(salesVerbFor({ past: true, hasReport: true, hasPack: true, joinLive: true })).toBe(null)
  })

  it('never offers Join: that control has a deadline and never depends on a pointer', () => {
    const answers = new Set<unknown>()
    for (const past of [true, false]) {
      for (const hasReport of [true, false]) {
        for (const hasPack of [true, false]) answers.add(salesVerbFor({ past, hasReport, hasPack }))
      }
    }
    expect([...answers].sort()).toEqual([null, 'card', 'report'].sort())
  })
})
