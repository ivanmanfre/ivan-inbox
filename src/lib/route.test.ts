import { describe, it, expect } from 'vitest'
import { parseHash } from './route'

describe('parseHash', () => {
  it('parses #today to today tab', () => {
    expect(parseHash('#today')).toEqual({ tab: 'today' })
  })

  it('parses #inbox to inbox tab', () => {
    expect(parseHash('#inbox')).toEqual({ tab: 'inbox' })
  })

  it('parses #drafts, #sends, #ops, #settings tabs', () => {
    expect(parseHash('#drafts')).toEqual({ tab: 'drafts' })
    expect(parseHash('#sends')).toEqual({ tab: 'sends' })
    expect(parseHash('#ops')).toEqual({ tab: 'ops' })
    expect(parseHash('#settings')).toEqual({ tab: 'settings' })
  })

  it('parses #thread/prospect_id to inbox tab with thread id', () => {
    expect(parseHash('#thread/abc-123')).toEqual({ tab: 'inbox', thread: 'abc-123' })
  })

  it('decodes URL-encoded thread ids', () => {
    expect(parseHash('#thread/my%20prospect')).toEqual({ tab: 'inbox', thread: 'my prospect' })
  })

  it('ignores #access_token=... auth hashes', () => {
    expect(parseHash('#access_token=xyz&expires_in=3600&token_type=Bearer')).toBeNull()
    expect(parseHash('#access_token=')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseHash('')).toBeNull()
  })

  it('returns null for unrecognized tab names', () => {
    expect(parseHash('#nonsense')).toBeNull()
    expect(parseHash('#foobar')).toBeNull()
    expect(parseHash('#random-route')).toBeNull()
  })

  it('returns null for #thread/ with no id', () => {
    expect(parseHash('#thread/')).toBeNull()
  })

  it('handles thread ids with special characters', () => {
    expect(parseHash('#thread/p%2F123')).toEqual({ tab: 'inbox', thread: 'p/123' })
    expect(parseHash('#thread/p%3Fid%3D456')).toEqual({ tab: 'inbox', thread: 'p?id=456' })
  })
})
