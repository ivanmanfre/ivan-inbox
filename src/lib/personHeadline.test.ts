import { describe, expect, it } from 'vitest'
import { personHeadline } from './ops'

describe('personHeadline', () => {
  it('drops the Volume Lane mode label', () => {
    expect(personHeadline('volume lane, mode 2 (contentless)')).toBe('')
    expect(personHeadline('volume lane, mode 5')).toBe('')
  })
  it('keeps a real headline', () => {
    expect(personHeadline('Amazon & Meli growth partner for CPG brands')).toBe('Amazon & Meli growth partner for CPG brands')
    expect(personHeadline(undefined)).toBe('')
  })
})
