import { useCallback, useSyncExternalStore } from 'react'
import { approveReviewDraft, setBoardVisible } from '../../lib/content'
import { setVerdict } from '../../lib/verdicts'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { HOLD_MS, holdDecision, undoDecision } from './decisions'
import { OWNER, POSS, armedReceipt, isPastSchedule, nextSpacedSlot, type Lane, type Slot, type SlotHm } from './model'
import { zonedToUtc } from './laneTime'
import type { WeekCard } from './weekModel'
import { scheduleGuarded } from './writes'
import { judge, shownForMs } from './verdictStore'
import { warsawDm, warsawDow, warsawHm } from '../ui/time'

/** "Tue 10 Nov · 10:45": the time the one-tap key names. */
export const slotWords = (at: Date) => `${warsawDow(at)} ${warsawDm(at)} · ${warsawHm(at)}`

/** Approve, then schedule at `at`: the one write behind "Approve + schedule". A brain draft still to judge approves
 *  through its verdict (cb39_verdict_set keep, which approves on Ivan's seat), any other review draft through
 *  approveDraft. Returns the scheduled_at the row now holds. Throws ApprovedNotScheduled when only the first half
 *  landed. */
export class ApprovedNotScheduled extends Error {}
export async function approveThenSchedule(id: string, viaVerdict: boolean, at: Date): Promise<string | null> {
  if (viaVerdict) await setVerdict(id, 'keep', { msToVerdict: shownForMs(id) })
  else await approveReviewDraft(id)
  try { return await scheduleGuarded(id, at.toISOString()) }
  catch (e) { throw new ApprovedNotScheduled(e instanceof Error ? e.message : 'Could not schedule it.') }
}

// RESERVED SLOTS (cross-review 2026-11-06): a held "Approve + schedule" keeps its time taken until the write lands
// and the next read shows it, so the next card (or the Plan's next gap) never offers the same slot. Released on
// Undo or failure; kept 30 s after the write so the re-read has time to carry the real date.
export type Reserved = { at: string; poland: boolean }
const reserved = new Map<string, Reserved>()
let reservedSnap: ReadonlyMap<string, Reserved> = new Map()
const reservedSubs = new Set<() => void>()
const reservedPublish = () => { reservedSnap = new Map(reserved); for (const l of reservedSubs) l() }
export function reserveSlot(id: string, r: Reserved): void { reserved.set(id, r); reservedPublish() }
export function releaseSlot(id: string): void { if (reserved.delete(id)) reservedPublish() }
export function useReservedSlots(): ReadonlyMap<string, Reserved> {
  return useSyncExternalStore(l => { reservedSubs.add(l); return () => { reservedSubs.delete(l) } }, () => reservedSnap, () => reservedSnap)
}
/** Tests only. */
export function resetReservedForTest(): void { reserved.clear(); reservedPublish() }

/** The one-tap key's slot: the seat's next free spaced weekday at its own time, never a slot a held tap reserved.
 *  Always Warsaw-built (cross-review r2). Without the dated instants (an older read, or a failed one) each armed day
 *  stands in as its 10:45 Warsaw slot, the instant fetchIvanArmedDays tested it against. Null until the armed read
 *  has answered or failed. Shared by the Review desk and the day's post card. */
export function oneTapSlot(armed: ReadonlySet<string> | null, armedFailed: boolean, heldAts: readonly string[], now: number, hm: SlotHm): Slot | null {
  if (!armed && !armedFailed) return null
  const times = (armed as { times?: readonly string[] } | null)?.times
  const dayBusy = times ? [] : [...(armed ?? [])].map(d => zonedToUtc(d, '10:45', 'Europe/Warsaw'))
  return nextSpacedSlot([...(times ?? []), ...dayBusy, ...heldAts], now, hm)
}

