import { describe, expect, it } from 'vitest'
import { FAMILIES, FAMILY_KEYS, familyLabel, familyLane, familyLaneLabel } from './families'

// The 17 real families from the 30-day inventory, plus `chat` (not a
// notification, kept so a stray row never prints its raw key).
const EXPECTED_KEYS = [
  'reply_draft_pending', 'system_infra_alarm', 'outreach_engine_ops',
  'post_generation_failed', 'content_board_activity', 'health_reminder',
  'content_sourcing_pipeline', 'system_watchdog_digest', 'inbound_reply_notice',
  'reporting_digest', 'scan_quality_alert', 'comment_engagement_notice',
  'booking_notice', 'arch_build_progress', 'seat_health',
  'draft_generation_error', 'send_failed_alert', 'chat',
]

describe('FAMILIES', () => {
  it('covers exactly the 17 families plus chat, no more, no less', () => {
    expect(FAMILY_KEYS.sort()).toEqual([...EXPECTED_KEYS].sort())
  })

  it('every entry has a human label with no underscores and no raw key on screen', () => {
    for (const key of FAMILY_KEYS) {
      const meta = FAMILIES[key]
      expect(meta.label).not.toMatch(/_/)
      expect(meta.label).not.toBe(key)
      expect(meta.label.length).toBeGreaterThan(0)
    }
  })

  it('health_reminder and chat have no lane — neither is a work item', () => {
    expect(FAMILIES.health_reminder.lane).toBeNull()
    expect(FAMILIES.chat.lane).toBeNull()
  })

  it('system_infra_alarm and system_watchdog_digest have no in-app lane', () => {
    expect(FAMILIES.system_infra_alarm.lane).toBeNull()
    expect(FAMILIES.system_watchdog_digest.lane).toBeNull()
  })
})

describe('familyLabel', () => {
  it('returns the mapped label for a known key', () => {
    expect(familyLabel('reply_draft_pending')).toBe('Reply waiting on you')
  })

  it('humanises an unknown key rather than printing raw snake_case', () => {
    expect(familyLabel('some_new_family')).toBe('Some New Family')
  })
})

describe('familyLane / familyLaneLabel', () => {
  it('send_failed_alert opens in Lanes (the real user-facing name for `sends`)', () => {
    expect(familyLane('send_failed_alert')).toBe('sends')
    expect(familyLaneLabel('send_failed_alert')).toBe('Open in Lanes')
  })

  it('a lane-less family has no button label', () => {
    expect(familyLaneLabel('health_reminder')).toBeNull()
  })

  it('an unknown family has no lane', () => {
    expect(familyLane('never_seen_before')).toBeNull()
  })
})
