import { type ReactNode, useRef, useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useContent } from '../../hooks/useContent'
import { approveDraft, skipDraft, type ContentDraft, type ContentLane } from '../../lib/content'

const TYPE_LABEL: Record<string, string> = { text: 'Text', single_image: 'Image', carousel: 'Carousel' }
function typeLabel(t: string | null): string {
  if (!t) return 'Text'
  return TYPE_LABEL[t] ?? t
}

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

// One card shape for every bucket (title/topic, type chip, relative time,
// thumbnail if there's one). Only a 'review' row in the Ivan lane gets the
// approve/skip pair — D6/D7: approve is a status write that does NOT publish,
// and the Rise lane is read-only ambient visibility here (client-facing
// decisions stay on the client board).
function QueueCard({ d, lane, refresh }: { d: ContentDraft; lane: ContentLane; refresh: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirm()
  const actionable = d.status === 'review' && lane === 'ivan'
  const thumb = d.image_urls?.[0]

  async function approve() {
    const ok = await confirm({
      title: 'Approve this draft?',
      message: 'Marks approved. Nothing publishes — scheduling stays on the board.',
      confirmText: 'Approve',
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await approveDraft(d.id); refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not approve') }
    finally { setBusy(false) }
  }

  async function skip() {
    const ok = await confirm({
      title: 'Skip this draft?',
      message: 'Marks it disqualified — it drops out of the queue for good.',
      confirmText: 'Skip',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await skipDraft(d.id); refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not skip') }
    finally { setBusy(false) }
  }

  return (
    <div className="ct-card">
      <div className="ct-top">
        {thumb ? <img className="ct-thumb" src={thumb} alt="" /> : <div className="ct-thumb ct-thumb-empty">No image</div>}
        <div className="ct-mid">
          <div className="ct-title">{d.title || d.topic || 'Untitled'}</div>
          {d.title && d.topic && d.title !== d.topic && <div className="ct-topic">{d.topic}</div>}
          <div className="ct-meta">
            <span className="ct-chip">{typeLabel(d.type)}</span>
            <span className="ct-tm">{relTime(d.updated_at)}</span>
            {lane === 'risedtc' && <span className="ct-lane">client lane</span>}
          </div>
        </div>
      </div>
      {error && <div className="ops-err" style={{ marginTop: 8 }}>{error}</div>}
      {actionable && (
        <div className="ct-ac">
          <div className="btn s" onClick={busy ? undefined : skip}>Skip</div>
          <div className="btn p" onClick={busy ? undefined : approve}>{busy ? 'Working…' : 'Approve'}</div>
        </div>
      )}
    </div>
  )
}

// Same collapsible header idiom as OpsScreen's Section (ops-sechdr/chev,
// hidden entirely at count 0 — no empty-state chrome for secondary groups).
function Section({ title, count, defaultOpen, children }: {
  title: string; count: number; defaultOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  if (count === 0) return null
  return (
    <>
      <div className="ops-sechdr" onClick={() => setOpen(o => !o)}>
        <span>{title} · {count}</span>
        <span className="chev">{open ? '⌄' : '›'}</span>
      </div>
      {open && <div>{children}</div>}
    </>
  )
}

function ContentSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <div className="ct-card" key={i}>
          <div className="ct-top">
            <div className="sk" style={{ width: 56, height: 56, borderRadius: 12, flex: 'none' }} />
            <div className="ct-mid">
              <div className="sk sk-line" style={{ width: '60%' }} />
              <div className="sk sk-line" style={{ width: '40%', marginTop: 8 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

const LANES: { key: ContentLane; label: string }[] = [
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
]

export function ContentQueue({ lane, setLane }: { lane: ContentLane; setLane: (l: ContentLane) => void }) {
  const { buckets, matched, laneTotal, loading, error, refresh } = useContent(lane)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())

  const firstLoad = loading && Object.values(buckets).every(b => b.length === 0)
  // D10: an empty board and a broken filter must never render the same way.
  // scoped===0 while the lane has rows at all means the recent-or-active
  // filter ate everything — a bug, not a quiet Sunday.
  const nothingMatched = !loading && (matched ?? 0) === 0
  const filteredAway = nothingMatched && (laneTotal ?? 0) > 0

  return (
    <>
      <div className="chips" style={{ margin: '4px 16px 0' }}>
        {LANES.map(l => (
          <span key={l.key} className={`chip ${lane === l.key ? 'on' : ''}`} onClick={() => setLane(l.key)}>
            {l.label}
          </span>
        ))}
      </div>
      <div className="rows ct-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {error ? (
          <div className="ct-broken">{error}</div>
        ) : firstLoad ? (
          <ContentSkeleton />
        ) : nothingMatched ? (
          filteredAway ? (
            <div className="ct-broken">
              Nothing matches the queue filters — {laneTotal} draft{laneTotal === 1 ? '' : 's'} exist outside them.
            </div>
          ) : (
            <div className="empty">No {lane === 'ivan' ? 'Ivan' : 'Rise'} drafts in the queue.</div>
          )
        ) : (
          <>
            {buckets.review.length === 0 ? (
              <div className="empty">Nothing waiting on review.</div>
            ) : (
              buckets.review.map(d => <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} />)
            )}
            <Section title="Errors" count={buckets.error.length} defaultOpen>
              {buckets.error.map(d => <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} />)}
            </Section>
            <Section title="Stuck" count={buckets.stuckScheduled.length} defaultOpen>
              {buckets.stuckScheduled.map(d => <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} />)}
            </Section>
            <Section title="Approved, unscheduled" count={buckets.approvedUnscheduled.length} defaultOpen>
              {buckets.approvedUnscheduled.map(d => <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} />)}
            </Section>
            <Section title="Generating" count={buckets.generating.length}>
              {buckets.generating.map(d => <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} />)}
            </Section>
            <Section title="Scheduled" count={buckets.scheduled.length}>
              {buckets.scheduled.map(d => <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} />)}
            </Section>
            <Section title="Recently published" count={buckets.published.length}>
              {buckets.published.map(d => <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} />)}
            </Section>
            {/* Unknown statuses (vocabulary the app hasn't caught up to yet) and
                archived (disqualified/skipped) rows are never dropped — they
                just collapse into one low-priority tray at the bottom. */}
            <Section title="Other" count={buckets.archived.length + buckets.unknown.length}>
              {[...buckets.archived, ...buckets.unknown].map(d => <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} />)}
            </Section>
          </>
        )}
      </div>
    </>
  )
}
