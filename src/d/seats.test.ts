import { describe, expect, it } from 'vitest'
import { outreachSeats, seatFilter, seatOf } from './seats'
import { groupThreads } from '../lib/inbox'
import { msg, NOW } from './dms/fixtures'
import { seatView } from './dms/model'
import { countDmSeat } from './counts/dmDrafts'

describe('Anna outreach seat', () => {
  it('recognizes Anna without assigning unknown clients to Ivan', () => {
    expect(seatOf('anna')).toBe('anna')
    expect(seatFilter('anna')).toBe('client_id.eq.anna')
    expect(seatOf('unknown-client')).toBeNull()
    expect(seatOf(null)).toBe('ivan')
  })
  it('remains selectable when the content registry does not include her', () => {
    expect(outreachSeats([{ client_id: 'ivan' }, { client_id: 'arch' }])).toEqual(['ivan', 'arch', 'anna'])
    expect(outreachSeats([{ client_id: 'anna' }])).toEqual(['anna'])
  })
  it('keeps Anna replies and needs-you counts out of Ivan’s inbox', () => {
    const threads = groupThreads([
      msg({ prospect_id: 'anna-lead', client_id: 'anna', direction: 'inbound', message_text: 'Yes, tell me more.', sent_at: '2026-09-27T08:00:00Z', created_at: '2026-09-27T08:00:00Z' }),
      msg({ prospect_id: 'ivan-lead', client_id: 'ivan', direction: 'inbound', sent_at: '2026-09-27T08:00:00Z', created_at: '2026-09-27T08:00:00Z' }),
      msg({ prospect_id: 'unknown-lead', client_id: 'unknown-client', direction: 'inbound' }),
    ], new Set(), NOW)
    expect(seatView(threads, 'anna', NOW).all.map(t => t.prospect_id)).toEqual(['anna-lead'])
    expect(seatView(threads, 'ivan', NOW).all.map(t => t.prospect_id)).toEqual(['ivan-lead'])
    expect(countDmSeat(threads, 'anna', NOW).needs).toBe(1)
    expect(countDmSeat(threads, 'ivan', NOW).needs).toBe(1)
  })
})
