import { describe, expect, it } from 'vitest'
import { MIN_DIMS, parseRubric, verdictsDisagree } from './rubric'

// The fixture is the shape the live judge writes — the one the ledger measured
// at 2,187 characters on the proof row (D14).
const LIVE = `VERDICT: REWRITE_OK (total 71/90)

VOICE: 8/10 — sounds like him, no ghostwriter cadence
SUBSTANCE: 8/10
SPECIFICITY: 7/10 — the number is there, the denominator is not
DISTINCT: 7/10
OPINION: 8/10
ECONOMY: 6/10 — two clauses doing one clause's work
HOOK: 9/10
VERIFIED: 9/10
AI_TELLS: 9/10

Summary: publishable after the economy pass; the claim is his own.
Spice: the second paragraph is the post.`

describe('parseRubric', () => {
  it('reads the nine dimensions, the verdict and the total off a live body', () => {
    const r = parseRubric(LIVE)
    expect(r.ok).toBe(true)
    expect(r.dims.map(d => d.key)).toEqual([
      'VOICE', 'SUBSTANCE', 'SPECIFICITY', 'DISTINCT', 'OPINION',
      'ECONOMY', 'HOOK', 'VERIFIED', 'AI_TELLS',
    ])
    expect(r.verdict).toBe('REWRITE_OK')
    expect(r.total).toEqual({ score: 71, max: 90 })
    expect(r.summary).toBe('publishable after the economy pass; the claim is his own.')
    expect(r.spice).toBe('the second paragraph is the post.')
  })

  it('keeps each dimension its OWN denominator rather than assuming /10', () => {
    const r = parseRubric('A_ONE: 4/5\nB_TWO: 8/10\nC_THREE: 3/5')
    expect(r.dims.map(d => [d.score, d.max])).toEqual([[4, 5], [8, 10], [3, 5]])
  })

  it('carries the note written after the score, and null when there is none', () => {
    const r = parseRubric('VOICE: 8/10 — sounds like him\nHOOK: 9/10\nECONOMY: 6/10')
    expect(r.dims[0].note).toBe('sounds like him')
    expect(r.dims[1].note).toBeNull()
  })

  // GRACEFUL FALLBACK — the rule the whole module exists under.
  it('declares failure under the minimum, so the caller falls back to the dump', () => {
    const r = parseRubric('VOICE: 8/10\nHOOK: 9/10')
    expect(r.dims).toHaveLength(2)
    expect(MIN_DIMS).toBe(3)
    expect(r.ok).toBe(false)
  })

  it('is empty and not-ok on prose that carries no rubric at all', () => {
    const r = parseRubric('This one reads fine. Ship it.')
    expect(r).toMatchObject({ ok: false, dims: [], verdict: null, total: null })
  })

  it.each([null, undefined, ''])('is empty and not-ok on %p', v => {
    expect(parseRubric(v).ok).toBe(false)
  })

  // A fraction inside a sentence is not a score.
  it('does not mistake prose containing a fraction for a dimension', () => {
    const r = parseRubric('We cut 3/4 of the hook.\nthe claim is 2/3 verified.')
    expect(r.dims).toEqual([])
  })

  it('never counts TOTAL or SCORE as a dimension', () => {
    const r = parseRubric('TOTAL: 71/90\nSCORE: 8/10\nVOICE: 8/10\nHOOK: 9/10\nECONOMY: 6/10')
    expect(r.dims.map(d => d.key)).toEqual(['VOICE', 'HOOK', 'ECONOMY'])
  })

  // 🔴 A regeneration appends a second pass to the same string; the printed
  // verdict belongs to the FIRST block, so the first score of a key wins.
  it('takes the first pass of a repeated key, not the last', () => {
    const r = parseRubric('VOICE: 5/10\nHOOK: 4/10\nECONOMY: 4/10\n---\nVOICE: 9/10\nHOOK: 9/10')
    expect(r.dims.find(d => d.key === 'VOICE')?.score).toBe(5)
  })

  it('reads a verdict with no total', () => {
    const r = parseRubric('VERDICT: PASS\nVOICE: 8/10\nHOOK: 9/10\nECONOMY: 7/10')
    expect(r.verdict).toBe('PASS')
    expect(r.total).toBeNull()
    expect(r.ok).toBe(true)
  })
})

describe('verdictsDisagree', () => {
  // The live pair the pane must never resolve on its own.
  it('is true for the PASS / REWRITE_OK row', () => {
    expect(verdictsDisagree('PASS', 'REWRITE_OK')).toBe(true)
  })
  it('is false when they agree, whatever the casing or padding', () => {
    expect(verdictsDisagree('PASS', ' pass ')).toBe(false)
  })
  it('is false when either side is missing — absence is not disagreement', () => {
    expect(verdictsDisagree(null, 'PASS')).toBe(false)
    expect(verdictsDisagree('PASS', null)).toBe(false)
  })
})
