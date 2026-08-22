import { supabase } from './supabase'

// The next-call card (port #1, dashboard-port-audit.md). The old dashboard's
// Calls section reads `calendar_events` for the next 7 days; this inbox has
// never read that table at all, so it cannot answer "do I have a call
// today", the exact question the URL Ivan sent
// (`?section=today&sub=meetings`) was pointing at. Read-only: this file adds
// one select, no write, no RPC, no migration.
//
// Ported from personal-site (READ ONLY reference, never built/committed/
// deployed from here): hooks/useUpcomingEvents.ts (the query plus the 7-day/
// non-all-day/limit-20 shape) and
// components/dashboard-v2/sections/rebuilt/CallsRebuilt.tsx:98-133
// (describeWhen, the next/rest split). Two bugs in that source are
// deliberately NOT carried across, see resolveMeetingType and
// fetchUpcomingEvents below.

export type MeetingTypeKey = 'discovery_sales' | 'technical_audit' | 'client_kickoff' | 'internal'

export const MEETING_TYPE_LABEL: Record<MeetingTypeKey, string> = {
  discovery_sales: 'Discovery',
  technical_audit: 'Technical audit',
  client_kickoff: 'Client kickoff',
  internal: 'Internal',
}

export type CalendarEvent = {
  id: string
  title: string
  start_time: string
  end_time: string | null
  attendees: string[]
  meeting_url: string | null
  is_all_day: boolean
  is_test: boolean | null
  meeting_type: string | null
  source: string | null
  referral_token: string | null
  booking_source_path: string | null
}

const COLS = 'id, title, start_time, end_time, attendees, meeting_url, is_all_day, is_test, ' +
  'meeting_type, source, referral_token, booking_source_path'

// Bug 2 in the source (calendly-webhook flags `is_test` on the write side,
// useUpcomingEvents never filters it on the read side, so a test booking can
// occupy the hero). Filtered CLIENT-SIDE, not with `.eq('is_test', false)`:
// that drops every row where is_test is NULL (Google-Calendar-sourced rows
// never write the column at all), which is exactly the NULL-drop trap this
// codebase's own PostgREST notes warn about. Only `=== true` is excluded.
export function isRealBooking(e: { is_test: boolean | null }): boolean {
  return e.is_test !== true
}

export async function fetchUpcomingEvents(now: Date = new Date()): Promise<CalendarEvent[]> {
  const nowIso = now.toISOString()
  const weekIso = new Date(now.getTime() + 7 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('calendar_events')
    .select(COLS)
    .gte('end_time', nowIso)
    .lte('start_time', weekIso)
    .eq('is_all_day', false)
    .order('start_time', { ascending: true })
    .limit(20)
  if (error) throw error
  // `calendar_events` carries no generated schema type in this client (this
  // inbox has never read the table before this file), so PostgREST-js can't
  // infer the select shape and falls back to a safety-net error type. Cast
  // through unknown, same as every other ad-hoc read in this codebase that
  // touches a table outside the generated types.
  return ((data ?? []) as unknown as CalendarEvent[]).filter(isRealBooking)
}

const DISCOVERY_RX = /\b(discovery|intro|fit\s*call|sales|consult|consultation|first\s*call)\b/i
const TECHNICAL_RX = /\b(audit|review|technical|deep\s*dive|architecture|stack|debug)\b/i
const KICKOFF_RX = /\b(kickoff|kick.?off|onboarding|start[- ]?up|launch)\b/i
const INTERNAL_RX = /\b(team|standup|stand.?up|internal|1:1|sync|retro)\b/i

function classifyTitle(title: string | null): MeetingTypeKey | null {
  if (!title) return null
  if (DISCOVERY_RX.test(title)) return 'discovery_sales'
  if (TECHNICAL_RX.test(title)) return 'technical_audit'
  if (KICKOFF_RX.test(title)) return 'client_kickoff'
  if (INTERNAL_RX.test(title)) return 'internal'
  return null
}

const VALID_KEYS = new Set<string>(['discovery_sales', 'technical_audit', 'client_kickoff', 'internal'])

// Bug 1 in the source: `stored || resolveMeetingTypeFromTitle(title)` trusts
// whatever Calendly wrote as `meeting_type` even though Calendly writes the
// free-text event name ("30 Minute Meeting"), not one of the 5 enum keys, so
// the old UI looks up an enum entry that cannot exist and renders a "?"
// chip. Here `stored` is validated against the real key set FIRST; an
// unresolvable title (Calendly free text, or nothing recognizable) returns
// null rather than a fabricated "Unknown" badge: the card renders no chip
// at all rather than a question mark.
export function resolveMeetingType(e: { meeting_type: string | null; title: string }): MeetingTypeKey | null {
  if (e.meeting_type && VALID_KEYS.has(e.meeting_type)) return e.meeting_type as MeetingTypeKey
  return classifyTitle(e.title)
}

export type When = { day: string; today: boolean; time: string; endTime: string | null; soonMs: number }

export function describeWhen(e: CalendarEvent, now: Date = new Date()): When {
  const start = new Date(e.start_time)
  const end = e.end_time ? new Date(e.end_time) : null
  const diffMs = start.getTime() - now.getTime()
  const today = start.toDateString() === now.toDateString()
  const tomorrow = start.toDateString() === new Date(now.getTime() + 86_400_000).toDateString()
  const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const endTime = end ? end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null
  const day = today ? 'Today' : tomorrow ? 'Tomorrow'
    : start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return { day, today, time, endTime, soonMs: diffMs }
}

export function isStartingSoon(w: When): boolean {
  return w.soonMs > 0 && w.soonMs < 3_600_000
}
