import { describe, expect, it } from 'vitest'
import { extractRecallNouns, recallPrompt } from './recall'

describe('extractRecallNouns', () => {
  it('picks a *.md mention', () => {
    expect(extractRecallNouns('See rise-pipeline-truth-2026-08-31.md for the numbers.'))
      .toContain('rise-pipeline-truth-2026-08-31.md')
  })

  it('picks a capitalised multiword name', () => {
    expect(extractRecallNouns('Alec Lorenzo went cold after the scan offer.'))
      .toContain('Alec Lorenzo')
  })

  it('never invents a noun that is not in the text', () => {
    const out = extractRecallNouns('nothing capitalised or a filename here')
    expect(out).toEqual([])
  })

  it('ignores a single capitalised word (sentence start, not a name)', () => {
    const out = extractRecallNouns('Today the lane recovered on its own.')
    expect(out).toEqual([])
  })

  it('de-duplicates and caps at 3', () => {
    const out = extractRecallNouns(
      'Alec Lorenzo talked to Alec Lorenzo about Content System and Ops Board and Warm Engine and Cold Engine.',
    )
    expect(out.length).toBeLessThanOrEqual(3)
    expect(new Set(out).size).toBe(out.length)
  })

  it('returns [] for empty input', () => {
    expect(extractRecallNouns('')).toEqual([])
  })
})

describe('recallPrompt', () => {
  it('formats the slash command sent as a new turn', () => {
    expect(recallPrompt('Alec Lorenzo')).toBe('/recall Alec Lorenzo')
  })
})
