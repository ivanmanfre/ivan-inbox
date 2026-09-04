import { describe, expect, it } from 'vitest'
import { buildRecallCommand, extractRecallNouns } from './recall'

describe('extractRecallNouns', () => {
  it('finds a bare .md mention', () => {
    expect(extractRecallNouns('See feedback-lm-cover-2026-08-21.md for the ruling.'))
      .toContain('feedback-lm-cover-2026-08-21.md')
  })

  it('finds a capitalised multiword name', () => {
    expect(extractRecallNouns('Ivan Manfredi asked about RISE DTC pacing.'))
      .toEqual(expect.arrayContaining(['Ivan Manfredi', 'RISE DTC']))
  })

  it('is a no-op on plain prose with nothing to recall', () => {
    expect(extractRecallNouns('the queue is empty right now and nothing is waiting')).toEqual([])
  })

  it('never invents a noun the text does not literally contain', () => {
    const text = 'The content engine is fine.'
    for (const noun of extractRecallNouns(text)) {
      expect(text.includes(noun)).toBe(true)
    }
  })

  it('de-duplicates repeats, first-seen order', () => {
    const out = extractRecallNouns('RISE DTC is the client. RISE DTC pays on the 18th.')
    expect(out).toEqual(['RISE DTC'])
  })

  it('does not treat a sentence-initial stopword pair as a name', () => {
    expect(extractRecallNouns('This Week the numbers held.')).not.toContain('This Week')
  })

  it('caps a run at four words so a heading is not swallowed whole', () => {
    const out = extractRecallNouns('SEAT HEALTH CHECK PASSED TODAY FOR EVERY CLIENT')
    for (const noun of out) {
      expect(noun.split(/\s+/).length).toBeLessThanOrEqual(4)
    }
  })
})

describe('buildRecallCommand', () => {
  it('wraps the noun in the exact /recall syntax', () => {
    expect(buildRecallCommand('RISE DTC')).toBe('/recall RISE DTC')
  })
})
