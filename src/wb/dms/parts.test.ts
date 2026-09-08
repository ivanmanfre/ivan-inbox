import { describe, expect, it } from 'vitest'
import { initials } from './parts'

// W2-13: "Dragos Bogdan 🔜 Gamescom (Cologne)" sliced to "D(" — the last
// whitespace token was punctuation, not a name. Names below are invented.
describe('initials', () => {
  it('skips an emoji and trailing punctuation, taking the first two letter tokens', () => {
    expect(initials('Dragos Bogdan 🔜 Gamescom (Cologne)')).toBe('DB')
  })

  it('takes the first two letters of a single-word name', () => {
    expect(initials('Cher')).toBe('CH')
  })

  it('joins the first letter of the first two letter tokens on a normal name', () => {
    expect(initials('Ada Lovelace')).toBe('AL')
  })

  it('returns a placeholder for a name with no letters at all', () => {
    expect(initials('🔜 (2026)')).toBe('?')
  })
})
