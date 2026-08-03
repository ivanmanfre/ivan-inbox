import { useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Linkified } from '../components/Linkified'
import { useConfirm } from '../components/ConfirmSheet'
import { PullIndicator } from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { approveDraft, discardDraft, threadChatId, type Thread } from '../lib/inbox'
import { useOps } from '../hooks/useOps'
import { pendingDmLaneOps, type OpsDraft, type OpsKind } from '../lib/ops'
import { checkedPhrase } from '../lib/today'

// ops_drafts predates the risedtc client id and still writes 'rise' for the Slack
// kinds, so both map to the same chip. Without this the Rise segment silently
// hides half the Ops queue.
function opsSeg(clientId: string): Seg | string {
  return clientId === 'rise' ? 'risedtc' : clientId
}

const OPS_LABEL: Record<OpsKind, string> = {
  escalation: 'ESC', update: 'UPDATE', newsjack: 'NEWSJACK',
  weekly_report: 'WEEKLY', comment_reply: 'COMMENT', comment_outbound: 'OUTBOUND',
}

// One tappable line each: enough to know what is waiting, not a second Ops tab.
// Acting on them stays on the Ops tab, which owns every approve path.
// Exported since 2026-08-03: the Inbox job was folded into DMs, and the DMs
// surface is now the conversation list, so the three pieces that made this
// screen worth having — the approve/discard card, the stale-draft bar and the
// Ops pointer — travel there. This screen still renders for `#exp/stock`.
export function OpsPending({ drafts, onOpenOps }: { drafts: OpsDraft[]; onOpenOps: () => void }) {
  if (drafts.length === 0) return null
  return (
    <>
      {/* Single ownership: a count and a way in, never a second approve path.
          The owner is named inline so the row does not read as a button someone
          forgot to draw. */}
      <div className="ops-sechdr" onClick={onOpenOps}>
        <span>Ops · {drafts.length} — approved in Ops, not here</span>
        <span className="chev">›</span>
      </div>
      {drafts.map(d => (
        <div key={d.id} className="log-r" onClick={onOpenOps} style={{ cursor: 'pointer' }}>
          <span className="log-chip">{OPS_LABEL[d.kind] ?? d.kind}</span>
          <div className="log-mid">
            <div className="log-top">
              <span className="log-nm">
                {d.context?.author_name ?? d.context?.prospect_name
                  ?? (d.slack_channel ? `#${d.slack_channel}` : clientTitle(d.client_id))}
              </span>
            </div>
            <div className="log-snip">
              {d.body?.trim() || d.context?.headline || 'Needs you, no draft'}
            </div>
          </div>
          <span className="log-tm">{timeAgo(d.created_at)}</span>
        </div>
      ))}
    </>
  )
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yday'
  return `${d}d`
}

type Seg = 'all' | 'ivan' | 'risedtc'

const SEGS: { key: Seg; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
]

const SEG_EMPTY: Record<Seg, string> = {
  all: 'Nothing waiting on you',
  ivan: 'Nothing waiting on you in Ivan',
  risedtc: 'Nothing waiting on you in Rise',
}

