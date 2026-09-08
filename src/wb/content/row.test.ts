import { describe, expect, it } from 'vitest'
import { draftInitials } from './row'

// W3-17: the thumbnail fallback when a client-photo storage object 400s.
describe('draftInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(draftInitials('Tulum vibes, main shot')).toBe('TV')
  })

  it('takes the first two letters of a single-word title', () => {
    expect(draftInitials('Postcard')).toBe('PO')
  })

  it('returns a placeholder for a title with no letters', () => {
    expect(draftInitials('2026 🔜')).toBe('?')
  })
})
