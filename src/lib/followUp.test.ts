import { describe, it, expect } from 'vitest'
import { followUpNoteLine, mergeFollowUpNote, splitFollowUpNote } from './followUp'
import { emailRowSender, NATIVE_EMAIL_SENDER } from './inbox'

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