function clientTitle(id: string): string {
  if (id === 'risedtc') return 'Rise'
  if (id === 'ivan') return 'Ivan'
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function channelLabel(c: Thread['channel']): string {
  if (c === 'email') return 'Email'
  if (c === 'linkedin_inmail') return 'InMail'
  return 'LinkedIn'
}

const SWIPE_THRESHOLD = 72

// Pointer-based swipe: works with both touch and mouse (so the card is usable
// on desktop too). A directional lock decides on the first move whether the
// gesture is a horizontal swipe (we take it) or a vertical scroll (we bail),
// so the list still scrolls normally under your finger.
export function DraftCard({ thread, onOpenThread, refresh }: {
  thread: Thread; onOpenThread: (id: string) => void; refresh: () => void
}) {
  const draft = thread.draft!
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = useConfirm()
  const start = useRef({ x: 0, y: 0 })
  const axis = useRef<'none' | 'x' | 'y'>('none')
  const dxRef = useRef(0)

  function springBack() {
    dxRef.current = 0
    setDx(0)
  }

  function onPointerDown(e: React.PointerEvent) {
    if (busy) return
    start.current = { x: e.clientX, y: e.clientY }
    axis.current = 'none'
    setDragging(true)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return
    const ddx = e.clientX - start.current.x
    const ddy = e.clientY - start.current.y
    if (axis.current === 'none') {
      if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return
      // Lock to whichever direction dominated the first few pixels.
      axis.current = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y'
      if (axis.current === 'x') e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (axis.current !== 'x') return
    dxRef.current = ddx
    setDx(ddx)
  }

  async function onPointerUp() {
    if (!dragging) return
    setDragging(false)
    const final = axis.current === 'x' ? dxRef.current : 0
    axis.current = 'none'
    if (final > SWIPE_THRESHOLD) await handleApprove()
    else if (final < -SWIPE_THRESHOLD) await handleDiscard()
    else springBack()
  }

  async function handleApprove() {
    if (busy) return
    const ok = await confirm({
      title: `Send to ${thread.prospect_name}?`,
      message: 'The sender picks it up within about 2 minutes.',
      confirmText: 'Approve & send',
    })
    if (!ok) { springBack(); return }
    setBusy(true)
    setError(null)
    try {
      await approveDraft(draft.id, draft.message_text, threadChatId(thread))
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve draft')
      springBack()
    } finally {
      setBusy(false)
    }
  }

  async function handleDiscard() {
    if (busy) return
    const ok = await confirm({
      title: `Discard this draft?`,
      message: `It won't be sent to ${thread.prospect_name}.`,
      confirmText: 'Discard',
      danger: true,
    })
    if (!ok) { springBack(); return }
    setBusy(true)
    setError(null)
    try {
      await discardDraft(draft.id)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not discard draft')
      springBack()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`qc ${dragging ? 'dragging' : ''}`}
      style={{ transform: `translateX(${dx}px)`, transition: dragging ? 'none' : 'transform .2s ease' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="h">
        <Avatar name={thread.prospect_name} client_id={thread.client_id} channel={thread.channel} />
        <div>
          <div className="nm">{thread.prospect_name}</div>
          <div className="sub">
            {clientTitle(thread.client_id)} · {channelLabel(thread.channel)} · {thread.stage} {timeAgo(draft.created_at)}
          </div>
        </div>
        <div className="tm">{timeAgo(draft.created_at)}</div>
      </div>
      {thread.draftStale && (
        <div className="stale">You already replied after their last message — probably not needed</div>
      )}
      <div className="bd" onClick={() => onOpenThread(thread.prospect_id)}>
        <Linkified text={draft.message_text} />
        <span className="editcue">Tap to edit</span>
      </div>
      {error && <div className="err">{error}</div>}
      <div className="ac">
        <div className="btn s" onClick={() => onOpenThread(thread.prospect_id)}>Edit</div>
        <div className="btn p" onClick={handleApprove}>{busy ? 'Sending…' : 'Approve & send'}</div>
      </div>
    </div>
  )
}

// The bulk exit from the stale-draft class (Ivan already answered in the
// LinkedIn app, so the queued AI reply is answering a handled message). Lifted
// out of DraftsScreen so the DMs surface gets the same one-tap escape.
export function StaleBar({ stale, refresh }: { stale: Thread[]; refresh: () => void }) {
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()
  if (stale.length === 0) return null

  async function discardAllStale() {
    const ok = await confirm({
      title: `Discard ${stale.length} stale draft${stale.length === 1 ? '' : 's'}?`,
      message: 'These threads already have your own reply after the last inbound message. Nothing is sent.',
      confirmText: 'Discard stale',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      for (const t of stale) await discardDraft(t.draft!.id)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stalebar">
      <span>{stale.length} draft{stale.length === 1 ? '' : 's'} where you already replied</span>
      <button className="stalebtn" disabled={busy} onClick={discardAllStale}>
        {busy ? 'Discarding…' : 'Discard stale'}
      </button>
    </div>
  )
}

export function DraftsScreen({ threads, onOpenThread, refresh, onOpenOps, verifiedAt }: {
  threads: Thread[]; onOpenThread: (id: string) => void; refresh: () => void
  onOpenOps: () => void
  // Same rule as InboxScreen: only a host that knows the fetch succeeded may let
  // this screen claim its empty queue is a live read.
  verifiedAt?: string | null
}) {
  const { drafts: opsAll, refresh: refreshOps } = useOps()
  const [seg, setSeg] = useState<Seg>('all')
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => { refresh(); refreshOps() })
  const draftThreads = threads.filter(t => t.draft !== null)
  // Everything waiting on Ivan lives in one count, so the tab badge and this
  // screen cannot disagree about how much is pending. Comment drafts are NOT in
  // it (ask 12): they are Ops cards, approved on the Ops tab, and listing them
  // under DMs made the lane read as a comment queue.
  const opsPend = pendingDmLaneOps(opsAll)
  const opsIn = (seg: Seg) => seg === 'all' ? opsPend : opsPend.filter(d => opsSeg(d.client_id) === seg)
  const counts: Record<Seg, number> = {
    all: draftThreads.length + opsPend.length,
    ivan: draftThreads.filter(t => t.client_id === 'ivan').length + opsIn('ivan').length,
    risedtc: draftThreads.filter(t => t.client_id === 'risedtc').length + opsIn('risedtc').length,
  }
  const segThreads = seg === 'all' ? draftThreads : draftThreads.filter(t => t.client_id === seg)
  // Fresh drafts first; stale ones (Ivan already replied) sink to the bottom.
  const shown = [...segThreads.filter(t => !t.draftStale), ...segThreads.filter(t => t.draftStale)]
  const staleShown = segThreads.filter(t => t.draftStale)

  return (
    <>
      <div className="nav">
        <div className="row-top">
          <h2>Drafts</h2>
          <div className="avatar-me">IM</div>
        </div>
      </div>
      <div className="seg">
        {SEGS.map(s => (
          <div
            key={s.key}
            className={`sg ${seg === s.key ? 'on' : ''}`}
            onClick={() => setSeg(s.key)}
          >
            {s.label} · {counts[s.key]}
          </div>
        ))}
      </div>
      <div className="rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        <StaleBar stale={staleShown} refresh={refresh} />
        <OpsPending drafts={opsIn(seg)} onOpenOps={onOpenOps} />
        {shown.length === 0 ? (
          opsIn(seg).length === 0
            ? (
              <div className="empty">
                {SEG_EMPTY[seg]}
                {verifiedAt !== undefined && (
                  <div className="empty-f">
                    <span className="empty-dot" />
                    {checkedPhrase(verifiedAt)}. This is a live read, not a stall.
                  </div>
                )}
              </div>
            )
            : null
        ) : (
          <>
            {shown.map(t => (
              <DraftCard key={t.prospect_id} thread={t} onOpenThread={onOpenThread} refresh={refresh} />
            ))}
            <div className="swipehint">Swipe right to <b>approve</b> · swipe left to <b>discard</b></div>
          </>
        )}
      </div>
    </>
  )
}
