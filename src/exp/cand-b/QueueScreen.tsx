import { useEffect, useRef, useState } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import type { ContentBucketName, ContentBuckets, ContentDraft, ContentLane } from '../../lib/content'
import { ContentCard } from './ContentCard'
import { ago } from './format'

// D5 order — nothing filtered invisible. 'archived' + the collapsed "Other"
// (unknown statuses) come after it so a vocabulary the engine grows post-hoc
// still has somewhere to land instead of vanishing off every filtered view.
const ORDER: { key: ContentBucketName; label: string }[] = [
  { key: 'review', label: 'Needs review' },
  { key: 'error', label: 'Errors' },
  { key: 'stuckScheduled', label: 'Stuck' },
  { key: 'approvedUnscheduled', label: 'Approved, unscheduled' },
  { key: 'generating', label: 'Generating' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
  { key: 'archived', label: 'Archived' },
]

const ACTIONABLE: ContentBucketName[] = ['review', 'error', 'stuckScheduled', 'approvedUnscheduled']

function PlainRow({ draft }: { draft: ContentDraft }) {
  return (
    <div className="log-r">
      <div className="log-mid">
        <div className="log-top"><span className="log-nm">{draft.title || draft.topic || 'Untitled'}</span></div>
        {draft.post_body && <div className="log-snip">{draft.post_body}</div>}
      </div>
      <span className="log-tm">{ago(draft.updated_at)}</span>
    </div>
  )
}

function Section({ title, count, open, onToggle, children }: {
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

// Pushed from a Content bucket tile — the full backlog behind whichever tile
// was tapped, scrolled straight to it. Genuinely-empty (laneTotal===0) and
// filtered-to-zero (buckets empty but laneTotal>0) render two different
// messages on purpose (D10/blank-board #5): a calm empty board and a broken
// query must never look the same.
export function QueueScreen({ lane, bucket, buckets, laneTotal, loading, error, refresh, onApproved, onBack }: {
  lane: ContentLane
  bucket: ContentBucketName
  buckets: ContentBuckets
  laneTotal: number | null
  loading: boolean
  error: string | null
  refresh: () => void
  onApproved: () => void
  onBack: () => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = { unknown: bucket === 'unknown' }
    for (const b of ORDER) init[b.key] = ACTIONABLE.includes(b.key) || b.key === bucket
    return init
  })
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())

  useEffect(() => {
    const el = sectionRefs.current[bucket]
    if (el) el.scrollIntoView({ block: 'start' })
    // Only on mount / when the requested bucket changes — not on every data
    // refresh, or a pull-to-refresh would yank the scroll position back up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket])

  const totalRows = ORDER.reduce((n, { key }) => n + buckets[key].length, 0) + buckets.unknown.length
  const brokenEmpty = totalRows === 0 && (laneTotal ?? 0) > 0
  const genuineEmpty = totalRows === 0 && (laneTotal ?? 0) === 0

  return (
    <>
      <div className="t-nav">
        <span className="back" onClick={onBack}>‹</span>
        <div className="who"><div className="n">{lane === 'ivan' ? 'Ivan' : 'Rise'} content</div></div>
      </div>
      <div className="rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {error && <div className="td-banner">{error}</div>}
        {!error && loading && totalRows === 0 && <div className="empty">Loading…</div>}
        {!error && !loading && genuineEmpty && <div className="empty">No content in this lane right now.</div>}
        {!error && !loading && brokenEmpty && (
          <div className="empty">{laneTotal} draft{laneTotal === 1 ? '' : 's'} exist outside these filters.</div>
        )}
        {ORDER.map(({ key, label }) => (
          <div key={key} ref={el => { sectionRefs.current[key] = el }}>
            <Section
              title={label}
              count={buckets[key].length}
              open={open[key]}
              onToggle={() => setOpen(o => ({ ...o, [key]: !o[key] }))}
            >
              {key === 'review'
                ? buckets[key].map(d => <ContentCard key={d.id} draft={d} lane={lane} onChanged={onApproved} />)
                : buckets[key].map(d => <PlainRow key={d.id} draft={d} />)}
            </Section>
          </div>
        ))}
        <div ref={el => { sectionRefs.current.unknown = el }}>
          <Section
            title="Other"
            count={buckets.unknown.length}
            open={open.unknown}
            onToggle={() => setOpen(o => ({ ...o, unknown: !o.unknown }))}
          >
            {buckets.unknown.map(d => <PlainRow key={d.id} draft={d} />)}
          </Section>
        </div>
      </div>
    </>
  )
}
