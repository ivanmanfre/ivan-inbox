import { describe, expect, it } from 'vitest'
import { topicLine } from './DraftNotes'

// The live Rise row on 2026-10-15: source ids in brackets, stored cut at 300 characters mid-word.
const LIVE = "Mattan agrees Meta has gotten more expensive (rise-618d6858a6). His answer is not a longer CRO checklist. It is math first: pick a 'magic number', the most you'll pay to acquire a customer, before any budget change (rise-618d6858a6, rise-238bafad89). Then protect prospecting so Meta keeps finding NE"

describe('topicLine', () => {
  it('drops the id lists and ends a stored cut on a whole word', () => {
    expect(topicLine(LIVE)).toBe("Mattan agrees Meta has gotten more expensive. His answer is not a longer CRO checklist. It is math first: pick a 'magic number', the most you'll pay to acquire a customer, before any budget change. Then protect prospecting so Meta keeps finding…")
  })
  it('leaves a whole topic alone', () => {
    const t = 'ARCH puts a first-10-days go-live into bookings, trying to avoid 20 quiet days followed by a chaotic last week.'
    expect(topicLine(t)).toBe(t)
    expect(topicLine('Meta CPMs')).toBe('Meta CPMs')
  })
  it('drops a bare id and a uuid', () => {
    expect(topicLine('The pricing ask arch-1a2b3c4d5e.')).toBe('The pricing ask.')
    expect(topicLine('Davorin on rates 0f8e1c2a-1111-4222-8333-444455556666, from the sync.')).toBe('Davorin on rates, from the sync.')
  })
  it('a cut inside an id list drops the open bracket', () => {
    const t = `${'word '.repeat(56)}the budget (rise-618d6858a6, rise-23`
    expect(t.length).toBeGreaterThanOrEqual(299)
    expect(topicLine(t)).toMatch(/the budget…$/)
  })
})
