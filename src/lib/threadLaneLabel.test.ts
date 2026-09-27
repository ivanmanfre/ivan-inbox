import { describe, expect, it } from 'vitest'
import { threadLaneLabel } from './labels'

describe('threadLaneLabel', () => {
  it('prefers the stored per-person lane', () => {
    expect(threadLaneLabel('cold_games', 'cold')).toBe('Cold (games)')
  })
  it('falls back to the campaign lane (Ivan and RISE rows)', () => {
    expect(threadLaneLabel(null, 'harvest')).toBe('Harvested')
    expect(threadLaneLabel(undefined, 'engager')).toBe('Engager')
  })
  it('is empty when neither is known', () => {
    expect(threadLaneLabel(null, null)).toBe('')
  })
})
