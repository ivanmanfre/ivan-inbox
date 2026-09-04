import { describe, expect, it } from 'vitest'
import { resolveNotificationRoute } from './deepLink'

const UUID = 'a1b2c3d4-e5f6-4789-8abc-1234567890ab'

describe('resolveNotificationRoute', () => {
  it('routes an ask link (the server writes ./#exp/v2/ask?thread=…) to the Ask place with the thread', () => {
    const out = resolveNotificationRoute({ url: `./#exp/v2/ask?thread=${UUID}` })
    expect(out).toEqual({ place: 'ask', thread: UUID })
  })

  it('routes an ask link with no thread param to Ask with a null thread', () => {
    expect(resolveNotificationRoute({ url: './#exp/v2/ask' })).toEqual({ place: 'ask', thread: null })
  })

  it('routes a real job segment to that lane', () => {
    expect(resolveNotificationRoute({ url: '#exp/v2/dms' })).toEqual({ place: 'lane', job: 'dms' })
  })

  it('falls back to the lane fallback (today) for a missing or malformed url', () => {
    expect(resolveNotificationRoute({ url: null })).toEqual({ place: 'lane', job: 'today' })
    expect(resolveNotificationRoute({ url: 'https://example.com/no-hash' })).toEqual({ place: 'lane', job: 'today' })
  })

  it('never resolves to an absolute external url', () => {
    const out = resolveNotificationRoute({ url: 'https://linkedin.com/feed/update/urn:li:activity:1' })
    expect(out).toEqual({ place: 'lane', job: 'today' })
  })
})
