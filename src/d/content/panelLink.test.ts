import { describe, expect, it } from 'vitest'
import { panelUrl } from './panelLink'

describe('panelUrl', () => {
  it('opens the board, or one post on it', () => {
    const b = { slug: 'risedtc-com', token: 'a b&c' }
    expect(panelUrl(b)).toBe('https://ivanmanfredi.com/client/risedtc-com?k=a+b%26c')
    expect(panelUrl(b, '1234-abcd')).toBe('https://ivanmanfredi.com/client/risedtc-com?k=a+b%26c&post=1234-abcd')
  })
  it('no board, no link', () => {
    expect(panelUrl(null, 'x')).toBeUndefined()
  })
})