// APPROVE + SCHEDULE, ONE TAP (review 2026-11-06 #15 and #31; Ivan's seat only, client seats keep their board flow).
// The key names the time, so the tap is the decision: no confirm sheet (only a QA-refused draft asks first). It is
// held for the same 8 s Undo as Approve (decisions.ts), then approves and schedules in one go; Undo inside the
// window writes nothing. Used by the Review desk row and the Poland gap card on Plan > Weeks.
export function useApproveSchedule(onChanged: () => void) {
  const toast = useToast()
  const confirm = useDConfirm()
  return useCallback(async (d: {
    id: string; status: string; viaVerdict: boolean; poland?: boolean
    /** The held write in place of approveThenSchedule (the day's card: one database call that checks, approves,
     *  schedules and marks the card in one transaction). Returns the scheduled_at the row holds. */
    write?: () => Promise<string | null>
  }, at: Date): Promise<boolean> => {
    if (isPastSchedule(at.toISOString())) { toast.show({ tone: 'failed', message: 'That time has already passed. Pick a later time.' }); return false }
    if (d.status === 'error') {
      const ok = await confirm({
        title: 'Approve this draft anyway?',
        message: `QA refused this one. Approving overrides that verdict, and it posts on LinkedIn ${slotWords(at)}.`,
        confirmText: 'Approve and schedule', verb: 'confirm',
      })
      if (!ok) return false
    }
    const id = d.id
    let stored: string | null = null
    reserveSlot(id, { at: at.toISOString(), poland: !!d.poland })
    holdDecision(id, 'approve', {
      write: async () => { stored = d.write ? await d.write() : await approveThenSchedule(id, d.viaVerdict, at) },
      onCommitted: () => { toast.show(armedReceipt(at, stored)); onChanged(); setTimeout(() => releaseSlot(id), 30_000) },
      onFailed: e => {
        releaseSlot(id)
        const msg = e instanceof Error ? e.message : 'That did not go through.'
        toast.show(e instanceof ApprovedNotScheduled
          ? { tone: 'failed', message: `Approved, not scheduled: ${msg}`, sub: 'It waits under Approved for a date.' }
          : { tone: 'failed', message: msg, sub: 'It is back in review.' })
        onChanged()
      },
    })
    toast.show({
      id: `decide-${id}`, ms: HOLD_MS, message: `Approved. Posts ${slotWords(at)}.`, sub: 'It goes out on LinkedIn then.',
      action: { label: 'Undo', verb: 'undo-decision', run: () => { if (undoDecision(id)) releaseSlot(id); else toast.show({ message: 'Too late to undo: it was already written.' }) } },
    })
    return true
  }, [confirm, onChanged, toast])
}

