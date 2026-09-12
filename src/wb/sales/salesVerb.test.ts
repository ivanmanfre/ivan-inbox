import { describe, expect, it } from 'vitest'
import { salesVerbFor } from './index'

/* E3 · the one document this call row is for, revealed where the clocks are.
   The six chips are untouched; this is the hierarchy over them. */
describe('salesVerbFor', () => {
  it('offers the card on a call still to come with a matched pack', () => {
    expect(salesVerbFor({ past: false, hasPack: true })).toBe('card')
  })

  it('offers nothing on an unmatched call — the row says "no pack yet" and means it', () => {
    expect(salesVerbFor({ past: false, hasPack: false })).toBe(null)
  })

  /* E3b · the skeptic's minor. A past row already draws an accent `Report` chip
     on the strip, standing rather than hover-gated, wired to the same handler a
     hover verb would have used. Two controls for one job on one row. */
  it('stands down on a past call, whose Report chip the strip already draws', () => {
    expect(salesVerbFor({ past: true, hasPack: true })).toBe(null)
    expect(salesVerbFor({ past: true, hasPack: false })).toBe(null)
  })

  it('stands down inside the hour, so the live Join is the only accent on the row', () => {
    expect(salesVerbFor({ past: false, hasPack: true, joinLive: true })).toBe(null)
  })

  it('never offers Join: that control has a deadline and never depends on a pointer', () => {
    const answers = new Set<unknown>()
    for (const past of [true, false]) {
      for (const hasPack of [true, false]) {
        for (const joinLive of [true, false]) answers.add(salesVerbFor({ past, hasPack, joinLive }))
      }
    }
    expect([...answers].sort()).toEqual([null, 'card'].sort())
  })
})
