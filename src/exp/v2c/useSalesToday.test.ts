import { describe, expect, it } from 'vitest'
import { upcomingToday } from './useSalesToday'

describe('upcomingToday', () => {
  const now = new Date('2026-09-26T10:00:00Z') // 12:00 Warsaw
  it('counts only today\'s calls that have not started', () => {
    const ev = [
      { start_time: '2026-09-26T08:00:00Z', end_time: '2026-09-26T08:30:00Z' }, // done
      { start_time: '2026-09-26T09:45:00Z', end_time: '2026-09-26T10:30:00Z' }, // running
      { start_time: '2026-09-26T14:00:00Z', end_time: null },                   // later today
      { start_time: '2026-09-26T21:30:00Z', end_time: null },                   // 23:30 Warsaw, still today
      { start_time: '2026-09-26T22:30:00Z', end_time: null },                   // 00:30 Warsaw, tomorrow
    ]
    expect(upcomingToday(ev, now)).toBe(2)
  })
})
