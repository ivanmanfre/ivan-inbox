import { describe, expect, it } from 'vitest'
import { parseEmailCc } from './emailCc'

describe('email CC recipients', () => {
  it('keeps Thomas in To and normalizes distinct CC addresses', () => {
    expect(parseEmailCc(' michael@vmisports.com; MICHAEL@vmisports.com, other@vmisports.com ')).toEqual(['michael@vmisports.com', 'other@vmisports.com'])
    expect(parseEmailCc(['michael@vmisports.com'])).toEqual(['michael@vmisports.com'])
    expect(parseEmailCc('')).toEqual([])
  })
  it.each(['Michael', 'michael@', 'michael@vmisports.com\nBcc: stranger@example.com', ['michael@vmisports.com', 1], { cc: 'michael@vmisports.com' }])('rejects invalid CC without silently dropping it: %j', value => {
    expect(() => parseEmailCc(value)).toThrow(/CC/)
  })
})
