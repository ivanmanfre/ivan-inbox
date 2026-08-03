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
// Severity discipline: none of these are warnings. "To answer" is blue (an
// action), "draft ready" is accent (clear), "flagged" wears the cat-2 data
// colour (an action the detector asked for, not an alarm), waiting is inert.
export function InboxHead({ threads, loadedAt, onOpenDrafts }: {
  threads: Thread[]
  loadedAt: string | null
  onOpenDrafts: () => void
}) {
  const b = inboxBreakdown(threads)
  const total = b.answer + b.approve + b.flagged + b.waiting
  const parts = [
    { key: 'To answer', n: b.answer, color: 'var(--blue)' },
    { key: 'Draft ready', n: b.approve, color: 'var(--accent)' },
    { key: 'Flagged: needs your reply', n: b.flagged, color: 'var(--cat-2, var(--blue))' },
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
