import { inboxBreakdown, type Thread } from '../../lib/inbox'
import { StackBar, relAge } from './Surface'

// What is actually in the list, drawn.
//
// Ask 11 — the head used to bucket by raw unread ("they replied" = any unread
// row), which counted 28 already-answered threads as waiting. It now renders
// the SAME non-overlapping buckets the badge sums (inboxBreakdown): replies to
// answer, drafts to approve, threads the reply detector flagged
// needs_manual_reply, and conversations simply waiting on them. The bar is the
// badge, decomposed — they derive from one function and cannot disagree.
//
// Severity discipline: none of these are warnings — every bucket reads a
// CATEGORICAL token (phase-2 review F19-family: the reply/answer segment takes
// cat-1 lime, drafts cat-3 white-as-data, flagged cat-2 orange, waiting stays
// the inert track colour). No severity hex, no legacy blue.
export function InboxHead({ threads, loadedAt, onOpenDrafts }: {
  threads: Thread[]
  loadedAt: string | null
  onOpenDrafts: () => void
}) {
  const b = inboxBreakdown(threads)
  const total = b.answer + b.approve + b.flagged + b.waiting
  const parts = [
    { key: 'To answer', n: b.answer, color: 'var(--cat-1)' },
    { key: 'Draft ready', n: b.approve, color: 'var(--cat-3)' },
    { key: 'Flagged: needs your reply', n: b.flagged, color: 'var(--cat-2)' },
    { key: 'Waiting on them', n: b.waiting, color: 'var(--surface3)' },
  ]
  return (
    <div className="wb-ihead">
      <StackBar parts={parts} />
      <div className="wb-ihead-k">
        {parts.filter(p => p.n > 0).map(p => (
          <span
            className="wb-ihead-i"
            key={p.key}
            onClick={p.key === 'Draft ready' ? onOpenDrafts : undefined}
          >
            <span className="wb-ihead-d" style={{ background: p.color }} />
            <b>{p.n}</b> {p.key.toLowerCase()}
          </span>
        ))}
        <span className="wb-ihead-f">
          <span className="wb-ok-dot" />
          {total} conversation{total === 1 ? '' : 's'} · sends live in Sends · {relAge(loadedAt)}
        </span>
      </div>
    </div>
  )
}
