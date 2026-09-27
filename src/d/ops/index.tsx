import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCommentQueue } from '../../hooks/useCommentQueue'
import { useOps } from '../../hooks/useOps'
import { useReactions } from '../../hooks/useReactions'
import { outboundFeedId, pendingOps } from '../../lib/ops'
import { useFrameCounts } from '../counts/useFrameCounts'
import type { PlaceProps } from '../places'
import { dHash } from '../route'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import { useReportFailed } from '../shell/health'
import { AnswerRow, N } from '../ui/AnswerRow'
import { DIcon } from '../ui/icons'
import { Btn } from '../ui/Key'
import { Failed, Skeleton } from '../ui/states'
import { warsawHm } from '../ui/time'
import { OpsCard } from './Card'
import { DeskLanes, PhoneLanes } from './Lanes'
import { KIND_TITLE, positionOf, readBoard, timeLeft } from './model'
import { Reactions } from './Reactions'
import { TakeoverCard } from './Takeover'
import { Tasks } from './Tasks'
import './ops.css'

// D · OPS. Desktop: the three lane columns across the top, the open card under
// them, the side column (your list, then the reaction desk). Phone: the answer,
// three lane plates, the chosen lane's rows, the list, the desk; a card opens
// full page (`?card=<id>`) with its keys right under its content.
// Hooks rule: every hook runs before any branch that returns.

