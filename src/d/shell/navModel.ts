import { contentNumbers, dmNumbers, opsNumbers, seatFailed, useFrameCounts, type FrameCounts } from '../counts/useFrameCounts'
import { PLACES, PLACE_ORDER, type PlaceId } from '../places'
import type { Seat, SeatNumbers } from '../seats'
import { useReportedFailures } from './health'

// What the left panel, the phone drawer and the dock draw for each place:
// its per-seat line (never a total), and how many of its reads failed.
export type NavLine =
  | { kind: 'seats'; label: string; numbers: SeatNumbers; failed: Record<Seat, boolean> }
  | { kind: 'text'; label: string; text: string }

export type NavItem = {
  id: PlaceId; label: string; line: NavLine | null; failed: number
  /** A second, smaller line (Content: the Magnets review count; Sales: calls today). */
  extra?: { label: string; text: string } | null
}

const allFailed = (b: boolean): Record<Seat, boolean> => ({ ivan: b, risedtc: b, arch: b })
const nFailed = (r: Record<Seat, boolean>) => Object.values(r).filter(Boolean).length

export function navLines(c: FrameCounts): Partial<Record<PlaceId, { line: NavLine; failed: number }>> {
  const dmsF = seatFailed(c.dms)
  const contentF = seatFailed(c.content)
  return {
    // Today's DMs number: threads with an unanswered reply or a draft to approve, per seat.
    dms: { line: { kind: 'seats', label: 'Waiting on you', numbers: dmNumbers(c, 'needs'), failed: dmsF }, failed: nFailed(dmsF) },
    content: { line: { kind: 'seats', label: 'Waiting on you', numbers: contentNumbers(c), failed: contentF }, failed: nFailed(contentF) },
    ops: { line: { kind: 'seats', label: 'Waiting on you', numbers: opsNumbers(c), failed: allFailed(c.ops.failed) }, failed: c.ops.failed ? 1 : 0 },
    sales: {
      line: { kind: 'text', label: 'Next call', text: c.nextCall.value?.label ?? (c.nextCall.failed ? 'could not read the calendar' : '…') },
      failed: c.nextCall.failed ? 1 : 0,
    },
  }
}

/** The newest successful read of any frame count, for "synced HH:MM". */
/** The second line under a place: Magnets at review (Content), calls today (Sales). */
export function navExtras(c: FrameCounts): Partial<Record<PlaceId, { label: string; text: string }>> {
  const n = (v: number | null, failed: boolean) => (v == null ? (failed ? 'could not read' : '…') : String(v))
  return {
    content: { label: 'Magnets at review', text: n(c.magnets.value, c.magnets.failed) },
    sales: { label: 'Calls today not started', text: n(c.calls.value, c.calls.failed) },
  }
}

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
  const lines = navLines(c)
  const extras = navExtras(c)
  const items = PLACE_ORDER.map<NavItem>(id => ({
    id,
    label: PLACES[id].label,
    line: lines[id]?.line ?? null,
    extra: extras[id] ?? null,
    failed: (lines[id]?.failed ?? 0) + (reported[id] ?? 0),
  }))
  return { items, synced: lastSynced(c) }
}
