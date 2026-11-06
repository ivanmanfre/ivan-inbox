import { supabase } from './supabase'
export type CalendarSlot = { start: string; end: string }
export type CalendarBooking = { status: string; start?: string; end?: string; calendar_event_id?: string; meeting_id?: string; handoff?: boolean; booked_at?: string }
export type CalendarResult = {
  owner: string; booking_url: string; email?: string | null; timezone?: string
  calendar?: { owner: string; checked_at: string; duration_minutes: number; timezone: string; slots: CalendarSlot[]; can_book: boolean }
  existing_booking?: CalendarBooking; booking?: CalendarBooking
}
export const CALENDAR_LINKS: Record<string, { owner: string; url: string }> = {
  risedtc: { owner: 'Mattan', url: 'https://meetings.hubspot.com/mattan5/rise-intro-call--li' },
  arch: { owner: 'Davorin', url: 'https://meetings-eu1.hubspot.com/davorin-smit' },
  ivan: { owner: 'Ivan', url: 'https://calendly.com/im-ivanmanfredi/30min' },
}
export function slotLabel(slot: CalendarSlot, timezone: string) {
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(new Date(slot.start))} (${timezone})`
}
export function proposedTimes(slots: CalendarSlot[], timezone: string) {
  return `Would ${slots.slice(0, 2).map(s => slotLabel(s, timezone)).join(' or ')} work for a 30-minute call?`
}
export async function requestCalendar(input: { prospect_id: string; action: 'availability' | 'book'; timezone: string; start?: string; email?: string; request_id?: string; confirmed?: boolean }): Promise<CalendarResult> {
  const { data } = await supabase.auth.getSession()
  if (!data.session?.access_token) throw Error('Sign in again to check the calendar.')
  const r = await window.fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-calendar`, {
    method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(75000),
  })
  const result = await r.json()
  if (!r.ok) throw Error(result.error || 'Calendar assistance is unavailable. Try again.')
  return result
}

// BOOKING_CARD_OFFERED_SLOT_V1 (2026-11-06): Book on an Ops card whose prospect said yes to the time we offered.
// Books that exact time on the owner's scheduler server-side; the held confirm reply stays unapproved.
export type CardBookResult = { status: 'booked' | 'blocked'; start?: string; recorded?: boolean; released?: boolean; already?: boolean; existing?: string; message?: string }
export async function bookFromCard(cardId: string, requestId: string): Promise<CardBookResult> {
  const { data } = await supabase.auth.getSession()
  if (!data.session?.access_token) throw Error('Sign in again to book.')
  const r = await window.fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-calendar`, {
    method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'book_card', card_id: cardId, request_id: requestId, confirmed: true }), signal: AbortSignal.timeout(75000),
  })
  const result = await r.json()
  if (!r.ok) throw Error(result.error || 'Booking is unavailable. Try again.')
  return result
}
