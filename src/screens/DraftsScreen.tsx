import { useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Linkified } from '../components/Linkified'
import { useConfirm } from '../components/ConfirmSheet'
import { PullIndicator } from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { approveDraft, discardDraft, threadChatId, type Thread } from '../lib/inbox'

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
  all: 'No drafts right now.',
  ivan: 'No Ivan drafts right now.',
  risedtc: 'No Rise drafts right now.',
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
function DraftCard({ thread, onOpenThread, refresh }: {
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

export function DraftsScreen({ threads, onOpenThread, refresh }: {
  threads: Thread[]; onOpenThread: (id: string) => void; refresh: () => void
}) {
  const [seg, setSeg] = useState<Seg>('all')
  const [bulkBusy, setBulkBusy] = useState(false)
  const rowsRef = useRef<HTMLDivElement>(null)
  const confirm = useConfirm()
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const draftThreads = threads.filter(t => t.draft !== null)
  const counts: Record<Seg, number> = {
    all: draftThreads.length,
    ivan: draftThreads.filter(t => t.client_id === 'ivan').length,
    risedtc: draftThreads.filter(t => t.client_id === 'risedtc').length,
  }
  const segThreads = seg === 'all' ? draftThreads : draftThreads.filter(t => t.client_id === seg)
  // Fresh drafts first; stale ones (Ivan already replied) sink to the bottom.
  const shown = [...segThreads.filter(t => !t.draftStale), ...segThreads.filter(t => t.draftStale)]
  const staleShown = segThreads.filter(t => t.draftStale)

  async function discardAllStale() {
    const ok = await confirm({
      title: `Discard ${staleShown.length} stale draft${staleShown.length === 1 ? '' : 's'}?`,
      message: 'These threads already have your own reply after the last inbound message. Nothing is sent.',
      confirmText: 'Discard stale',
      danger: true,
    })
    if (!ok) return
    setBulkBusy(true)
    try {
      for (const t of staleShown) await discardDraft(t.draft!.id)
      refresh()
    } finally {
      setBulkBusy(false)
    }
  }

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
        {staleShown.length > 0 && (
          <div className="stalebar">
            <span>{staleShown.length} draft{staleShown.length === 1 ? '' : 's'} where you already replied</span>
            <button className="stalebtn" disabled={bulkBusy} onClick={discardAllStale}>
              {bulkBusy ? 'Discarding…' : 'Discard stale'}
            </button>
          </div>
        )}
        {shown.length === 0 ? (
          <div className="empty">{SEG_EMPTY[seg]}</div>
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
