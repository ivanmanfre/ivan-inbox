import { describe, expect, it } from 'vitest'
import { isContentLane, isStrategyView, readStrategyDeepLink, STRATEGY_VIEWS } from './deepLink'

describe('readStrategyDeepLink', () => {
  it('reads a client-scoped lane and section together', () => {
    expect(readStrategyDeepLink('#exp/v2/strategy?lane=risedtc&section=research'))
      .toEqual({ lane: 'risedtc', section: 'research' })
  })

  it('reads a lane with no section, and a section with no lane', () => {
    expect(readStrategyDeepLink('#exp/v2/strategy?lane=arch')).toEqual({ lane: 'arch' })
    expect(readStrategyDeepLink('#exp/v2/strategy?section=results')).toEqual({ section: 'results' })
  })

  it('ignores an unregistered lane or a made-up section rather than guessing', () => {
    expect(readStrategyDeepLink('#exp/v2/strategy?lane=acme&section=made-up')).toEqual({})
    expect(readStrategyDeepLink('#exp/v2/strategy?lane=ivan&section=made-up')).toEqual({ lane: 'ivan' })
  })

  it('is silent on an ordinary hash with neither', () => {
    expect(readStrategyDeepLink('#exp/v2/strategy')).toEqual({})
    expect(readStrategyDeepLink('#exp/v2/content')).toEqual({})
  })

  it('never resolves the pre-existing Content Sources alias as a Strategy section', () => {
    // `?section=sources` picks the Strategy JOB (route.ts); it is not one of
    // StrategyView's own tab ids and must not be offered as one.
    expect(readStrategyDeepLink('#exp/v2/content?section=sources')).toEqual({})
  })

  it('accepts every real tab id, including the ones under the More disclosure', () => {
    for (const section of STRATEGY_VIEWS) {
      expect(readStrategyDeepLink(`#exp/v2/strategy?lane=ivan&section=${section}`)).toEqual({ lane: 'ivan', section })
    }
  })
})

describe('isContentLane', () => {
  it('accepts only the three registered client lanes', () => {
    expect(isContentLane('ivan')).toBe(true)
    expect(isContentLane('risedtc')).toBe(true)
    expect(isContentLane('arch')).toBe(true)
    expect(isContentLane('acme')).toBe(false)
    expect(isContentLane(null)).toBe(false)
    expect(isContentLane(undefined)).toBe(false)
    expect(isContentLane('')).toBe(false)
  })
})

describe('isStrategyView', () => {
  it('accepts only real StrategyView tab ids', () => {
    expect(isStrategyView('this-week')).toBe(true)
    expect(isStrategyView('research')).toBe(true)
    expect(isStrategyView('results')).toBe(true)
    expect(isStrategyView('direction')).toBe(true)
    expect(isStrategyView('made-up')).toBe(false)
    expect(isStrategyView(null)).toBe(false)
  })
})
