import { expect, it } from 'vitest'
import { presetRateDates, previousRateDates, validRateDates } from './rateComparison'

it('uses completed Warsaw dates when UTC is still on the preceding day', () => {
  expect(presetRateDates(7, Date.parse('2026-10-09T22:30:00Z'))).toEqual({ from: '2026-10-03', to: '2026-10-09' })
})
it('compares calendar-day windows of equal length through leap days and DST', () => {
  expect(previousRateDates({ from: '2024-03-01', to: '2024-03-03' })).toEqual({ from: '2024-02-27', to: '2024-02-29' })
  expect(previousRateDates({ from: '2026-03-28', to: '2026-03-30' })).toEqual({ from: '2026-03-25', to: '2026-03-27' })
})
it('rejects impossible, reversed and future dates before querying', () => {
  expect(validRateDates({ from: '2026-02-30', to: '2026-03-01' }, '2026-10-10')).toBe(false)
  expect(validRateDates({ from: '2026-10-11', to: '2026-10-12' }, '2026-10-10')).toBe(false)
  expect(validRateDates({ from: '2026-10-03', to: '2026-10-09' }, '2026-10-10')).toBe(true)
})
