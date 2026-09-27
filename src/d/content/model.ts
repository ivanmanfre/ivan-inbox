// D · Content read model. Pure: rows in, what the page draws out. Every rule
// here is today's (lib/content, calendarItems, moveConfirm); this file only
// arranges them into the wall, the queue and the headline.
//
// COUNTING RULE (ratified 26 Sep): scheduled = on the board and unpublished
// and dated, even while a client row is still in review; Ivan's feed = status
// scheduled, unpublished, dated. Posts, not days. Seats are never summed.
import {
  clientScheduleArmed, localDay, stageOfLane,
  type ContentDraft, type ContentLane,
} from '../../lib/content'
import { warsawDay, warsawDm, warsawDow, warsawHm } from '../ui/time'

export type Lane = ContentLane
export const LANES: readonly Lane[] = ['ivan', 'risedtc', 'arch']
export const LANE_NAME: Record<Lane, string> = { ivan: 'Ivan', risedtc: 'Rise', arch: 'Arch' }
export const OWNER: Record<Lane, string> = { ivan: '', risedtc: 'Mattan', arch: 'Davorin' }
export const POSS: Record<Lane, string> = { ivan: 'Your', risedtc: 'Mattan’s', arch: 'Davorin’s' }
export const FEED: Record<Lane, string> = { ivan: 'your feed', risedtc: 'Mattan’s board', arch: 'Davorin’s board' }
export const IDEA_OWNER: Record<Lane, string> = { ivan: 'yours', risedtc: 'Mattan’s', arch: 'Davorin’s' }

export const DAY_MS = 86_400_000
export const WAIT_DAYS = 14

export type WallDay = { key: string; dow: string; dm: string; n: number }

/** Is this row on the wall as a scheduled post (the counting rule)? */
export function isScheduled(r: ContentDraft, lane: Lane): boolean {
  if (lane !== 'ivan') return clientScheduleArmed(r)
  return r.status === 'scheduled' && !r.published_at && !!r.scheduled_at
}

/** An Ivan row that holds a date but nothing will publish it until it is armed. */
export function isPlanned(r: ContentDraft, lane: Lane): boolean {
  return lane === 'ivan' && !r.published_at && !!r.scheduled_at
    && (r.status === 'review' || r.status === 'approved')
}

/**
 * Ten weekdays, Warsaw days. On a weekday the wall opens on this week's
 * Monday; on a weekend it opens on the coming Monday (the mock's "Week of 28 Sep"
 * read on Sun 27 Sep).
 */
export function wallDays(now: number = Date.now()): WallDay[] {
  const noonUtc = (t: number) => { const x = new Date(t); x.setUTCHours(10, 0, 0, 0); return x.getTime() }
  let t = noonUtc(now)
  const dow = warsawDow(t)
  const back: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: -2, Sun: -1 }
  t -= (back[dow] ?? 0) * DAY_MS
  const out: WallDay[] = []
  for (let i = 0; out.length < 10 && i < 20; i++) {
    const x = t + i * DAY_MS
    const w = warsawDow(x)
    if (w === 'Sat' || w === 'Sun') continue
    out.push({ key: warsawDay(x), dow: w, dm: warsawDm(x), n: Number(warsawDm(x).split(' ')[0]) })
  }
  return out
}

/** "This week" when the wall opens on the current week, else "Next week". */
export function weekWord(now: number = Date.now()): 'This week' | 'Next week' {
  const w = warsawDow(now)
  return w === 'Sat' || w === 'Sun' ? 'Next week' : 'This week'
}

/** The post a seat has on a Warsaw day (scheduled first, then a planned Ivan row). */
export function postOn(rows: ContentDraft[], lane: Lane, key: string): ContentDraft | null {
  const on = rows.filter(r => r.scheduled_at && warsawDay(r.scheduled_at) === key)
  return on.find(r => isScheduled(r, lane)) ?? on.find(r => isPlanned(r, lane)) ?? null
}

export function scheduledIn(rows: ContentDraft[], lane: Lane, days: WallDay[]): number {
  const keys = new Set(days.map(d => d.key))
  return rows.filter(r => isScheduled(r, lane) && keys.has(warsawDay(r.scheduled_at as string))).length
}

/** Next scheduled post from now, for the seat plate. */
export function nextScheduled(rows: ContentDraft[], lane: Lane, now: number = Date.now()): ContentDraft | null {
  return rows.filter(r => isScheduled(r, lane) && Date.parse(r.scheduled_at as string) >= now)
    .sort((a, b) => Date.parse(a.scheduled_at as string) - Date.parse(b.scheduled_at as string))[0] ?? null
}

export function publishedCount(rows: ContentDraft[]): number {
  return rows.filter(r => r.status === 'published').length
}

/** Rise schedules on Pacific time: "07:00 PT" beside the Warsaw time. */
const PT = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
export function ptOf(iso: string): string { return `${PT.format(new Date(iso))} PT` }

