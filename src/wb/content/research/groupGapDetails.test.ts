import { describe, expect, it } from 'vitest'
import { groupGapDetails } from './ResearchWorkspace'

describe('groupGapDetails (Run6 C04 F2: the gap ledger repeated 3 sentences 2,311 times on the Ivan lane)', () => {
  it('groups identical details with counts, most frequent first, keeping every distinct detail', () => {
    const gaps = [
      { detail: 'Original body is absent.' }, { detail: 'Original post or call passage unavailable.' },
      { detail: 'Original body is absent.' }, { detail: 'Original body is absent.' }, { detail: 'Unsupported record kind.' },
    ]
    expect(groupGapDetails(gaps)).toEqual([
      ['Original body is absent.', 3],
      ['Original post or call passage unavailable.', 1],
      ['Unsupported record kind.', 1],
    ])
  })
  it('returns nothing for no gaps', () => { expect(groupGapDetails([])).toEqual([]) })
})
