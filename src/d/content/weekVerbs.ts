import { useCallback } from 'react'
import { setBoardVisible } from '../../lib/content'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { warsawDayTime } from '../ui/time'
import { HOLD_MS, holdDecision, undoDecision } from './decisions'
import { OWNER, POSS, type Lane } from './model'
import type { WeekCard } from './weekModel'
import { scheduleGuarded } from './writes'
import { judge } from './verdictStore'

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

  const board = useCallback(async (c: WeekCard) => {
    const lane = c.lane
    const ok = await confirm({
      title: `Put this on ${POSS[lane]} board?`,
      message: `${OWNER[lane]} sees it. This reaches a client: it fires his board’s own sync, so it lands within moments. `
        + 'From there the decisions are his: approve, edit, veto, schedule. Nothing publishes, this writes board visibility only.',
      confirmText: 'Put it on his board', verb: 'confirm',
    })
    if (!ok) return
    setBusy(c.r.id)
    try {
      await setBoardVisible(c.r.id, true)
      toast.show({
        message: `On ${POSS[lane]} board.`, sub: `${OWNER[lane]} decides from there.`,
        action: { label: 'Undo', verb: 'undo-board', run: () => {
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
    const ok = await confirm({
      title: 'Put this post on LinkedIn?',
      message: `The publisher posts this on ${at.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. This is not an internal mark, it goes out on LinkedIn.`,
      confirmText: 'Schedule it', verb: 'confirm',
    })
    if (!ok) return
    setBusy(c.r.id)
    try { await scheduleGuarded(c.r.id, at.toISOString()); toast.show({ message: `Armed for ${warsawDayTime(at)} Warsaw.`, sub: 'The publisher posts it then.' }); onChanged(); advance(c.r.id) }
    catch (e) { toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'Could not arm it.' }) }
    finally { setBusy(null) }
  }, [advance, confirm, onChanged, onOpen, setBusy, toast])

  // Approve / Drop: one tap, held for the Undo window (verdictStore). The one question is the QA override:
  // Approve on Ivan's seat approves, and a draft QA refused must say so first.
  const judgeIt = useCallback(async (c: WeekCard, verdict: 'keep' | 'drop') => {
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
  }, [advance, confirm, onChanged])

  const act = (c: WeekCard) => {
    if (c.primary === 'approve') approve(c)
    else if (c.primary === 'board') void board(c)
    else if (c.primary === 'schedule') void schedule(c)
    else onOpen(c.r.id, c.lane)
  }

  return { advance, approve, board, schedule, judgeIt, act }
}
