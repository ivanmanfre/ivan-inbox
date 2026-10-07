import { describe, expect, it } from 'vitest'
import { initials, linePill, nextStepOf } from './pill'

describe('linePill (parity with Brief 3.0 bridge.js linePill)', () => {
  it('Due is warn, Estimated follow-up reads Estimated (neutral), Scheduled return is info', () => {
    expect(linePill('Due · Ask about the pilot')).toEqual({ label: 'Due', tone: 'warn', rest: 'Ask about the pilot' })
    expect(linePill('Estimated follow-up · Conversation check pending')).toEqual({ label: 'Estimated', tone: 'neutral', rest: 'Conversation check pending' })
    expect(linePill('Estimated · x')).toEqual({ label: 'Estimated', tone: 'neutral', rest: 'x' })
    expect(linePill('Scheduled return · Ask Javier about the budget')).toEqual({ label: 'Scheduled return', tone: 'info', rest: 'Ask Javier about the budget' })
  })
  it('no match stays text (a plain line is never turned into a state)', () => {
    expect(linePill('Sure thing John -- we work on a performance model')).toBeNull()
    expect(linePill('Due tomorrow')).toBeNull()
  })
  it('the Later lines get their own pills, an estimate never reads as scheduled', () => {
    expect(linePill('Draft returns for review')?.label).toBe('Draft returns')
    expect(linePill('Scheduled return · draft when due')?.tone).toBe('info')
    expect(linePill('Estimated follow-up · x')?.label).not.toBe('Scheduled return')
  })
  it('initials and the next step', () => {
    expect(initials('John Mark Pero')).toBe('JM')
    expect(initials('Acme, Inc.')).toBe('A')
    expect(initials('👩🏽‍💻 Krishna Solanki')).toBe('KS')
    expect(initials('🌱 Kathryn Castle')).toBe('KC')
    expect(nextStepOf('Conversation check pending')).toBeNull()
    expect(nextStepOf('Ask about the pilot')).toBe('Ask about the pilot')
  })
})