export default function OpsPage({ layout, route, navigate }: PlaceProps) {
  const ops = useOps()
  const c = useFrameCounts()
  const pending = useMemo(() => pendingOps(ops.drafts), [ops.drafts])
  const { refresh: refreshOps } = ops
  const { refresh: refreshCounts } = c
  const refresh = useCallback(() => { refreshOps(); refreshCounts('ops') }, [refreshOps, refreshCounts])
  const queue = useCommentQueue(pending, refresh)
  const rx = useReactions(true)
  const heldIds = useMemo(() => new Set(queue.held.keys()), [queue.held])
  const board = useMemo(() => readBoard(ops.drafts, heldIds), [ops.drafts, heldIds])
  useReportFailed('ops', ops.error ? 1 : 0)

  const want = route.query.get('card')
  const lastAt = useRef(0)
  const all = useMemo(() => [...board.flat, ...board.later], [board])
  let sel = want ? all.find(d => d.id === want) ?? null : null
  // Desktop always has a card open: the asked one, else the one that took the
  // handled card's place, else the first.
  if (!sel && layout === 'desktop' && board.flat.length > 0) sel = board.flat[Math.min(lastAt.current, board.flat.length - 1)]
  const selIdx = sel ? board.flat.findIndex(d => d.id === sel!.id) : -1
  useEffect(() => { if (selIdx >= 0) lastAt.current = selIdx }, [selIdx])

  const pick = useCallback((id: string) => navigate(dHash('ops', null, { card: id })), [navigate])
  const [seat, setSeat] = useState<Seat | null>(null)
  const phoneSeat: Seat = seat ?? SEATS.find(s => board.lanes[s].length > 0) ?? 'ivan'

  // j / k walk every card in lane order (desktop).
  useEffect(() => {
    if (layout !== 'desktop') return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'j' && e.key !== 'k')) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return
      const next = selIdx + (e.key === 'j' ? 1 : -1)
      if (next < 0 || next >= board.flat.length) return
      e.preventDefault()
      pick(board.flat[next].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout, selIdx, board.flat, pick])

  // ---- the answer ----
  const w = board.waiting
  const title = <>Waiting on you: <N v={w.ivan} /> yours, <N v={w.risedtc} /> Rise, <N v={w.arch} /> Arch.</>
  const nj = board.flat.find(d => d.kind === 'newsjack' && timeLeft(d.context?.expires_at) !== 'expired')
  const onList = SEATS.reduce((a, s) => a + board.tasks[s], 0)
  // One sentence, the most urgent one: a newsjack's clock, else the ideas
  // waiting for later, else how much of the number sits on the list.
  const sub = nj ? `A ${SEAT_NAME[SEATS.find(s => board.lanes[s].includes(nj)) ?? 'ivan']} newsjack has ${timeLeft(nj.context?.expires_at)}.`
    : board.later.length > 0 ? `${board.later.length} more comment ideas wait for later.`
      : onList > 0 ? `${onList} of them ${onList === 1 ? 'is' : 'are'} on your list.` : ''
  const answer = <AnswerRow title={title} sub={ops.loading && ops.drafts.length === 0 ? 'Reading the queue…' : sub} />

  if (ops.error && ops.drafts.length === 0) {
    return <div className={`op-page op-${layout}`}>{answer}<Failed what="the ops queue" detail={`${ops.error} Nothing has loaded yet, so this is not an empty queue, it is an unread one.`} onRetry={refresh} /></div>
  }
  if (ops.loading && ops.drafts.length === 0) {
    return <div className={`op-page op-${layout}`}>{answer}<Skeleton lines={7} label="Reading the ops queue" /></div>
  }

  const stale = ops.error
    ? <div className="op-ban op-ban-warn op-stale">Could not refresh{ops.loadedAt ? `, showing the copy from ${warsawHm(ops.loadedAt)}` : ''}. The cards may be out of date. <Btn verb="retry" onClick={refresh}>Retry</Btn></div>
    : null

  const card = sel ? (() => {
    const p = positionOf(board, sel)
    const pos = `card ${p.at} of ${p.of}`
    if (sel.kind === 'conversation_takeover') return <TakeoverCard key={sel.id} d={sel} refresh={refresh} pos={pos} />
    const wIdx = queue.positionOf(sel.id)
    const line = wIdx < 0 ? null : queue.cappedToday
      ? 'Held: the poster hit its 3-a-day cap. It stays here for tomorrow.'
      : `Queued here, number ${wIdx + 1} in line: the poster takes one at a time, so this retries as its window opens. Leave the tab open.`
    return <OpsCard key={sel.id} d={sel} refresh={refresh} feed={queue.feed.get(outboundFeedId(sel) ?? '')}
      held={queue.held.get(sel.id)} onGateResult={queue.record} layout={layout} pos={pos} waitingLine={line} />
  })() : null

  const checked = ops.loadedAt ? warsawHm(ops.loadedAt) : '…'

  if (layout === 'phone' && want && sel) {
    const p = positionOf(board, sel)
    return (
      <div className="op-page op-phone op-open">
        <div className="op-back">
          <button type="button" className="d-ib" aria-label="Back to Ops" onClick={() => navigate(dHash('ops'))}><DIcon name="back" /></button>
          <div className="op-backt"><small>{SEAT_NAME[p.seat]} lane · {p.at} of {p.of}</small><b>{KIND_TITLE[sel.kind]}</b></div>
        </div>
        {card}
      </div>
    )
  }

  const side = (
    <>
      <Tasks drafts={ops.drafts} refresh={refresh} />
      <Reactions rx={rx} />
    </>
  )

  if (layout === 'phone') {
    return (
      <div className="op-page op-phone">
        {answer}
        {stale}
        {want && !sel && <div className="op-ban">That card is not waiting any more: it was handled or it aged out.</div>}
        <PhoneLanes board={board} seat={phoneSeat} setSeat={setSeat} onPick={pick} refresh={refresh} />
        {side}
      </div>
    )
  }

  return (
    <div className="op-page op-desktop">
      {answer}
      <div className="op-desk">
        <div className="op-left">
          {stale}
          <DeskLanes board={board} sel={sel?.id ?? null} onPick={pick} refresh={refresh} />
          <div className="op-master">
            {card ?? <div className="op-quiet op-big">Nothing waiting on you, and this is a live read, not a stall.<br />Checked {checked}.</div>}
          </div>
        </div>
        <aside className="op-side">{side}</aside>
      </div>
    </div>
  )
}
