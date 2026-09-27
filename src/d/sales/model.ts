// D Sales: the pure reading. Every rule is today's (wb/sales/match.ts:
// matchPack, groupEvents, describeTimes, callPhase, callEndMs, reportIdFor;
// lib/transcripts.ts for calls on record). Both clocks, always: Warsaw and UTC.
import { MEETING_TYPE_LABEL, resolveMeetingType } from '../../lib/nextCall'
import type { PackKind, PackMeta, SalesPack, WeekEvent } from '../../lib/salesPacks'
import type { CallRow } from '../../lib/transcripts'
import type { PackDoc } from '../../wb/sales/Doc'
import { callEndMs, callPhase, describeTimes, groupEvents, matchPack, reportIdFor } from '../../wb/sales/match'
import { warsawDm, warsawDow, warsawHm } from '../ui/time'

/** The pack links, left to right: document, label, the row kind it needs (null = always there). */
export const PACK_LINKS: Array<{ doc: PackDoc; label: string; kind: PackKind | null }> = [
  { doc: 'card', label: 'card', kind: 'card' },
  { doc: 'call_sheet', label: 'sheet', kind: 'call_sheet' },
  { doc: 'audience_audit', label: 'audit', kind: 'audience_audit' },
  { doc: 'asset_ideas', label: 'ideas', kind: 'asset_ideas' },
  { doc: 'prospect', label: 'prospect', kind: 'prospect' },
  { doc: 'compare', label: 'compare', kind: null },
]

export type PackIndex = { slugs: string[]; meta: Record<string, PackMeta>; have: Record<string, Set<string>>; at: Record<string, string> }

export function packIndex(rows: SalesPack[]): PackIndex {
  const meta: Record<string, PackMeta> = {}
  const have: Record<string, Set<string>> = {}
  const at: Record<string, string> = {}
  for (const r of rows) {
    const clean = Object.fromEntries(Object.entries(r.meta ?? {}).filter(([, v]) => v != null && v !== ''))
    meta[r.prospect_slug] = { ...meta[r.prospect_slug], ...clean }
    ;(have[r.prospect_slug] ??= new Set()).add(r.kind)
    const t = r.call_at ?? r.updated_at ?? ''
    if (t > (at[r.prospect_slug] ?? '')) at[r.prospect_slug] = t
  }
  return { slugs: Object.keys(meta), meta, have, at }
}

const UTC_HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const utcHm = (t: string | number | Date) => UTC_HM.format(new Date(t))

export type CallEvent = {
  ev: WeekEvent
  slug: string | null
  name: string
  company: string
  have: Set<string>
  phase: 'upcoming' | 'running' | 'done'
  past: boolean
  /** Join is lit: from an hour before the start until the call ends. */
  live: boolean
  day: string
  warsaw: string
  utc: string
  endWarsaw: string
  endUtc: string
  rel: string
  /** Who is on it when no pack names them (Ivan's own address dropped). */
  with: string
  /** Everyone on the invite but Ivan (today's Today WITH line). */
  withAll: string
  /** Today's TYPE: Discovery / Technical audit / Client kickoff / Internal, '' when unknown. */
  type: string
  /** Today's SOURCE: "via Calendly", '' when the row has none. */
  source: string
  reportId: string | null
}

export function readEvent(ev: WeekEvent, group: string, idx: PackIndex, calls: CallRow[], now: Date): CallEvent {
  const slug = matchPack(ev, idx.slugs, idx.meta)
  const m: PackMeta = slug ? idx.meta[slug] ?? {} : {}
  const t = describeTimes(ev.start_time, now)
  const phase = callPhase(ev, now)
  const past = group === 'earlier' || phase === 'done'
  const end = callEndMs(ev)
  return {
    ev, slug,
    name: slug && m.name ? m.name : ev.title || 'Untitled',
    company: slug && m.name ? m.company ?? '' : '',
    have: slug ? idx.have[slug] ?? new Set() : new Set(),
    phase, past,
    live: !past && (t.soon || phase === 'running') && Boolean(ev.meeting_url),
    day: `${warsawDow(ev.start_time)} ${warsawDm(ev.start_time)}`,
    warsaw: warsawHm(ev.start_time), utc: utcHm(ev.start_time),
    endWarsaw: warsawHm(end), endUtc: utcHm(end),
    rel: past ? 'done' : phase === 'running' ? 'on now' : t.rel,
    with: slug ? '' : (ev.attendees ?? []).filter(a => !/ivanmanfred/i.test(a)).slice(0, 2).join(', '),
    withAll: (ev.attendees ?? []).filter(a => !/ivanmanfred/i.test(a)).join(', '),
    type: typeOf(ev),
    source: ev.source ? `via ${ev.source.charAt(0).toUpperCase()}${ev.source.slice(1)}` : '',
    reportId: past ? reportIdFor(ev, slug, calls) : null,
  }
}

export type Fortnight = { today: CallEvent[]; later: CallEvent[]; next: CallEvent[]; earlier: CallEvent[] }

export function readFortnight(events: WeekEvent[], idx: PackIndex, calls: CallRow[], now: Date): Fortnight {
  const g = groupEvents(events, now)
  const map = (k: keyof Fortnight) => g[k].map(e => readEvent(e, k, idx, calls, now))
  return { today: map('today'), later: map('later'), next: map('next'), earlier: map('earlier') }
}

/** The call the plate is about: running first, else the next one still to come. */
export function nextCall(f: Fortnight): CallEvent | null {
  return [...f.today, ...f.later, ...f.next].find(r => !r.past) ?? null
}

/** Today's "THIS WEEK N more calls": calls still to come this week after the plate's one. */
export function moreThisWeek(f: Fortnight, r: CallEvent | null): number {
  return [...f.today, ...f.later].filter(x => !x.past && x !== r).length
}

function typeOf(ev: WeekEvent): string {
  const t = ev.title ? resolveMeetingType({ meeting_type: ev.meeting_type, title: ev.title }) : null
  return t ? MEETING_TYPE_LABEL[t] : ''
}

/** Warsaw label for "no calls booked through Sun 4 Oct". */
export function throughLabel(to: Date): string {
  return `${warsawDow(to)} ${warsawDm(to)}`
}

export function meetingKind(url: string | null): string {
  if (!url) return ''
  if (/meet\.google/.test(url)) return 'Google Meet'
  if (/zoom\./.test(url)) return 'Zoom'
  if (/teams\.microsoft/.test(url)) return 'Teams'
  return 'meeting link'
}
