import { describe, expect, it } from 'vitest'
import { readScanHold } from './scanHold'

describe('readScanHold', () => {
  it('an owed scan wins over a legacy hold and is never a manual task', () => {
    expect(readScanHold({ status: 'needs_review', reason: 'Held: x' }, { status: 'building', reason: 'Automatic repair round 2 started | y' }))
      .toEqual({ reason: 'Automatic repair round 2 started', url: null, owed: true })
  })
  it('keeps the legacy held banner', () => {
    expect(readScanHold({ status: 'needs_review', reason: 'Held: thin | z', report_url: 'u' }, null)).toEqual({ reason: 'thin', url: 'u' })
    expect(readScanHold(null, null)).toBeNull()
  })
})
