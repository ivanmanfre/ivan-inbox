/* ==========================================================================
   src/wb/sales/match.ts — the week, the grouping, and which pack belongs to
   which call. Pure, so it is testable in node instead of only in a browser.

   ALL THREE ANSWERS ARE IN EUROPE/WARSAW, and none of them is `new Date()
   .getDay()`. The machine this app is read on travels; the week he is selling
   in does not. Every calendar-day decision here therefore goes through
   `Intl.DateTimeFormat` with an explicit `timeZone`, and no library is added
   to do it.
   ========================================================================== */
import { isStartingSoon, type When } from '../../lib/nextCall'
import type { PackMeta, WeekEvent } from '../../lib/salesPacks'

export const WARSAW = 'Europe/Warsaw'

// ---------------------------------------------------------------------------
// Time zone arithmetic without a library
// ---------------------------------------------------------------------------

type Wall = { y: number; m: number; d: number; h: number; mi: number; s: number }

const partsFmt = (tz: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: tz, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

/** The wall clock a given instant shows in `tz`. */
function wallOf(at: Date, tz: string): Wall {
  const p: Record<string, string> = {}
  for (const part of partsFmt(tz).formatToParts(at)) p[part.type] = part.value
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    h: Number(p.hour), mi: Number(p.minute), s: Number(p.second),
  }
}

/** How far `tz` is ahead of UTC at that instant, in ms. */
function offsetAt(at: Date, tz: string): number {
  const w = wallOf(at, tz)
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(at.getTime() / 1000) * 1000
}

/**
 * The instant at which `tz` shows this wall clock. Solved twice because the
 * offset depends on the answer: the first pass uses the offset at the naive
 * guess, the second uses the offset at the instant that guess produced, which
 * is what makes the two DST Sundays a year land on the right side of the change.
 */
function instantOf(w: Wall, tz: string): Date {
  const naive = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s)
  let ts = naive - offsetAt(new Date(naive), tz)
  ts = naive - offsetAt(new Date(ts), tz)
  return new Date(ts)
}

