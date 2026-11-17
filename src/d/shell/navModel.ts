import { contentNumbers, dmNumbers, opsNumbers, seatFailed, useFrameCounts, type FrameCounts } from '../counts/useFrameCounts'
import { PLACES, PLACE_ORDER, type PlaceId } from '../places'
import type { Seat, SeatNumbers } from '../seats'
import { useReportedFailures } from './health'
import { useXWaiting } from '../x/useXReview'

// What the left panel, the phone drawer and the dock draw for each place:
// its per-seat line (never a total), and how many of its reads failed.
export type NavLine =
  | { kind: 'seats'; label: string; numbers: SeatNumbers; failed: Record<Seat, boolean>
      /** A second number shown with the first where there is room (DMs: "N drafted"). */
      second?: { label: string; numbers: SeatNumbers } }
  | { kind: 'text'; label: string; text: string }

export type NavItem = {
  id: PlaceId; label: string; line: NavLine | null; failed: number
}

const allFailed = (b: boolean): Record<Seat, boolean> => ({ ivan: b, risedtc: b, arch: b , swishdm: b, anna: b})
const nFailed = (r: Record<Seat, boolean>) => Object.values(r).filter(Boolean).length

/** The X review's count as a nav input: Ivan's items waiting (null until read), and a failed read. */
export type XCount = { n: number | null; failed: boolean }

/**
 * Content's number with X in it (X is a Content tab, daily-brief-trim Task 6.1): review drafts plus X posts
 * waiting, so a waiting X post is never invisible. X is Ivan's lane only, so it rides his seat. While the X
 * read is loading or has failed, the review count stands alone: X never blanks or fails Content's number.
 */
export function contentWithX(n: SeatNumbers, x: XCount): SeatNumbers {
  return { ...n, ivan: n.ivan == null ? null : n.ivan + (x.n ?? 0) }
}

export function navLines(c: FrameCounts, x: XCount = { n: null, failed: false }): Partial<Record<PlaceId, { line: NavLine; failed: number }>> {
  const dmsF = seatFailed(c.dms)
  const contentF = seatFailed(c.content)
  return {
    // Today's DMs number: threads with an unanswered reply or a draft to approve, per seat. The same
    // number and words as Home's "DMs waiting" tile (#36); the drafts count rides as the second line.
    dms: { line: { kind: 'seats', label: 'DMs waiting', numbers: dmNumbers(c, 'needs'), failed: dmsF, second: { label: 'drafted', numbers: dmNumbers(c, 'drafts') } }, failed: nFailed(dmsF) },
    content: { line: { kind: 'seats', label: 'Waiting on you', numbers: contentWithX(contentNumbers(c), x), failed: contentF }, failed: nFailed(contentF) },
    ops: { line: { kind: 'seats', label: 'Waiting on you', numbers: opsNumbers(c), failed: allFailed(c.ops.failed) }, failed: c.ops.failed ? 1 : 0 },
    sales: {
      line: { kind: 'text', label: 'Next call', text: c.nextCall.value ? c.nextCall.value.label.replace(/^(\w{3}) \d{1,2} \w{3}, /, '$1 ') : (c.nextCall.failed ? '?' : '…') },
      failed: c.nextCall.failed ? 1 : 0,
    },
  }
}

/** The newest successful read of any frame count (the offline line's "read at"). */
export function lastSynced(c: FrameCounts): number | null {
  const ats = [
    ...Object.values(c.dms).map(s => s.at), ...Object.values(c.content).map(s => s.at),
    c.ops.at, c.nextCall.at, c.bell.at, c.alerts.at, c.health.at, c.magnets.at, c.calls.at,
  ].filter((x): x is number => x != null)
  return ats.length ? Math.max(...ats) : null
}

export function useNavModel(): { items: NavItem[]; synced: number | null } {
  const c = useFrameCounts()
  const reported = useReportedFailures()
  const x = useXWaiting()
  const lines = navLines(c, x)
  const items = PLACE_ORDER.map<NavItem>(id => ({
    id,
    label: PLACES[id].label,
    line: lines[id]?.line ?? null,
    failed: (lines[id]?.failed ?? 0) + (reported[id] ?? 0),
  }))
  return { items, synced: lastSynced(c) }
}
