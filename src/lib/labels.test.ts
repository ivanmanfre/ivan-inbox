import { describe, expect, it } from 'vitest'
import { inlineLabel, label } from './labels'

describe('label', () => {
  it('maps every known value to real words', () => {
    expect(label('dm_sent')).toBe('DM sent')
    expect(label('thread_already_answered')).toBe('Already answered')
    expect(label('LEAD_MAGNET')).toBe('Lead magnet')
    expect(label('youtube_watch')).toBe('YouTube watch')
    expect(label('QA_BLOCKED')).toBe('Blocked by QA')
    expect(label('LINT_FAIL')).toBe('Failed the language check')
    expect(label('gold_icp_v2_seatless')).toBe('Gold ICP (v2)')
  })

  it('is case-insensitive, so dm_sent and Dm_sent hit the same entry', () => {
    expect(label('Dm_sent')).toBe('DM sent')
    expect(label('DM_SENT')).toBe('DM sent')
    expect(label('dM_sEnT')).toBe('DM sent')
  })

  it('degrades an unknown value to a readable sentence, never a raw token', () => {
    expect(label('some_new_enum_v3')).toBe('Some new enum v3')
    expect(label('single_word')).toBe('Single word')
  })

  it('handles a colon-separated race-hold style reason without crashing', () => {
    expect(label('post_approval_race:abc123')).toBe('Post approval race abc123')
  })

  it('returns empty string for null and undefined, never throws', () => {
    expect(label(null)).toBe('')
    expect(label(undefined)).toBe('')
  })

  it('returns empty string for an empty or whitespace-only value', () => {
    expect(label('')).toBe('')
    expect(label('   ')).toBe('')
  })

  it('passes an already-human value through untouched', () => {
    expect(label('Not accepted yet')).toBe('Not accepted yet')
    expect(label('Sent')).toBe('Sent')
    expect(label('Already answered')).toBe('Already answered')
  })

  it('leaves a single lowercase word with no underscore alone but sentence-cased', () => {
    // No space and no underscore is not "already human" by the pass-through
    // rule (that rule requires a space); a bare single word still degrades.
    expect(label('archived')).toBe('Archived')
  })
})

describe('inlineLabel', () => {
  it('swaps a known raw token embedded in a larger sentence, and leaves the rest alone', () => {
    const text = 'RISE warm engager (gold_icp_v2_seatless 66/78): comment on Daniel Scharff 1d ago; Shopify single-brand.'
    expect(inlineLabel(text)).toBe(
      'RISE warm engager (Gold ICP (v2) 66/78): comment on Daniel Scharff 1d ago; Shopify single-brand.'
    )
  })

  it('is case-insensitive like label()', () => {
    expect(inlineLabel('scored by GOLD_ICP_V2_SEATLESS today')).toBe('scored by Gold ICP (v2) today')
  })

  it('returns the text unchanged when it carries no known token', () => {
    const text = 'a plain sentence with no raw enum in it at all'
    expect(inlineLabel(text)).toBe(text)
  })

  it('returns empty string for null and undefined, never throws', () => {
    expect(inlineLabel(null)).toBe('')
    expect(inlineLabel(undefined)).toBe('')
  })

  it('returns empty string unchanged for an empty string', () => {
    expect(inlineLabel('')).toBe('')
  })
})
