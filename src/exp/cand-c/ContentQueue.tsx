import { useRef, useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useContent } from '../../hooks/useContent'
import {
  approveDraft, skipDraft,
  type ContentBucketName, type ContentDraft, type ContentLane,
} from '../../lib/content'

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

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const LANES: { key: ContentLane; label: string }[] = [
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
]

// Section order IS the spec (D5, AUDIT.md): review first because it is the
// only bucket anyone acts on here, stuck/approved-unscheduled next because
// they are the proven black-hole buckets (blank-board #3), published last as
// ambient confirmation the pipeline is actually moving. archived/unknown fold
// into the collapsed "Other" section below — surfaced, never dropped.
const SECTIONS: { key: ContentBucketName; title: string }[] = [
  { key: 'review', title: 'Needs review' },
  { key: 'error', title: 'Errors' },
  { key: 'stuckScheduled', title: 'Stuck' },
  { key: 'approvedUnscheduled', title: 'Approved · unscheduled' },
  { key: 'generating', title: 'Generating' },
  { key: 'scheduled', title: 'Scheduled' },
  { key: 'published', title: 'Recently published' },
]

function Thumb({ url }: { url?: string | null }) {
  const box: React.CSSProperties = {
    width: 44, height: 44, borderRadius: 10, flex: 'none',
    background: 'var(--surface2)', objectFit: 'cover',
  }
  if (!url) return <div style={box} />
  return <img style={box} src={url} alt="" />
}

function Card({ draft, actionable, refresh }: {
  draft: ContentDraft; actionable: boolean; refresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirm()

  async function onApprove() {
    const ok = await confirm({
      title: 'Approve this draft?',
      message: 'Marks approved. Nothing publishes — scheduling stays on the board.',
      confirmText: 'Approve',
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await approveDraft(draft.id); refresh() }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  async function onSkip() {
    const ok = await confirm({
      title: 'Skip this draft?',
      message: "Marks it disqualified. It won't be scheduled or generated from again.",
      confirmText: 'Skip',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await skipDraft(draft.id); refresh() }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="log-r">
      <Thumb url={draft.image_urls?.[0]} />
      <div className="log-mid">
        <div className="log-top">
          <span className="log-nm">{draft.title || draft.topic || 'Untitled'}</span>
          <span className="log-chip" style={{ background: 'var(--surface3)', color: 'var(--text2)' }}>
            {(draft.type || 'post').toUpperCase()}
          </span>
        </div>
        {draft.topic && draft.title && <div className="log-snip">{draft.topic}</div>}
        {error && <div className="err">{error}</div>}
        {actionable && (
          <div className="ops-ac" style={{ marginTop: 8 }}>
            <div className="btn s" onClick={busy ? undefined : onSkip}>{busy ? '…' : 'Skip'}</div>
            <div className="btn p" onClick={busy ? undefined : onApprove}>{busy ? '…' : 'Approve'}</div>
          </div>
        )}
      </div>
      <span className="log-tm">{timeAgo(draft.updated_at)}</span>
    </div>
  )
}

function CollapsibleSection({ title, count, open, onToggle, children }: {
  title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <>
      <div className="ops-sechdr" onClick={onToggle}>
        <span>{title} · {count}</span>
        <span className="chev">{open ? '⌄' : '›'}</span>
      </div>
      {open && <div style={{ padding: '0 16px' }}>{children}</div>}
    </>
  )
}

// Content segment of the Work tab. Ivan review cards get Approve/Skip (the
// only two writes lib/content.ts allows, D6/D11) behind the app's confirm
// pattern; Rise is read-only ambient visibility for Ivan — client-facing
// decisions stay on the client board (D7).
export function ContentQueue() {
  const [lane, setLane] = useState<ContentLane>('ivan')
  const { buckets, matched, laneTotal, loading, error, refresh } = useContent(lane)
  const [otherOpen, setOtherOpen] = useState(false)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, refresh)

  const totalShown = SECTIONS.reduce((n, s) => n + buckets[s.key].length, 0)
  const otherCount = buckets.unknown.length + buckets.archived.length
  // Filtered-to-zero is a different failure than genuinely empty (D10 /
  // blank-board #5): the lane has rows, the recent-or-active filter just ate
  // all of them — that reads as a broken query, not a quiet designed state.
  const scopedZeroButLaneHasRows = totalShown === 0 && otherCount === 0
    && (laneTotal ?? 0) > 0 && (matched ?? 0) === 0

  return (
    <>
      <div className="nav">
        <div className="row-top"><h2>Content</h2><div className="avatar-me">IM</div></div>
        <div className="chips">
          {LANES.map(l => (
            <span key={l.key} className={`chip ${lane === l.key ? 'on' : ''}`} onClick={() => setLane(l.key)}>
              {l.label}
            </span>
          ))}
        </div>
      </div>
      {lane === 'risedtc' && (
        <div className="ov-note" style={{ margin: '8px 16px 0' }}>
          Client lane · read-only. Client-facing decisions stay on the client board.
        </div>
      )}
      {loading && totalShown === 0 && otherCount === 0 ? (
        <div className="rows"><div className="empty">Loading…</div></div>
      ) : error ? (
        <div className="rows"><div className="empty">{error}</div></div>
      ) : (
        <div className="rows" ref={rowsRef}>
          <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
          {totalShown === 0 && otherCount === 0 ? (
            <div className="empty">
              {scopedZeroButLaneHasRows
                ? `${laneTotal} drafts exist outside these filters`
                : 'Nothing waiting here.'}
            </div>
          ) : (
            SECTIONS.map(s => buckets[s.key].length > 0 && (
              <div key={s.key}>
                <div className="ops-sechdr" style={{ cursor: 'default' }}>
                  <span>{s.title} · {buckets[s.key].length}</span>
                </div>
                <div style={{ padding: '0 16px' }}>
                  {buckets[s.key].map(d => (
                    <Card key={d.id} draft={d} actionable={s.key === 'review' && lane === 'ivan'} refresh={refresh} />
                  ))}
                </div>
              </div>
            ))
          )}
          <CollapsibleSection title="Other" count={otherCount} open={otherOpen} onToggle={() => setOtherOpen(o => !o)}>
            {[...buckets.unknown, ...buckets.archived].map(d => (
              <Card key={d.id} draft={d} actionable={false} refresh={refresh} />
            ))}
          </CollapsibleSection>
        </div>
      )}
    </>
  )
}
