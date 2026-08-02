import type { Thread } from '../../lib/inbox'
import { StackBar, relAge } from './Surface'

// What is actually in the list, drawn.
//
// The inbox is ~1,354 rows and nine of them are visible. Before this the only way
// to know whether anything in there needed Ivan was to scroll it: the unread count
// rode as a suffix on the "All" chip and nothing said how much of the list was a
// draft waiting versus a message waiting versus already handled. The list column
// on a workbench is a working surface, so it says what it holds — and it is the
// list's visual encoding, which a column of rows on its own does not have.
//
// Severity discipline: none of these are warnings. "They replied" is blue
// (an action), "draft ready" is accent (clear), "waiting on them" is inert grey.
// Amber and red stay reserved for something being wrong.
export function InboxHead({ threads, loadedAt, onOpenDrafts }: {
  threads: Thread[]
  loadedAt: string | null
  onOpenDrafts: () => void
}) {
  const replied = threads.filter(t => t.unread > 0).length
  const ready = threads.filter(t => t.draft !== null && t.unread === 0).length
  const waiting = threads.length - replied - ready
  const parts = [
    { key: 'They replied', n: replied, color: 'var(--blue)' },
    { key: 'Draft ready', n: ready, color: 'var(--accent)' },
    { key: 'Waiting on them', n: waiting, color: 'var(--surface3)' },
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
          {threads.length} threads · {relAge(loadedAt)}
        </span>
      </div>
    </div>
  )
}