/** "09:00" (Warsaw) or, on Rise, "16:00 7:00 PT" (Warsaw, then Pacific). */
export function timeLine(iso: string, lane: Lane): string {
  return lane === 'risedtc' ? `${warsawHm(iso)} ${ptOf(iso)}` : warsawHm(iso)
}

// ---------- the review queue ----------

/** Waiting on Ivan: status review, not on a client board (the frame's count). */
export function waitingRows(rows: ContentDraft[], now: number = Date.now()): { fresh: ContentDraft[]; older: ContentDraft[] } {
  const all = rows.filter(r => r.status === 'review' && r.board_visible !== true)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const cut = now - WAIT_DAYS * DAY_MS
  return { fresh: all.filter(r => Date.parse(r.created_at) > cut), older: all.filter(r => Date.parse(r.created_at) <= cut) }
}

export function errorRows(rows: ContentDraft[], lane: Lane, now: number = Date.now()): ContentDraft[] {
  return rows.filter(r => { const s = stageOfLane(r, lane, now); return s === 'error' || s === 'stuck' })
}

export function age(iso: string, now: number = Date.now()): string {
  const m = Math.max(0, (now - Date.parse(iso)) / 60_000)
  return m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

export function titleOf(r: Pick<ContentDraft, 'title' | 'topic' | 'post_body'>): string {
  const t = (r.title || r.topic || '').replace(/^Video: /, '').trim()
  if (t) return t
  const first = (r.post_body ?? '').split('\n').map(s => s.trim()).find(Boolean)
  return first || 'Untitled'
}

export function aimOf(r: Pick<ContentDraft, 'funnel_stage'>): string {
  const a = (r.funnel_stage ?? '').trim()
  return a ? a[0].toUpperCase() + a.slice(1) : ''
}

export function kindOf(type: string | null | undefined): string {
  return type === 'carousel' ? 'Carousel' : type === 'video' ? 'Video' : type === 'single_image' ? 'Image' : 'Text'
}

// ---------- the next free slot (Ivan) ----------

export const SLOT_H = 10
export const SLOT_M = 45
export const BUFFER_DAYS = 3

export type Slot = { at: Date; skipped: { day: string; why: 'weekend' | 'has a post' }[] }

/**
 * Today's nextFreeSlot (wb/draft/actions: 3 days out, 10:45 local, first day
 * the queue does not hold) plus the weekday guard operator_set_schedule_date
 * applies (coordinator ruling): Saturday and Sunday are skipped too.
 */
export function nextFreeWeekday(taken: Set<string>, now: number = Date.now()): Slot {
  const t = new Date(now)
  t.setHours(SLOT_H, SLOT_M, 0, 0)
  t.setDate(t.getDate() + BUFFER_DAYS)
  const skipped: Slot['skipped'] = []
  for (let i = 0; i < 366; i++) {
    const we = t.getDay() === 0 || t.getDay() === 6
    const has = taken.has(localDay(t))
    if (!we && !has) break
    skipped.push({ day: `${warsawDow(t)} ${warsawDm(t)}`, why: we ? 'weekend' : 'has a post' })
    t.setDate(t.getDate() + 1)
  }
  return { at: t, skipped }
}

// ---------- moving a post ----------

/**
 * Where a move to `key` lands: the day itself, or (the RPC's own bump) the next
 * weekday that holds no other post of this seat. Used for the sentence only;
 * the receipt always names the day the database stored.
 */
export function landingDay(key: string, takenKeys: Set<string>): string {
  let t = Date.parse(`${key}T10:00:00Z`)
  for (let i = 0; i < 60; i++) {
    const w = warsawDow(t)
    const k = warsawDay(t)
    if (w !== 'Sat' && w !== 'Sun' && !takenKeys.has(k)) return k
    t += DAY_MS
  }
  return key
}

/** Fourteen calendar days (weekends included) from the wall's first Monday. */
export function pickDays(first: string): { key: string; dow: string; n: number; weekend: boolean }[] {
  const t0 = Date.parse(`${first}T10:00:00Z`)
  return Array.from({ length: 14 }, (_, i) => {
    const t = t0 + i * DAY_MS
    const dow = warsawDow(t)
    return { key: warsawDay(t), dow, n: Number(warsawDm(t).split(' ')[0]), weekend: dow === 'Sat' || dow === 'Sun' }
  })
}

export function dayLabel(key: string): string {
  const t = Date.parse(`${key}T10:00:00Z`)
  return `${warsawDow(t)} ${warsawDm(t)}`
}

/** First image, Drive /view links turned into a thumbnail (same rule as today's window). */
export function imgOf(urls: unknown, size = 800): string | null {
  const u = Array.isArray(urls) ? urls.find(x => typeof x === 'string' && x) as string | undefined : undefined
  if (!u) return null
  const m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/)
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${size}` : u
}
