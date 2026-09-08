import { describe, expect, it } from 'vitest'
import { draftExplanationFreshness, normalizeDraftExplanation } from './draftExplanation'

describe('saved draft explanation', () => {
  it('projects only the brief, limits, facts and safe research links', () => {
    const result = normalizeDraftExplanation({
      generated_text: ' Original draft. ',
      brief: { they_mean: ' A question. ', the_move: 'Answer it.', limits_to_name: 'No verified rate.', unresolved: ['Price?', null], reasoning: 'PRIVATE REASONING', do_not_say: ['PRIVATE'], unknown_terms: { hidden: 'PRIVATE' } },
      facts: ['Company fact.', null], operator_note: 'PRIVATE OPERATOR', brief_raw: 'PRIVATE RAW',
      research: [{ term: 'PRIVATE TERM', hits: [
        { title: 'Company page', url: 'https://example.com/company', snippet: 'PRIVATE SNIPPET' },
        { title: 'Duplicate', url: 'https://example.com/company' },
        { title: 'Unsafe', url: 'javascript:alert(1)' },
        { title: 'Credentials', url: 'https://user:secret@example.com' },
      ] }],
    })
    expect(result).toEqual({
      theyMean: 'A question.', move: 'Answer it.', limits: 'No verified rate.', unresolved: ['Price?'],
      facts: ['Company fact.'], sources: [{ title: 'Company page', url: 'https://example.com/company' }], generatedText: ' Original draft. ',
    })
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })

  it.each([null, [], 'invalid', { brief: [], facts: {}, research: 'bad' }])('accepts malformed or missing legacy evidence: %j', value => {
    expect(normalizeDraftExplanation(value)).toEqual({ theyMean: null, move: null, limits: null, unresolved: [], facts: [], sources: [], generatedText: null })
  })

  it('does not stringify nested model output or use reasoning as a fallback', () => {
    expect(normalizeDraftExplanation({ brief: { they_mean: { text: 'no' }, reasoning: 'do not show' } }).theyMean).toBeNull()
  })

  it('distinguishes original, edited, and older drafts without a saved original', () => {
    expect(draftExplanationFreshness('draft', 'draft', 'draft')).toBe('original')
    expect(draftExplanationFreshness('draft', 'edited and saved', 'edited and saved')).toBe('edited')
    expect(draftExplanationFreshness(null, 'draft', 'local edit')).toBe('edited')
    expect(draftExplanationFreshness(null, 'saved draft', 'saved draft')).toBe('unknown')
    // Same-row regeneration: the editor still holds the old body.
    expect(draftExplanationFreshness('new body', 'new body', 'old body')).toBe('edited')
  })
})