/** `2026-09-07` in `tz` — the only key any day comparison here uses. */
export function dayKey(at: Date | string, tz: string = WARSAW): string {
  const w = wallOf(typeof at === 'string' ? new Date(at) : at, tz)
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`
}

/** 0 = Monday, so a week can be sliced with subtraction. */
function isoDow(w: Wall): number {
  return (new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay() + 6) % 7
}

function addDays(w: Wall, n: number): Wall {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: w.h, mi: w.mi, s: w.s }
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

export type Week = { from: Date; to: Date; mondayLabel: string }

/**
 * Monday 00:00 of the current Warsaw week through Sunday 23:59:59 of the
 * FOLLOWING one — fourteen days, not seven (D1).
 *
 * The seven-day form was the spec, and it was measured wrong on the first
 * Sunday it met: at 23:40 on a Sunday night a strict Mon-Sun window holds only
 * calls that have already happened, so the section he opens on the way into
 * Monday would have been empty. The extra week costs one row group and removes
 * the one evening a week where the surface lies about having nothing on it.
 */
export function weekWindow(now: Date, tz: string = WARSAW): Week {
  const w = wallOf(now, tz)
  const monday = addDays({ ...w, h: 0, mi: 0, s: 0 }, -isoDow(w))
  const from = instantOf(monday, tz)
  const to = instantOf({ ...addDays(monday, 13), h: 23, mi: 59, s: 59 }, tz)
  const mondayLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' })
    .format(from)
  return { from, to, mondayLabel }
}

// ---------------------------------------------------------------------------
// The grouping
// ---------------------------------------------------------------------------

export type Grouped<E> = { today: E[]; later: E[]; next: E[]; earlier: E[] }

/**
 * Four groups by WARSAW calendar day: what is happening today, what is still
 * ahead inside this week, what next week holds, and what already happened.
 *
 * `earlier` runs newest first — the call he wants the report from is almost
 * always the last one, not the first. Everything else runs forward, because
 * every other group is a queue.
 */
export function groupEvents<E extends { start_time: string }>(
  events: E[], now: Date, tz: string = WARSAW,
): Grouped<E> {
  const today = dayKey(now, tz)
  const w = wallOf(now, tz)
  // Midday on the Sunday, so the two DST changes cannot move the boundary day.
  const sunday = dayKey(instantOf(addDays({ ...w, h: 12, mi: 0, s: 0 }, 6 - isoDow(w)), tz), tz)
  const out: Grouped<E> = { today: [], later: [], next: [], earlier: [] }
  for (const e of events) {
    const k = dayKey(e.start_time, tz)
    if (k === today) out.today.push(e)
    else if (k < today) out.earlier.push(e)
    else if (k <= sunday) out.later.push(e)
    else out.next.push(e)
  }
  const asc = (a: E, b: E) => a.start_time.localeCompare(b.start_time)
  out.today.sort(asc); out.later.sort(asc); out.next.sort(asc)
  out.earlier.sort((a, b) => b.start_time.localeCompare(a.start_time))
  return out
}

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

/** Lowercase, and nothing left but letters and digits. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function tokensOf(slug: string): string[] {
  return slug.split('-').map(norm).filter(Boolean)
}

function localPart(email: string): string {
  return email.split('@')[0] ?? ''
}

function domainOf(email: string): string {
  return email.split('@')[1] ?? ''
}

type Hit = { slug: string; token: string; domain: string | null }

function resolve(hits: Hit[], meta: Record<string, PackMeta>): string | null {
  if (hits.length === 0) return null
  if (hits.length === 1) return hits[0].slug
  // Two packs answering to one call is the failure this whole function exists to
  // avoid, so the tie breaks on the strongest evidence available: a domain the
  // pack itself states. Only then on the longer token.
  const byDomain = hits.find(h => {
    const stated = meta[h.slug]?.domain
    return Boolean(stated && h.domain && norm(stated) === h.domain)
  })
  if (byDomain) return byDomain.slug
  return hits.slice().sort((a, b) => b.token.length - a.token.length)[0].slug
}

/**
 * Which pack belongs to this call, or null.
 *
 * Three rules, in this order, and the FIRST rule that produces any hit decides,
 * so a weaker rule never overrules a stronger one:
 *
 *   a. the pack states this event's id. Nothing beats being told.
 *   b. an attendee's local part or domain, stripped to letters and digits,
 *      contains a slug token of four characters or more. This is the rule that
 *      survives a booking tool truncating the display name in the title, and the
 *      rule that sees through a hyphen in a company domain.
 *   c. the event title contains a slug token of three or more.
 *
 * Four characters on the address and three on the title is not symmetry for its
 * own sake: an address is a machine string where a short accidental substring is
 * cheap, and a title is prose a person typed.
 */
export function matchPack(
  event: WeekEvent,
  slugs: string[],
  meta: Record<string, PackMeta>,
  ids?: Record<string, string>,
): string | null {
  if (ids) {
    for (const slug of slugs) if (ids[slug] && ids[slug] === event.id) return slug
  }

  const addresses = (event.attendees ?? []).filter(Boolean)
  const byAddress: Hit[] = []
  for (const slug of slugs) {
    for (const token of tokensOf(slug)) {
      if (token.length < 4) continue
      const hit = addresses.find(a => norm(localPart(a)).includes(token) || norm(domainOf(a)).includes(token))
      if (hit) { byAddress.push({ slug, token, domain: norm(domainOf(hit)) }); break }
    }
  }
  if (byAddress.length) return resolve(byAddress, meta)

  const title = norm(event.title ?? '')
  const byTitle: Hit[] = []
  for (const slug of slugs) {
    for (const token of tokensOf(slug)) {
      if (token.length < 3) continue
      if (title.includes(token)) { byTitle.push({ slug, token, domain: null }); break }
    }
  }
  return resolve(byTitle, meta)
}

// ---------------------------------------------------------------------------
// The times line
// ---------------------------------------------------------------------------

export type Times = { warsaw: string; utc: string; rel: string; soon: boolean; past: boolean }

const clockFmt = (tz: string, weekday: boolean) => new Intl.DateTimeFormat('en-US', {
  timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  ...(weekday ? { weekday: 'short' as const } : {}),
})

function span(ms: number): string {
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const mi = Math.floor((ms % 3_600_000) / 60_000)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return mi > 0 ? `${h}h ${mi}m` : `${h}h`
  return `${mi}m`
}

/**
 * "Tue 20:30" where he is, "18:30 UTC" where the calendar wrote it, and how
 * long he has. Both zones, always: plenty of these calls are booked by someone
 * who quoted UTC, and a lone local time is the one that gets read as the other.
 *
 * `soon` is `isStartingSoon` from nextCall.ts, not a second threshold. Today's
 * meetings strip and this row must not disagree about what "about to start"
 * means.
 */
export function describeTimes(startIso: string, now: Date = new Date(), tz: string = WARSAW): Times {
  const start = new Date(startIso)
  const soonMs = start.getTime() - now.getTime()
  const when: When = { day: '', today: false, time: '', endTime: null, soonMs }
  const abs = Math.abs(soonMs)
  const rel = abs < 60_000 ? 'now' : soonMs > 0 ? `in ${span(abs)}` : `${span(abs)} ago`
  return {
    warsaw: clockFmt(tz, true).format(start).replace(',', ''),
    utc: `${clockFmt('UTC', false).format(start)} UTC`,
    rel,
    soon: isStartingSoon(when),
    past: soonMs <= 0,
  }
}
