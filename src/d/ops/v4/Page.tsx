import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Banner } from '../../../ds/Banner'
import { EmptyState } from '../../../ds/EmptyState'
import { Skeleton, SkeletonRows } from '../../../ds/Skeleton'
import { useCommentQueue } from '../../../hooks/useCommentQueue'
import { useOps } from '../../../hooks/useOps'
import { useReactions } from '../../../hooks/useReactions'
import { outboundFeedId, pendingOps, type OpsDraft } from '../../../lib/ops'
import { useFrameCounts } from '../../counts/useFrameCounts'
import type { PlaceProps } from '../../places'
import { dHash } from '../../route'
import { SEATS } from '../../seats'
import { useReportFailed } from '../../shell/health'
import { AnswerRow, N } from '../../ui/AnswerRow'
import { useDConfirmOpen } from '../../ui/confirm'
import { Btn } from '../../ui/Key'
import { Failed } from '../../ui/states'
import { warsawHm } from '../../ui/time'
import { useToast } from '../../ui/toast'
import { kindTitle, laneOf, positionOf, readBoard, rowLine, timeLeft } from '../model'
import { ReactionCard } from '../Reactions'
import { TakeoverCard } from '../Takeover'
import { CardV4 } from './Card'
import { KeySheet } from './KeySheet'
import { QueuePane } from './Queue'
import { animateReceipt, captureAction, finishAction, useDeferredLoading, useOpsMotion } from './motion'
import './ops4.css'