// THE REVIEW KEYS' WRITES, shared by today's stack (WeekStack) and the Brief 4
// review desk (v2/ReviewDesk). Lifted out of WeekStack unchanged so both trees
// call the same functions with the same confirms, toasts and Undo: Approve
// (held 8 s, decisions.ts), Put on board (confirmed, Undo), Schedule
// (confirmed, scheduleGuarded) and the brain verdict (held 5 s, verdictStore;
// the QA override asks first).
export function useWeekVerbs({ ids, onChanged, onOpen, setBusy }: {
  /** The cards in reading order (the auto-advance walks them). */
  ids: string[]
  onChanged: () => void
  onOpen: (id: string, lane: Lane) => void
  setBusy: (id: string | null) => void
}) {
  const toast = useToast()
  const confirm = useDConfirm()

  // Auto-advance: the next card's key takes the focus (and comes into view) once this one has moved on.
  const advance = useCallback((id: string) => {
    const i = ids.indexOf(id)
    const next = i >= 0 ? ids.slice(i + 1).find(x => x !== id) : null
    if (!next) return
    requestAnimationFrame(() => {
      const at = document.querySelector<HTMLElement>(`[data-card-id="${next}"]`)
      // Approve is the safe key of the pair (it never publishes), so it takes the focus on a card to judge.
      const el = at?.querySelector<HTMLElement>('.cn-wc-key-d, [data-key-safe]') ?? at?.querySelector<HTMLElement>('.cn-wc-key, [data-key-main]')
      if (!el) return
      el.focus({ preventScroll: true })
      el.closest('article')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    })
  }, [ids])

  const approve = useCallback((c: WeekCard) => {
    const id = c.r.id
    holdDecision(id, 'approve', {
      onCommitted: onChanged,
      onFailed: e => { toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'The approve did not go through.', sub: 'It is back in review.' }); onChanged() },
    })
    toast.show({
      id: `decide-${id}`, ms: HOLD_MS, message: 'Approved.', sub: c.r.scheduled_at ? 'Nothing publishes until it is scheduled.' : 'Nothing publishes: it has no date yet.',
      action: { label: 'Undo', verb: 'undo-decision', run: () => { if (!undoDecision(id)) toast.show({ message: 'Too late to undo: it was already written.' }) } },
    })
    advance(id)
  }, [advance, onChanged, toast])

  const oneTap = useApproveSchedule(onChanged)
  const approveSchedule = useCallback(async (c: WeekCard, at: Date) => {
    if (c.lane !== 'ivan') return
    if (await oneTap({ id: c.r.id, status: c.r.status, viaVerdict: c.judge }, at)) advance(c.r.id)
  }, [advance, oneTap])

  const board = useCallback(async (c: WeekCard) => {
    const lane = c.lane
    const ok = await confirm({
      title: `Put this on ${POSS[lane]} board?`,
      message: lane === 'swishdm' ? 'Jonathan sees this finished draft in his buffer for review. Nothing is scheduled or published.' : `${OWNER[lane]} sees it. This reaches a client: it fires his board’s own sync, so it lands within moments. `
        + 'From there the decisions are his: approve, edit, veto, schedule. Nothing publishes, this writes board visibility only.',
      confirmText: 'Put it on his board', verb: 'confirm',
    })
    if (!ok) return
    setBusy(c.r.id)
    try {
      await setBoardVisible(c.r.id, true, ...(c.r.client_id === 'swishdm' ? [c.r] as const : []))
      toast.show({
        message: `On ${POSS[lane]} board.`, sub: `${OWNER[lane]} decides from there.`,
        action: lane === 'swishdm' ? undefined : { label: 'Undo', verb: 'undo-board', run: () => {
          setBoardVisible(c.r.id, false).then(() => { toast.show({ message: `Off ${POSS[lane]} board.`, sub: 'Nothing was deleted.' }); onChanged() })
            .catch(e => toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'Could not take it off.' }))
        } },
      })
      onChanged(); advance(c.r.id)
    } catch (e) {
      toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'Could not put it on the board.' })
    } finally { setBusy(null) }
  }, [advance, confirm, onChanged, setBusy, toast])

  /** `slot`: the review desk's next step on an approved draft with no date (the next free weekday). Today's stack never passes it. */
  const schedule = useCallback(async (c: WeekCard, slot?: Date) => {
    if (!c.r.scheduled_at && !slot) { onOpen(c.r.id, c.lane); return }
    const at = c.r.scheduled_at ? new Date(c.r.scheduled_at) : slot as Date
    if (isPastSchedule(at.toISOString())) { toast.show({ tone: 'failed', message: 'That time has already passed. Pick a later time.' }); return }
    const ok = await confirm({
      title: 'Put this post on LinkedIn?',
      message: `The publisher posts this on ${at.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. This is not an internal mark, it goes out on LinkedIn.`,
      confirmText: 'Schedule it', verb: 'confirm',
    })
    if (!ok) return
    setBusy(c.r.id)
    try { const stored = await scheduleGuarded(c.r.id, at.toISOString()); toast.show(armedReceipt(at, stored)); onChanged(); advance(c.r.id) }
    catch (e) { toast.show({ tone: 'failed', message: (e as { message?: unknown })?.message && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : 'Could not arm it.' }) }
    finally { setBusy(null) }
  }, [advance, confirm, onChanged, onOpen, setBusy, toast])

  // Approve / Drop: one tap, held for the Undo window (verdictStore). The one question is the QA override:
  // Approve on Ivan's seat approves, and a draft QA refused must say so first.
  const judgeIt = useCallback(async (c: WeekCard, verdict: 'keep' | 'drop') => {
    if (c.lane === 'swishdm' && verdict === 'drop') return
    if (c.lane === 'swishdm' && verdict === 'keep') { await board(c); return }
    if (verdict === 'keep' && c.lane === 'ivan' && c.r.status === 'error') {
      const ok = await confirm({
        title: 'Approve this draft anyway?',
        message: 'QA refused this one. Approving overrides that verdict. Nothing publishes, scheduling is the separate act below.',
        confirmText: 'Approve', verb: 'confirm',
      })
      if (!ok) return
    }
    judge(c.r.id, verdict, { lane: c.lane, title: c.title, onCommitted: onChanged })
    advance(c.r.id)
  }, [advance, board, confirm, onChanged])

  const act = (c: WeekCard) => {
    if (c.primary === 'approve') approve(c)
    else if (c.primary === 'board') void board(c)
    else if (c.primary === 'schedule') void schedule(c)
    else onOpen(c.r.id, c.lane)
  }

  return { advance, approve, approveSchedule, board, schedule, judgeIt, act }
}
