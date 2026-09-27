import { describe, it, expect } from 'vitest'
import { banditChipLine, currentIsoWeekMonday, personalFloorLine, type BanditIdea, type BanditSlot } from './banditChip'

/* ==========================================================================
   Pure-logic tests only (no Supabase stub), mirroring ideaScores.test.ts:
   fetchBanditChip itself is a thin, fail-soft network wrapper (mocking it
   would only test the mock). What matters — and what a CB-19 review or a
   later builder can break without noticing — is the plain-words rendering
   and the "current ISO Monday, always explicit" week rule (H2-bandit F8).
   ========================================================================== */

function idea(arm: BanditIdea['arm'], armName: string, slotIndex: number): BanditIdea {
  return { ideaTable: 'lm_idea_candidates', ideaRef: 'x', arm, armName, slotIndex, weekdayHint: 'Tue' }
}

describe('banditChipLine', () => {
  it('renders the exact worked example: arm A / recipe_top / slot 2', () => {
    expect(banditChipLine(idea('A', 'recipe_top', 2))).toBe('Reach test: arm A (recipe top), slot 2')
  })

  it('renders arm C / tail', () => {
    expect(banditChipLine(idea('C', 'tail', 4))).toBe('Reach test: arm C (tail), slot 4')
  })

  it('falls back to the raw arm_name (underscores replaced) for an unknown label', () => {
    expect(banditChipLine(idea('B', 'some_new_arm', 1))).toBe('Reach test: arm B (some new arm), slot 1')
  })

  it('is null for an idea with no recommendation this week (the common case)', () => {
    expect(banditChipLine(undefined)).toBeNull()
  })

  it('never contains an em dash or a verdict word', () => {
    const line = banditChipLine(idea('A', 'recipe_top', 2)) ?? ''
    expect(line).not.toMatch(/[—–]/) // em dash / en dash
    expect(line).not.toMatch(/\b(pass|fail|verdict)\b/i)
  })
})

describe('personalFloorLine', () => {
  const floor: BanditSlot = { slotIndex: 1, personalFloor: true, arm: null, armName: null, weekdayHint: null }
  const armSlot: BanditSlot = { slotIndex: 2, personalFloor: false, arm: 'A', armName: 'recipe_top', weekdayHint: 'Wed' }

  it('is "Personal floor" when the week has a stamped floor slot', () => {
    expect(personalFloorLine([floor, armSlot])).toBe('Personal floor')
  })

  it('is null when there are no slots (no chip data, or a week not drawn)', () => {
    expect(personalFloorLine([])).toBeNull()
  })

  it('is null when every slot is an arm slot (defensive: should not happen live)', () => {
    expect(personalFloorLine([armSlot])).toBeNull()
  })
})

describe('currentIsoWeekMonday', () => {
  it('returns the Monday of the ISO week containing "now", as YYYY-MM-DD', () => {
    // Wednesday 2026-09-30 -> Monday 2026-09-28
    const wed = Date.UTC(2026, 8, 30, 12, 0, 0)
    expect(currentIsoWeekMonday(wed)).toBe('2026-09-28')
  })

  it('a Monday maps to itself', () => {
    const mon = Date.UTC(2026, 8, 28, 0, 0, 0)
    expect(currentIsoWeekMonday(mon)).toBe('2026-09-28')
  })

  it('a Sunday maps to the Monday that started its week (not the next one)', () => {
    // Sunday 2026-10-04 is the last day of the week that started Monday 2026-09-28.
    const sun = Date.UTC(2026, 9, 4, 23, 0, 0)
    expect(currentIsoWeekMonday(sun)).toBe('2026-09-28')
  })
})
