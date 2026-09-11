import { describe, it, expect } from 'vitest'
import { followUpNoteLine, followUpSuggestion, mergeFollowUpNote, splitFollowUpNote, SUGGEST_DEFAULT_DAYS } from './followUp'
import { emailRowSender, NATIVE_EMAIL_SENDER, SNOOZE_HOUR } from './inbox'

describe('follow-up note line', () => {
  it('writes one bracketed line the drafter can read', () => {
    const line = followUpNoteLine('2026-10-13T07:00:00Z', 'back mid October')
    expect(line).toMatch(/^\[Follow-up .*13 Oct 2026\] back mid October$/)
  })

  it('keeps the rest of the operator note and replaces an older follow-up line', () => {
    const existing = 'Hand-written context.\n\n[Follow-up Mon 1 Sep 2026] old reason'
    const merged = mergeFollowUpNote(existing, '2026-10-13T07:00:00Z', 'new reason')
    expect(merged.startsWith('Hand-written context.')).toBe(true)
    expect(merged).not.toContain('old reason')
    expect(merged).toContain('new reason')
    expect(merged.match(/\[Follow-up /g)?.length).toBe(1)
  })

  it('splits the line back out and returns the note without it', () => {
    const { rest, line } = splitFollowUpNote('ctx\n\n[Follow-up Tue 13 Oct 2026] set the catch-up')
    expect(rest).toBe('ctx')
    expect(line).toBe('set the catch-up')
    expect(splitFollowUpNote(null)).toEqual({ rest: '', line: null })
  })
})

describe('emailRowSender', () => {
  it('names the client identity for a client row and Ivan\'s mailbox otherwise', () => {
    expect(emailRowSender('risedtc')).toBe('itsmattan@risedtc.com')
    expect(emailRowSender('arch')).toBe('davorin@madebyarch.com')
    expect(emailRowSender('ivan')).toBe(NATIVE_EMAIL_SENDER)
    expect(emailRowSender(null)).toBe(NATIVE_EMAIL_SENDER)
  })
})

describe('followUpSuggestion', () => {
  const now = new Date(2026, 8, 12, 10, 0, 0) // Sat 12 Sep 2026, 10:00 local
  const ev = (follow_up: unknown) => ({ brief: { follow_up } }) as Parameters<typeof followUpSuggestion>[0]

  it('is silent when the planner recorded no ask', () => {
    expect(followUpSuggestion(null, now)).toBeNull()
    expect(followUpSuggestion({ brief: {} }, now)).toBeNull()
    expect(followUpSuggestion(ev({ asked: false, when: '2026-10-02' }), now)).toBeNull()
  })

  it("offers the model's date at the snooze hour, local", () => {
    const s = followUpSuggestion(ev({ asked: true, when: '2026-10-02', why: 'remind in few weeks' }), now)
    expect(s).not.toBeNull()
    const d = new Date(s!.at)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 2, SNOOZE_HOUR])
    expect(s!.why).toBe('remind in few weeks')
    expect(s!.dated).toBe(true)
  })

  it('falls back to the default window when the date is missing, malformed or already past', () => {
    for (const when of [null, undefined, 'few weeks', '2026-09-01']) {
      const s = followUpSuggestion(ev({ asked: true, when }), now)
      expect(s).not.toBeNull()
      const d = new Date(s!.at)
      expect(Math.round((d.getTime() - now.getTime()) / 864e5)).toBe(SUGGEST_DEFAULT_DAYS)
      expect(d.getHours()).toBe(SNOOZE_HOUR)
      expect(s!.dated).toBe(false)
    }
  })
})
