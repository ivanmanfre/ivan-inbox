import { useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { approveDraft, discardDraft, type Thread } from '../lib/inbox'

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

// Touch-drag only (no mouse-drag equivalent) — this is a phone-width PWA,
// mouse pointer support was skipped per implementation note.
function DraftCard({ thread, onOpenThread, refresh }: {
  thread: Thread; onOpenThread: (id: string) => void; refresh: () => void
}) {
  const draft = thread.draft!
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startX = useRef(0)
  const dxRef = useRef(0)

  function springBack() {
    dxRef.current = 0
    setDx(0)
  }

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX
    setDragging(true)
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!dragging) return
    const next = e.touches[0].clientX - startX.current
    dxRef.current = next
    setDx(next)
  }

  async function onTouchEnd() {
    setDragging(false)
    const final = dxRef.current
    if (final > SWIPE_THRESHOLD) await handleApprove()
    else if (final < -SWIPE_THRESHOLD) await handleDiscard()
    else springBack()
  }

  async function handleApprove() {
    if (busy) return
    if (!window.confirm(`Approve and send this reply to ${thread.prospect_name}?`)) {
      springBack()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await approveDraft(draft.id, draft.message_text)
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
    if (!window.confirm(`Discard this draft for ${thread.prospect_name}?`)) {
      springBack()
      return
    }
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
      className="qc"
      style={{ transform: `translateX(${dx}px)`, transition: dragging ? 'none' : 'transform .2s ease' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
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
      <div className="bd">{draft.message_text}</div>
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
  const draftThreads = threads.filter(t => t.draft !== null)
  const counts: Record<Seg, number> = {
    all: draftThreads.length,
    ivan: draftThreads.filter(t => t.client_id === 'ivan').length,
    risedtc: draftThreads.filter(t => t.client_id === 'risedtc').length,
  }
  const shown = seg === 'all' ? draftThreads : draftThreads.filter(t => t.client_id === seg)

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
      <div className="rows">
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
