import { fetchUpcomingEvents, type CalendarEvent } from '../../lib/nextCall'
import { warsawDayTime } from '../ui/time'

// Sales "Next call": the first live booking in the next 7 days (the same read
// and the same test/cancelled filters as today's Sales), in Warsaw time.
export type NextCall = { label: string; title: string | null; start: string | null }

export function nextCallLine(events: CalendarEvent[], now: Date = new Date()): NextCall {
  const next = events.find(e => Date.parse(e.end_time ?? e.start_time) >= now.getTime())
  if (!next) return { label: 'none booked this week', title: null, start: null }
  return { label: warsawDayTime(next.start_time), title: next.title, start: next.start_time }
}

export async function fetchNextCall(now: Date = new Date()): Promise<NextCall> {
  return nextCallLine(await fetchUpcomingEvents(now), now)
}
