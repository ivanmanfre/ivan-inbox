import { expect, it } from 'vitest'
import { alreadyRepliedBy, wantsOwnWords } from './usePendingCard'

it('names the seat\'s own person, never a hard-coded one', () => {
  expect(alreadyRepliedBy('swishdm')).toBe('Jonathan')
  expect(alreadyRepliedBy('arch')).toBe('Davorin')
  expect(alreadyRepliedBy('risedtc')).toBe('Mattan')
  expect(alreadyRepliedBy('ivan')).toBe('You')
  expect(wantsOwnWords('swishdm')).toBe('Jonathan in his own words')
  expect(wantsOwnWords('risedtc')).toBe('Mattan in his own words')
  expect(wantsOwnWords('ivan')).toBe('your own words')
})