export function OpsPageV4({ layout, route, navigate }: PlaceProps) {
  const ops = useOps()
  const c = useFrameCounts()
  const pending = useMemo(() => pendingOps(ops.drafts), [ops.drafts])
  const { refresh: refreshOps } = ops, { refresh: refreshCounts } = c
  const refresh = useCallback(() => { refreshOps(); refreshCounts('ops') }, [refreshOps, refreshCounts])
  const queue = useCommentQueue(pending, refresh)
  const rx = useReactions(true)
  const heldIds = useMemo(() => new Set(queue.held.keys()), [queue.held])
  const board = useMemo(() => readBoard(ops.drafts, heldIds), [ops.drafts, heldIds])
  useReportFailed('ops', ops.error ? 1 : 0)
  const confirmOpen = useDConfirmOpen()
  const toast = useToast()
  const [seat, setSeat] = useState<string | null>(null)
  const [keySheet, setKeySheet] = useState(false)
  const lastAt = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const finishing = useRef(new Set<string>())
  const locked = useRef<{ card: OpsDraft | null; rx: typeof rx.rows[number] | null }>({ card: null, rx: null })
  const acted = useRef(new Map<string, { verb: string; who: string; lane: string; at: number; row: ReturnType<typeof captureAction> }>())
  const want = route.query.get('card'), wantRx = route.query.get('rx')
  const all = useMemo(() => [...board.flat, ...board.later], [board])
  let sel = want ? all.find(d => d.id === want) ?? null : null
  let reaction = wantRx ? rx.rows.find(r => r.id === wantRx) ?? null : null
  const compact = layout === 'phone' // T4 is switched by CSS and uses the same query contract.
  if (!sel && !wantRx && layout === 'desktop') {
    const laneCards = seat ? board.flat.filter(d => laneOf(d.client_id) === seat) : board.flat
    sel = laneCards[Math.min(lastAt.current, laneCards.length - 1)] ?? null
  }
  if ((!want || want === locked.current.card?.id) && !wantRx && locked.current.card && acted.current.has(locked.current.card.id) && !all.some(d => d.id === locked.current.card?.id)) sel = locked.current.card
  if (confirmOpen) { sel = locked.current.card; reaction = locked.current.rx }
  const currentView = useRef({ id: '', rx: null as string | null })
  currentView.current = { id: sel?.id ?? reaction?.id ?? '', rx: wantRx }
  useEffect(() => { if (!confirmOpen) locked.current = { card: sel, rx: reaction } }, [sel, reaction, confirmOpen])
  const lane = sel ? laneOf(sel.client_id) : seat ?? SEATS.find(s => board.lanes[s].length) ?? board.other[0]?.key ?? 'ivan'
  const selIdx = sel ? board.flat.findIndex(d => d.id === sel!.id) : -1
  useEffect(() => { if (selIdx >= 0) lastAt.current = selIdx }, [selIdx])
  const blocked = useCallback(() => confirmOpen || !!document.querySelector('.d-confirm, .d-sheet, .d-palette'), [confirmOpen])
  const pick = useCallback((id: string) => { if (!blocked()) { setSeat(null); navigate(dHash('ops', null, { card: id })) } }, [navigate, blocked])
  const pickReaction = (id: string) => { if (!blocked()) navigate(dHash('ops', null, { rx: id })) }
  const chooseSeat = (s: string) => {
    if (blocked()) return
    setSeat(s); lastAt.current = 0
    const first = board.flat.find(d => laneOf(d.client_id) === s)
    navigate(layout === 'desktop' && first ? dHash('ops', null, { card: first.id }) : dHash('ops'))
  }
  const onActed = useCallback((id: string, verb: string) => {
    const d = all.find(x => x.id === id), r = rx.rows.find(x => x.id === id)
    if (!d && !r) return
    acted.current.set(id, { verb, who: d ? rowLine(d).who : r?.evidence?.who ?? 'Reaction', lane: d ? laneOf(d.client_id) : r!.lane, at: Date.now(), row: captureAction(root.current, id) })
  }, [all, rx.rows])
  useEffect(() => {
    if (ops.loading || ops.error || confirmOpen || rx.busy || rx.actionError) return
    for (const [id, a] of acted.current) {
      if (Date.now() - a.at > 120000) { acted.current.delete(id); continue }
      if (all.some(d => d.id === id) || rx.rows.some(r => r.id === id) || finishing.current.has(id)) continue
      const errorCard = [...root.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []].find(e => e.dataset.card === id)?.querySelector('.op-err')
      if (errorCard) { acted.current.delete(id); continue }
      finishing.current.add(id)
      const next = board.flat.find(d => laneOf(d.client_id) === a.lane) ?? (compact ? null : board.flat[0])
      void finishAction(root.current, id, a.verb, a.row, Math.min(finishing.current.size - 1, 9) * 70).then(() => {
      toast.show({ id: `ops-${id}`, message: `${a.verb} · ${a.who}`, sub: next ? `Next: ${rowLine(next).who}` : undefined })
      if (currentView.current.id === id || currentView.current.rx === id) navigate(next ? dHash('ops', null, { card: next.id }) : dHash('ops'))
      acted.current.delete(id); finishing.current.delete(id)
      requestAnimationFrame(() => animateReceipt(a.who))
      })
    }
  }, [all, board.flat, ops.loading, ops.error, confirmOpen, rx.rows, rx.busy, rx.actionError, compact, toast, navigate, want, wantRx])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (blocked()) return
      const el = document.activeElement as HTMLElement | null
      if (el?.matches('textarea,input,[contenteditable=true]')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '?') { e.preventDefault(); setKeySheet(true) }
      if (layout !== 'desktop') return
      if (e.key === 'e') { const editor = document.querySelector<HTMLTextAreaElement>('.op4 [data-card] textarea'); if (editor) { e.preventDefault(); editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length) } }
      if (e.key === 'j' || e.key === 'k') {
        const next = selIdx + (e.key === 'j' ? 1 : -1)
        if (next >= 0 && next < board.flat.length) { e.preventDefault(); pick(board.flat[next].id) }
      }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [blocked, layout, selIdx, board.flat, pick])
  const firstRead = ops.loading && !ops.drafts.length
  const deferred = useDeferredLoading(firstRead)
  useOpsMotion(root, sel?.id ?? reaction?.id ?? '', lane)
  const w = board.waiting, otherN = board.other.reduce((a, o) => a + o.waiting, 0)
  const nj = board.flat.find(d => d.kind === 'newsjack' && timeLeft(d.context?.expires_at) !== 'expired')
  const sub = nj ? `A ${positionOf(board, nj).lane} newsjack has ${timeLeft(nj.context?.expires_at)}.` : ''
  const answer = <AnswerRow title={<>Waiting on you: <N v={w.ivan} /> yours, <N v={w.risedtc} /> Rise, <N v={w.arch} /> Arch{otherN > 0 && <>, <N v={otherN} /> in other lanes</>}.</>}
    sub={firstRead ? 'Reading the queue…' : sub} tools={<button type="button" className="d-ib" data-op4-keys aria-label="Ops keys (?)" onClick={() => setKeySheet(true)}>?</button>} />
  const checked = ops.loadedAt ? warsawHm(ops.loadedAt) : '…'
  const stale = ops.error && ops.drafts.length > 0 ? <Banner tone="attention" action={<Btn verb="retry" onClick={refresh}>Retry</Btn>}>Could not refresh{ops.loadedAt ? ` (showing ${checked})` : ''}.</Banner> : null
  const gone = (want && !all.some(d => d.id === want) && !acted.current.has(want)) || (wantRx && !reaction && !acted.current.has(wantRx))
  let detail
  if (!confirmOpen && ops.error && !ops.drafts.length) detail = <EmptyState title="Nothing to show until the queue reads." />
  else if (reaction) detail = <>
    {rx.actionError && <Banner tone="urgent">{rx.actionError}</Banner>}
    <p className="op-quiet">Takes people are already arguing about. On Ivan’s lane approving dates the post for the earliest free day; on Rise it goes to Mattan’s board for his call. Neither publishes anything.</p>
    <ReactionCard r={reaction} rx={rx} onActed={onActed} />
  </>
  else if (sel) {
    const p = positionOf(board, sel), pos = `card ${p.at} of ${p.of}`, wIdx = queue.positionOf(sel.id)
    detail = sel.kind === 'conversation_takeover' ? <TakeoverCard key={sel.id} d={sel} refresh={refresh} pos={pos} onActed={onActed} /> : <CardV4 key={sel.id} d={sel} refresh={refresh}
      feed={queue.feed.get(outboundFeedId(sel) ?? '')} held={queue.held.get(sel.id)} onGateResult={queue.record} layout={layout} pos={pos} onActed={onActed}
      waitingLine={wIdx < 0 ? null : queue.cappedToday ? 'Held: 3-a-day cap reached. Back tomorrow.' : `Queued, number ${wIdx + 1} in line. Leave the tab open.`}
      previous={selIdx > 0 ? () => pick(board.flat[selIdx - 1].id) : undefined} next={compact ? (() => { const cards = board.flat.filter(d => laneOf(d.client_id) === lane); const i = cards.findIndex(d => d.id === sel?.id); return i >= 0 && i + 1 < cards.length ? () => pick(cards[i + 1].id) : undefined })() : selIdx >= 0 && selIdx + 1 < board.flat.length ? () => pick(board.flat[selIdx + 1].id) : undefined} />
  } else detail = <EmptyState title="Nothing waiting on you." sub={`Checked ${checked}.`} />
  return <div ref={root} className={`op-page op4 op4-${layout}${(want || wantRx || confirmOpen) && (sel || reaction) ? ' op4-open' : ''}`}>
    {answer}
    <div className="op4-desk">
      <aside className="op4-queue" data-d-scroll>
        {stale}
        {!confirmOpen && (firstRead || deferred) ? deferred ? <><div className="op4-seat-skeleton"><Skeleton shape="title" /></div><SkeletonRows rows={5} label="Reading the ops queue" /></> : null : ops.error && !ops.drafts.length ? <Failed what="the ops queue" detail={ops.error} onRetry={refresh} /> : <QueuePane {...{ board, lane, refresh, queue, rx, onActed }} drafts={ops.drafts} selected={sel?.id ?? null} selectedRx={reaction?.id ?? null} onSeat={chooseSeat} onPick={pick} onReaction={pickReaction} />}
      </aside>
      <div className="op4-detail">
        {(want || wantRx || confirmOpen) && <div className="op4-back"><button type="button" className="d-ib" aria-label="Back to Ops" onClick={() => { if (!blocked()) navigate(dHash('ops')) }}>‹</button><span>{sel ? kindTitle(sel) : 'Reaction'}</span></div>}
        {gone && !confirmOpen && <Banner>That card is not waiting any more: it was handled or it aged out.</Banner>}
        {rx.done && <Banner>{rx.done.lane === 'risedtc' ? 'On Mattan’s board, waiting on him. Nothing is dated and nothing is armed.' : `Scheduled for ${rx.done.scheduledAt}. A draft on the calendar, not a publish.`}</Banner>}
        {!confirmOpen && (firstRead || deferred) ? deferred ? <div className="op4-loading"><Skeleton shape="title" /><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div> : null : detail}
      </div>
    </div>
    <KeySheet open={keySheet} onClose={() => setKeySheet(false)} />
  </div>
}
