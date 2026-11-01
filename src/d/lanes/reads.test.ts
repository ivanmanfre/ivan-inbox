import { expect, it } from 'vitest'
import { warmCountFor } from './reads'

it("counts only Ivan's warm signals, not every seat's", () => {
  const rows = [{ tenant: 'risedtc' }, { tenant: 'risedtc' }, { tenant: 'arch' }, { tenant: 'ivan' }, { tenant: null }, {}]
  expect(warmCountFor(rows, 'ivan')).toBe(3)
  expect(warmCountFor([{ tenant: 'risedtc' }, { tenant: 'risedtc' }], 'ivan')).toBe(0)
  expect(warmCountFor(null, 'ivan')).toBe(0)
})
