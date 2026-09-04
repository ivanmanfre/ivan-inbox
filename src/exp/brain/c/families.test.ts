import { describe, expect, it } from 'vitest'
import { FAMILY_KEYS, FAMILY_META, familyLabel, isNeedsMe, isQuietEligible } from './families'

describe('FAMILY_META', () => {
  it('covers all 17 real families named in 00-notification-families.md', () => {
    expect(FAMILY_KEYS).toHaveLength(17)
    for (const k of FAMILY_KEYS) {
      expect(FAMILY_META[k], k).toBeDefined()
      expect(FAMILY_META[k].label.length).toBeGreaterThan(0)
    }
  })

  it('never labels a card with the raw family key or an internal name', () => {
    const banned = /n8nclaw|broker|railway|webhook|p15/i
    for (const k of FAMILY_KEYS) {
      expect(FAMILY_META[k].label).not.toBe(k)
      expect(FAMILY_META[k].label).not.toMatch(banned)
    }
  })
})

describe('familyLabel', () => {
  it('reads the map for a known family', () => {
    expect(familyLabel('reply_draft_pending')).toBe('A reply is waiting on you')
    expect(familyLabel('seat_health')).toBe('A seat needs attention')
  })

  it('falls back to a plain phrase for an unknown family, never the raw key', () => {
    expect(familyLabel('some_future_family')).toBe('Update')
  })
})

describe('isNeedsMe', () => {
  it('is true for attention and error severities', () => {
    expect(isNeedsMe('reply_draft_pending', 'attention')).toBe(true)
    expect(isNeedsMe('system_infra_alarm', 'error')).toBe(true)
  })
  it('is false for info severity', () => {
    expect(isNeedsMe('health_reminder', 'info')).toBe(false)
  })
})

describe('isQuietEligible', () => {
  it('is true only for a quiet-eligible family at info severity', () => {
    expect(isQuietEligible('health_reminder', 'info')).toBe(true)
    expect(isQuietEligible('content_sourcing_pipeline', 'info')).toBe(true)
  })
  it('is false for a needs-me family even at info severity', () => {
    expect(isQuietEligible('reply_draft_pending', 'info')).toBe(false)
    expect(isQuietEligible('booking_notice', 'info')).toBe(false)
  })
  it('is false for any family once severity leaves info', () => {
    expect(isQuietEligible('health_reminder', 'attention')).toBe(false)
    expect(isQuietEligible('outreach_engine_ops', 'error')).toBe(false)
  })
})
