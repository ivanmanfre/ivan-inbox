import { describe, expect, it } from 'vitest'
import { extractRecallNouns, recallPrompt } from './recall'

describe('extractRecallNouns', () => {
  it('picks capitalised multiword names and .md mentions', () => {
    const text = 'Ivan Manfredi asked about RISE DTC pacing, per feedback-thing-2026-09-02.md.'
    const out = extractRecallNouns(text)
    expect(out).toContain('Ivan Manfredi')
    expect(out).toContain('RISE DTC')
    expect(out).toContain('feedback-thing-2026-09-02.md')
  })

  it('never invents: every result is a literal substring of the input', () => {
    const text = 'Kyle Hunt booked a call with Dom Urniezius about Growtech.'
    for (const n of extractRecallNouns(text)) expect(text.includes(n)).toBe(true)
  })

  it('drops sentence-starting capitals that are not names', () => {
    const text = 'The System is fine. This Week looks busy. Ivan Manfredi is on it.'
    const out = extractRecallNouns(text)
    expect(out).not.toContain('The System')
    expect(out).not.toContain('This Week')
    expect(out).toContain('Ivan Manfredi')
  })

  it('deduplicates case-insensitively and preserves first-seen order', () => {
    const text = 'Kyle Hunt called. Later Kyle Hunt called again. Then Dom Urniezius replied.'
    const out = extractRecallNouns(text)
    expect(out.filter(n => n.toLowerCase() === 'kyle hunt')).toHaveLength(1)
    expect(out[0]).toBe('Kyle Hunt')
  })

  it('caps at max', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Name Number${i}`).join('. ')
    expect(extractRecallNouns(text, 3)).toHaveLength(3)
  })

  it('returns nothing from prose with no proper nouns or filenames', () => {
    expect(extractRecallNouns('the pace looks fine and nothing needs a change today')).toEqual([])
  })
})

describe('recallPrompt', () => {
  it('is the literal slash form', () => {
    expect(recallPrompt('Ivan Manfredi')).toBe('/recall Ivan Manfredi')
  })
})

describe('extractRecallNouns, the things that are not names', () => {
  it('drops a run of SQL capitals rather than offering "recall NOT NULL AND"', () => {
    const out = extractRecallNouns('on the approved_at NOT NULL AND sent_at NULL predicate')
    expect(out).not.toContain('NOT NULL AND')
    expect(out.some(n => n.includes('NULL'))).toBe(false)
  })

  it('drops a bare label token like R1 or R2', () => {
    expect(extractRecallNouns('Ran R1 then R2.')).toEqual([])
  })

  it('still keeps a real name sitting in the same sentence', () => {
    const out = extractRecallNouns('LinkedIn DMs ship via the Send Messages dispatcher where sent_at NULL applies')
    expect(out).toContain('LinkedIn DMs')
    expect(out).toContain('Send Messages')
  })

  it('drops a sentence-leading adverb picked up as a first word', () => {
    expect(extractRecallNouns('Never ClickUp for this.')).toEqual([])
  })
})
