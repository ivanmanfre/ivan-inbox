import { describe, expect, it } from 'vitest'
import { armingCountWord, armingLabel, inlineLabel, label } from './labels'

describe('label', () => {
  it('maps every known value to real words', () => {
    expect(label('dm_sent')).toBe('DM sent')
    expect(label('thread_already_answered')).toBe('Already answered')
    expect(label('LEAD_MAGNET')).toBe('Lead magnet')
    expect(label('youtube_watch')).toBe('YouTube watch')
    expect(label('QA_BLOCKED')).toBe('Blocked by QA')
    expect(label('LINT_FAIL')).toBe('Failed the language check')
    expect(label('gold_icp_v2_seatless')).toBe('Gold ICP (v2)')
    expect(label('needs_regenerate')).toBe('Needs regeneration')
    expect(label('queued_v2')).toBe('Queued')
    expect(label('n8n')).toBe('Automated')
    expect(label('linkedin')).toBe('LinkedIn')
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

// ---------------------------------------------------------------------------
// 2026-08-22. The arming vocabulary, moved here after a blind design panel
// judged the month calendar and named its top-line metric as the screen's
// strongest tell that it is an internal tool:
//
//   "`Armed` is the operator's word for a state machine he wrote. No product
//    ships a top-line metric its user would have to be told the meaning of."
//
// `armed` is not a database value, which is why it never passed through label()
// and never got caught: it is a word the app COINED for a derived state. These
// assert the property rather than the prose, so the words can be tuned without
// the guard rotting into a copy of them.
// ---------------------------------------------------------------------------

describe('armingLabel / armingCountWord', () => {
  it('never returns one of the coined words to a reader', () => {
    const coined = ['armed', 'planned', 'out', 'arming', 'queue only']
    for (const v of ['armed', 'planned', 'out']) {
      expect(coined).not.toContain(armingLabel(v).toLowerCase())
      expect(coined).not.toContain(armingCountWord(v))
    }
  })

  it('the count form is lower case, because a numeral comes before it', () => {
    for (const v of ['armed', 'planned', 'out']) {
      expect(armingCountWord(v)).toBe(armingCountWord(v).toLowerCase())
    }
  })

  it('the chip form is sentence case, because it stands alone on a face', () => {
    for (const v of ['armed', 'planned', 'out']) {
      const w = armingLabel(v)
      expect(w[0]).toBe(w[0].toUpperCase())
    }
  })

  it('armed and planned stay DISTINGUISHABLE: the split is the whole point', () => {
    expect(armingLabel('armed')).not.toBe(armingLabel('planned'))
    expect(armingCountWord('armed')).not.toBe(armingCountWord('planned'))
  })

  it('falls back through label() for a state neither map has seen', () => {
    expect(armingLabel('some_new_state')).toBe('Some new state')
    expect(armingCountWord('some_new_state')).toBe('some new state')
  })

  it('returns empty string for null, undefined and empty, never throws', () => {
    for (const f of [armingLabel, armingCountWord]) {
      expect(f(null)).toBe('')
      expect(f(undefined)).toBe('')
      expect(f('')).toBe('')
    }
  })
})
