// Home's queue: one ordered list of what needs the owner, in money order.
// Pure: plain data in, plain data out. The clock comes in as `now`; every
// day and time is Warsaw's (Ivan's clock), from Intl parts in ui/time.
import { dHash } from '../../route'
import { SEATS, SEAT_NAME, type Seat } from '../../seats'
import { warsawDay, warsawDayTime, warsawHm } from '../../ui/time'

export type QueueItem = { key: string; label: string; meta?: string; href: string; warn?: boolean }
export type QueueSection = { id: 'replies' | 'bookings' | 'call' | 'today'; title: string; count: number; items: QueueItem[] }
/** `waiting` is keyed by Seat id (ivan, risedtc, arch, swishdm, anna); a post's `id` is its draft id (NextPost.draft_id). */
export type QueueInput = { waiting: Record<string, number | null>; bookings: { id: string; who: string; when: string }[]; nextCall: { title: string; start: string } | null; posts: { id: string; slot_at: string; post_text: string; state: string }[]; now: Date }

const HOUR = 3_600_000
const LABEL_MAX = 80

// Anna has no DMs seat of her own: her replies live in her Lanes column, the
// address Home's stand-alone Anna link used (Ruling R5).
const repliesHref = (seat: Seat) => seat === 'anna' ? dHash('lanes', null, { seat }) : dHash('dms', null, { seat })

function replies(waiting: QueueInput['waiting']): QueueSection | null {
  const items: QueueItem[] = []
  let count = 0
  for (const seat of SEATS) {
    const n = waiting[seat]
    // null = the read failed: left out, never shown as 0.
    if (typeof n !== 'number' || !(n > 0)) continue
    count += n
    items.push({ key: seat, label: SEAT_NAME[seat], meta: `${n} waiting`, href: repliesHref(seat) })
  }
  return items.length ? { id: 'replies', title: 'Replies waiting', count, items } : null
}

function bookings(rows: QueueInput['bookings']): QueueSection | null {
  if (!rows.length) return null
  const items = rows.map(r => ({ key: r.id, label: r.who, meta: r.when, href: dHash('ops', null, { card: r.id }) }))
  return { id: 'bookings', title: 'Bookings to confirm', count: items.length, items }
}

function call(next: QueueInput['nextCall'], now: Date): QueueSection | null {
  if (!next) return null
  const t = Date.parse(next.start)
  if (!Number.isFinite(t)) return null
  const ahead = t - now.getTime()
  if (ahead > 24 * HOUR) return null
  const item = { key: 'call', label: next.title, meta: warsawDayTime(t), href: dHash('sales'), warn: ahead <= HOUR }
  return { id: 'call', title: 'Next call', count: 1, items: [item] }
}

const firstLine = (text: string) => {
  const line = (text.split('\n').find(l => l.trim() !== '') ?? '').trim()
  return Array.from(line).slice(0, LABEL_MAX).join('')
}

function today(posts: QueueInput['posts'], now: Date): QueueSection | null {
  const day = warsawDay(now)
  const items = posts
    .map(p => ({ p, t: Date.parse(p.slot_at) }))
    .filter(({ t }) => Number.isFinite(t) && warsawDay(t) === day)
    .sort((a, b) => a.t - b.t)
    // Content's own landing opens a single post this way (Review, focused on the draft).
    .map(({ p, t }) => ({ key: p.id, label: firstLine(p.post_text), meta: `${warsawHm(t)} · ${p.state}`, href: dHash('content', 'now', { focus: p.id }) }))
  return items.length ? { id: 'today', title: 'Going out today', count: items.length, items } : null
}

export function buildQueue(i: QueueInput): QueueSection[] {
  return [replies(i.waiting), bookings(i.bookings), call(i.nextCall, i.now), today(i.posts, i.now)]
    .filter((s): s is QueueSection => s !== null)
}
