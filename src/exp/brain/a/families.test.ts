import { describe, expect, it } from 'vitest'
import {
  FAMILIES, FAMILY_KEYS, familyEyebrow, familyLabel, familyLane, familyLaneLabel,
  groupChange, plainHeadline, shortAge, familySectionLabel, worstSeverity,
} from './families'

// The 17 real families from the 30-day inventory, plus `chat` (not a
// notification, kept so a stray row never prints its raw key) and
// `claude_turn` (inbox-turn-run's own "a turn finished while you were away"
// push, a real row family this app receives but not one of the 17).
const EXPECTED_KEYS = [
  'reply_draft_pending', 'system_infra_alarm', 'outreach_engine_ops',
  'post_generation_failed', 'content_board_activity', 'health_reminder',
  'content_sourcing_pipeline', 'system_watchdog_digest', 'inbound_reply_notice',
  'reporting_digest', 'scan_quality_alert', 'comment_engagement_notice',
  'booking_notice', 'arch_build_progress', 'seat_health',
  'draft_generation_error', 'send_failed_alert', 'chat', 'claude_turn',
]

describe('FAMILIES', () => {
  it('covers exactly the 17 families plus chat and claude_turn, no more, no less', () => {
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

  it('health_reminder and chat have no lane - neither is a work item', () => {
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

  it('humanises an unknown key as a calm sentence, never shouted title case', () => {
    expect(familyLabel('some_new_family')).toBe('Some new family')
  })

  it('claude_turn reads as a human sentence, never the raw token', () => {
    expect(familyLabel('claude_turn')).toBe('Claude answered')
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

describe('familyEyebrow', () => {
  it('is silent on an info row, whichever family it belongs to', () => {
    for (const key of FAMILY_KEYS) expect(familyEyebrow(key, 'info')).toBeNull()
  })

  it('sends a system break to a fix by hand, never to "Needs you"', () => {
    expect(familyEyebrow('system_infra_alarm', 'error')).toBe('Fix by hand')
    expect(familyEyebrow('system_watchdog_digest', 'error')).toBe('Fix by hand')
  })

  it('names the families a person actually has to act on', () => {
    expect(familyEyebrow('reply_draft_pending', 'attention')).toBe('Needs you')
    expect(familyEyebrow('inbound_reply_notice', 'attention')).toBe('Needs you')
    expect(familyEyebrow('seat_health', 'error')).toBe('Needs you')
  })

  it('an unasked-for family that turned noisy is worth a look, not a demand', () => {
    expect(familyEyebrow('reporting_digest', 'attention')).toBe('Worth a look')
    expect(familyEyebrow('never_seen_before', 'error')).toBe('Worth a look')
  })
})

describe('plainHeadline', () => {
  it('takes the markdown off a Claude answer first line', () => {
    expect(plainHeadline('**File:** `project/ops-board-task.md`\nmore')).toBe('File: project/ops-board-task.md')
  })

  it('drops a leading status emoji so no emoji is ever a mark on a card', () => {
    expect(plainHeadline('\u26a0\ufe0f Post Generation FAILED (no draft id recovered)'))
      .toBe('Post Generation FAILED (no draft id recovered)')
    expect(plainHeadline('\ud83d\udd34 *Ivan System*')).toBe('Ivan System')
  })

  it('keeps the words of a markdown link and drops the target', () => {
    expect(plainHeadline('See [the report](https://example.com/x) now')).toBe('See the report now')
  })

  it('skips blank leading lines and collapses whitespace', () => {
    expect(plainHeadline('\n\n   ## Seat   health  \nnext')).toBe('Seat health')
  })

  it('is empty for nothing at all', () => {
    expect(plainHeadline(null)).toBe('')
    expect(plainHeadline('')).toBe('')
  })

  // Measured over the 30-day producer corpus (n=3011): em 377, emoji 193,
  // snake_case 66 and uppercase enums 36 reached the headline before these
  // four passes; all four now read 0.
  it('takes an emoji off anywhere in the line, not only the front', () => {
    expect(plainHeadline('Seat \ud83d\udfe2 healthy again')).toBe('Seat healthy again')
  })

  it('drops an uppercase enum token the machine gave itself', () => {
    expect(plainHeadline('Warm Engager HALTED_BY_CAP at 14:02')).toBe('Warm Engager at 14:02')
  })

  it('drops a lowercase column name', () => {
    expect(plainHeadline('extraction failed (stop=max_tokens)')).toBe('extraction failed (stop=)')
  })

  it('keeps a real path, which is not a column name', () => {
    expect(plainHeadline('wrote project/ops_board/notes.md')).toBe('wrote project/ops_board/notes.md')
  })

  it('turns the producers\' em dash into a full stop', () => {
    expect(plainHeadline('Warm Engager halted \u2014 Apify over cap'))
      .toBe('Warm Engager halted. Apify over cap')
  })
})

describe('groupChange', () => {
  it('a single unrepeated row is a first sighting', () => {
    expect(groupChange('Seat Mattan Danino: OK to CONNECTING', null, 1, 1)).toBe('first')
  })

  it('the same situation reported again is a repeat, digits and all', () => {
    expect(groupChange('3 drafts waiting', '5 drafts waiting', 4, 2)).toBe('again')
  })

  it('a title whose shape moved is a state change', () => {
    expect(groupChange('Seat Mattan Danino: CONNECTING to OK', 'Seat Mattan Danino: OK to CONNECTING', 2, 2))
      .toBe('changed')
  })

  it('a row that deduped in place with no second row is still a repeat', () => {
    expect(groupChange('Take your TRT', null, 6, 1)).toBe('again')
  })
})

describe('shortAge', () => {
  const now = Date.parse('2026-09-04T12:00:00Z')
  it('reads "now" inside the first minute', () => {
    expect(shortAge('2026-09-04T11:59:40Z', now)).toBe('now')
  })
  it('counts minutes, then hours, then days, then weeks', () => {
    expect(shortAge('2026-09-04T11:36:00Z', now)).toBe('24m')
    expect(shortAge('2026-09-04T06:00:00Z', now)).toBe('6h')
    expect(shortAge('2026-09-02T12:00:00Z', now)).toBe('2d')
    expect(shortAge('2026-08-14T12:00:00Z', now)).toBe('3w')
  })
  it('is empty for a value that is not a time', () => {
    expect(shortAge('not-a-date', now)).toBe('')
  })
})

// A live row: `inbox_notifications?family=eq.claude_turn&severity=eq.attention`
// returns {"title":"Walk me through the send path","body":"The turn failed."}.
// Nothing on that card may read as an answer that landed.
describe('a turn that did not land', () => {
  it('asks for him instead of reading as something worth a look', () => {
    expect(familyEyebrow('claude_turn', 'attention')).toBe('Needs you')
    expect(familyEyebrow('claude_turn', 'error')).toBe('Needs you')
  })

  it('stays silent on the turns that did land', () => {
    expect(familyEyebrow('claude_turn', 'info')).toBeNull()
  })

  it('does not let the section header claim it answered', () => {
    expect(familySectionLabel('claude_turn', 'attention')).toBe('Ask thread')
    expect(familySectionLabel('claude_turn', 'info')).toBe('Claude answered')
    expect(familySectionLabel('seat_health', 'error')).toBe('Seat health')
  })

  it('reads the loudest row in the section', () => {
    expect(worstSeverity(['info', 'attention', 'info'])).toBe('attention')
    expect(worstSeverity(['attention', 'error'])).toBe('error')
    expect(worstSeverity(['info'])).toBe('info')
  })
})

describe('plainHeadline skips lines that say nothing (cycle 2)', () => {
  it('passes over a bare number and takes the first real sentence', () => {
    expect(plainHeadline('1\n2\n3\nThe numbers from 1 to 400, one per line.')).toBe('The numbers from 1 to 400, one per line.')
  })
  it('passes over a numbered list marker with a word', () => {
    expect(plainHeadline('1. Dana Rebecca is his\n2. Sense is ours')).toBe('Dana Rebecca is his')
  })
  it('still prints a body that is only digits', () => {
    expect(plainHeadline('42')).toBe('42')
  })
})
