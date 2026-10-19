import { describe, expect, it } from 'vitest'
import { declineLine, historyLine } from './replyHistory'

describe('reply draft test signals', () => {
  it('shows counts, never a percentage, and holds back under 5', () => {
    const base = { windowDays: 45, intent: 'negative', move: null, model: 'arch_reply_draft_v2' }
    expect(historyLine({ ...base, n: 25, unchanged: 7, edited: 9, discarded: 9 })).toBe('You sent 7 of 25 like this unchanged (45d) · edited 9, discarded 9')
    expect(historyLine({ ...base, n: 4, unchanged: 4, edited: 0, discarded: 0 })).toBe('Not enough history yet (4)')
    expect(historyLine({ ...base, n: 25, unchanged: 7, edited: 9, discarded: 9 })).not.toMatch(/%/)
  })
  it('reads the decline shadow in plain words', () => {
    expect(declineLine({ v: 'decline_shadow_v1', type: 'wrong_person', is_decline: true, would_send: 'nothing' })).toBe('wrong person / left → would send nothing')
    expect(declineLine({ v: 'decline_shadow_v1', type: 'none', is_decline: false, would_send: 'writer' })).toBe("not a decline → would keep the drafter's reply")
    expect(declineLine({ v: 'decline_shadow_v1', type: 'not_now', is_decline: true, would_send: 'close_door' })).toBe('not now → would close + door open')
    expect(declineLine({ v: 'other' })).toBeNull()
  })
})
