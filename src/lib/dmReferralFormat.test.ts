import { describe, expect, it } from 'vitest'
import { formatReferralDm } from '../../supabase/functions/inbox-dm-draft/referral'

const offer = 'Saw Preply has run at least 6 sponsored YouTube videos since April, with creators like Ariannita la Gringa. Want the list, plus which of them would fit BUKI?'

describe('referral first-touch layout', () => {
  it('joins paragraphs with a blank line, greeting alone on the first line', () => {
    expect(formatReferralDm({ paragraphs: ['Hey Olena', "Vadym mentioned you're the one to talk to about creator campaigns at BUKI.", "I'm Davorin, founder of ARCH."] }))
      .toBe("Hey Olena\n\nVadym mentioned you're the one to talk to about creator campaigns at BUKI.\n\nI'm Davorin, founder of ARCH.")
  })
  it('splits a greeting run into the first sentence (the Olena block)', () => {
    expect(formatReferralDm({ draft: "Hi Olena. Vadym said you're the better person to connect with. Would a short overview be useful?" }))
      .toBe("Hi Olena\n\nVadym said you're the better person to connect with. Would a short overview be useful?")
  })
  it('appends the approved offer verbatim, once', () => {
    const out = formatReferralDm({ paragraphs: ['Hey Olena', 'Vadym mentioned you at BUKI.', offer] }, offer)
    expect(out).toBe(`Hey Olena\n\nVadym mentioned you at BUKI.\n\n${offer}`)
    expect(out!.split(offer)).toHaveLength(2)
  })
  it('returns null when the model wrote nothing', () => {
    expect(formatReferralDm({ paragraphs: null, reason: 'wrong person' })).toBeNull()
    expect(formatReferralDm({ paragraphs: ['  '] }, offer)).toBeNull()
  })
})

describe('referral layout edge cases (Sol r1)', () => {
  it('never splits inside a name', () => {
    expect(formatReferralDm({ draft: 'Hey O’Connor, Vadym mentioned you.' })).toBe('Hey O’Connor\n\nVadym mentioned you.')
    expect(formatReferralDm({ draft: 'Hey José' })).toBe('Hey José')
    expect(formatReferralDm({ draft: 'Hey दीपक, Vadym mentioned you.' })).toBe('Hey दीपक\n\nVadym mentioned you.')
    expect(formatReferralDm({ draft: 'Hey Mary-Jane. Vadym mentioned you.' })).toBe('Hey Mary-Jane\n\nVadym mentioned you.')
    expect(formatReferralDm({ draft: 'Hi there. Vadym mentioned you.' })).toBe('Hi there\n\nVadym mentioned you.')
    expect(formatReferralDm({ draft: 'Hey Olena Vadym mentioned you.' })).toBe('Hey Olena Vadym mentioned you.')
  })
  it('keeps one offer when the model embedded it in a paragraph', () => {
    const out = formatReferralDm({ draft: `Hi Olena. Vadym mentioned you. ${offer}` }, offer)
    expect(out).toBe(`Hi Olena\n\nVadym mentioned you.\n\n${offer}`)
  })
})
