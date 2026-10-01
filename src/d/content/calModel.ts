// D · Content > Calendar, the pure half. Every dated post of the seats on
// show, keyed by Warsaw day, each carrying what the grid draws (a real
// thumbnail or nothing, the hook's first line, a status dot, lead-magnet or
// not) and, for a post that must not move, the reason it says when lifted.
// Built on planModel (today's calendar builder), so the calendar shows every
// kind of post the planner did.
import { taxonomyValue, type ContentDraft } from '../../lib/content'
import { LANES, imgOf, titleOf, type Lane } from './model'
import { cellOrder, type PlanItem } from './planModel'

export type Pick = 'all' | Lane
export const PICKS: readonly Pick[] = ['all', ...LANES]
export const isPick = (s: string | null | undefined): s is Pick => s === 'all' || s === 'ivan' || s === 'risedtc' || s === 'arch'
export const lanesOf = (p: Pick): Lane[] => (p === 'all' ? [...LANES] : [p])
/** The calendar's client switch, remembered on this device. */
export const PICK_KEY = 'd-cal-pick'
export function savedPick(): Pick {
  let v: string | null = null
  try { v = localStorage.getItem(PICK_KEY) } catch { /* private mode */ }
  return isPick(v) ? v : 'all'
}

export type Dot = 'posted' | 'set' | 'planned' | 'review' | 'stuck' | 'queue'
export const DOT_WORD: Record<Dot, string> = {
  posted: 'Posted', set: 'Set to publish', planned: 'Dated, not set to publish', review: 'In review', stuck: 'Did not go out', queue: 'Publish queue only',
}

export type Entry = {
  it: PlanItem
  lane: Lane
  r: ContentDraft | null
  thumb: string | null
  hook: string
  lm: boolean
  dot: Dot
  /** Why it cannot be moved, or null when it can. */
  refuse: string | null
}

/** A lead-magnet post: the LM stager tags taxonomy.source/lead_magnet_id; ARCH's hand-made ones say it in the label. */
export function isMagnetPost(r: Pick2<ContentDraft, 'taxonomy' | 'source_label'> | null): boolean {
  if (!r) return false
  return taxonomyValue(r.taxonomy, 'source') === 'lead-magnet' || !!taxonomyValue(r.taxonomy, 'lead_magnet_id') || /lead magnet/i.test(r.source_label ?? '')
}
type Pick2<T, K extends keyof T> = { [P in K]?: T[P] }

/** The hook: the body's first non-empty line, else the title. */
export function hookOf(r: ContentDraft | null, fallback: string): string {
  const line = (r?.post_body ?? '').split('\n').map(s => s.trim()).find(Boolean)
  return (line || (r ? titleOf(r) : fallback)).replace(/\s+/g, ' ').slice(0, 140)
}

export function dotOf(it: PlanItem): Dot {
  if (it.stage === 'published') return 'posted'
  if (it.stage === 'stuck') return 'stuck'
  if (it.source === 'queue') return 'queue'
  if (it.arming === 'planned') return 'planned'
  if (it.arming === 'armed') return 'set'
  return 'review'
}

export function refuseOf(it: PlanItem, r: ContentDraft | null): string | null {
  if (it.stage === 'published') return 'Already posted. It stays on the day it went out.'
  if (it.source === 'queue' || !r) return 'This one lives only in the publish queue, so it can’t move here.'
  if (!it.movable) return `This post is ${r.status}. Only posts in review or scheduled can move.`
  return null
}

export function entryOf(it: PlanItem, rows: ContentDraft[]): Entry {
  const r = it.source === 'draft' ? rows.find(x => x.id === it.id) ?? null : null
  return { it, lane: it.lane, r, thumb: r ? imgOf(r.image_urls, 400) : null, hook: hookOf(r, it.title), lm: isMagnetPost(r), dot: dotOf(it), refuse: refuseOf(it, r) }
}

/**
 * Every entry of the picked seats keyed by day, first-out first. `moved`
 * holds the optimistic days of posts just dropped, until the re-read lands.
 */
export function calendarDays(
  items: Record<Lane, Map<string, PlanItem[]>>, rows: Record<Lane, ContentDraft[]>, pick: Pick, moved: Map<string, string>,
): Map<string, Entry[]> {
  const out = new Map<string, Entry[]>()
  for (const lane of lanesOf(pick)) {
    for (const list of items[lane].values()) {
      for (const it of list) {
        const day = moved.get(it.id) ?? it.day
        const e = entryOf(day === it.day ? it : { ...it, day }, rows[lane])
        const a = out.get(day)
        if (a) a.push(e); else out.set(day, [e])
      }
    }
  }
  for (const [k, list] of out) {
    const order = cellOrder(list.map(e => e.it))
    out.set(k, order.map(it => list.find(e => e.it === it)!))
  }
  return out
}

/** Undated drafts that can take a date, newest first, across the picked seats. */
export type Loose = { id: string; lane: Lane; hook: string; thumb: string | null; lm: boolean; createdAt: string }
export function looseOf(rows: Record<Lane, ContentDraft[]>, pick: Pick, moved: Map<string, string>): Loose[] {
  const out: Loose[] = []
  for (const lane of lanesOf(pick)) {
    for (const r of rows[lane]) {
      if (r.scheduled_at || moved.has(r.id) || (r.status !== 'review' && r.status !== 'scheduled')) continue
      out.push({ id: r.id, lane, hook: hookOf(r, titleOf(r)), thumb: imgOf(r.image_urls, 400), lm: isMagnetPost(r), createdAt: r.created_at })
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Lead magnets waiting for a look (lm_drafts_v2), per seat; they have no date of their own. */
export type Magnet = { id: string; lane: Lane; title: string; cover: string | null; status: string }
export function magnetLane(clientId: string | null): Lane | null {
  const k = clientId == null ? 'ivan' : clientId === 'rise' ? 'risedtc' : clientId
  return k === 'ivan' || k === 'risedtc' || k === 'arch' ? k : null
}
export function coverOf(cover: string | null, covers: unknown): string | null {
  if (cover) return cover
  const list = Array.isArray(covers) ? covers : covers && typeof covers === 'object' ? Object.values(covers as Record<string, unknown>) : []
  for (const c of list) {
    if (typeof c === 'string' && /^https?:/.test(c)) return c
    if (c && typeof c === 'object' && typeof (c as { url?: unknown }).url === 'string') return (c as { url: string }).url
  }
  return null
}

/** Month and the two-week lines page by a signed offset from today. */
export function monthOf(now: number, off: number): { year: number; month: number } {
  const d = new Date(now)
  const x = new Date(d.getFullYear(), d.getMonth() + off, 1)
  return { year: x.getFullYear(), month: x.getMonth() }
}

/** The day a page opens on: today in this month, else the first day with a post, else the 1st. */
export function openDay(keys: string[], inMonth: Set<string>, days: Map<string, Entry[]>, todayKey: string): string {
  if (inMonth.has(todayKey)) return todayKey
  return keys.find(k => inMonth.has(k) && (days.get(k)?.length ?? 0) > 0) ?? keys.find(k => inMonth.has(k)) ?? keys[0]
}
