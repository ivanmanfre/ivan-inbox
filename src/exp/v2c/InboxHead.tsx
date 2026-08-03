import { inboxBreakdown, STATUS_LABEL, type Status, type Thread, type ThreadBucket } from '../../lib/inbox'
import { StackBar, relAge } from './Surface'

// What is actually in the list, drawn — AND the control that filters it.
//
// Ask 11 (morning) — the head used to bucket by raw unread ("they replied" =
// any unread row), which counted 28 already-answered threads as waiting. It
// renders the SAME non-overlapping buckets the badge sums (inboxBreakdown):
// replies to answer, drafts to approve, threads the reply detector flagged
// needs_manual_reply, and conversations simply waiting on them. The bar is the
// badge, decomposed — they derive from one function and cannot disagree.
//
// Density ask (afternoon) — the Inbox job was removed and DMs absorbed the
// conversation list, so this bar is now also the STATUS AXIS. Each key is a
// filter, and every one of them reads `threadBucket` — the same function the bar
// and the badge read — so clicking a segment cannot produce a list whose length
// disagrees with the number printed on it. Clicking the active one returns to
// "needs you", the default view, which is exactly what the badge counts.
//
// Severity discipline: none of these are warnings — every bucket reads a
// CATEGORICAL token (phase-2 review F19-family: the reply/answer segment takes
// cat-1 lime, drafts cat-3 white-as-data, flagged cat-2 orange, waiting stays
// the inert track colour). No severity hex, no legacy blue.
export function InboxHead({ threads, loadedAt, status, setStatus }: {
  threads: Thread[]
  loadedAt: string | null
  status: Status
  setStatus: (s: Status) => void
}) {
  const b = inboxBreakdown(threads)
  // The bar is the PENDING side only — 'waiting on them' rows left the surface
  // (Ivan, 2026-08-03), so a segment for them would advertise a view that no
  // longer exists. The count itself stays in the footer, because 65
  // conversations quietly vanishing is its own kind of lie.
  const total = b.answer + b.approve + b.flagged
  const parts: { key: ThreadBucket; n: number; color: string }[] = [
    { key: 'answer', n: b.answer, color: 'var(--cat-1)' },
    { key: 'approve', n: b.approve, color: 'var(--cat-3)' },
    { key: 'flagged', n: b.flagged, color: 'var(--cat-2)' },
  ]
  // Which keys the CURRENT view includes. 'needs' and 'all' are now the same
  // three pending buckets; a single bucket lights only itself.
  const lit = (k: ThreadBucket) =>
    status === 'all' || status === 'needs' ? true : status === k
  const pick = (s: Status) => setStatus(status === s ? 'needs' : s)
  const keyProps = (s: Status, isOn: boolean) => ({
    className: `wb-ihead-i tap${isOn ? ' on' : ''}`,
    role: 'button',
    tabIndex: 0,
    'aria-pressed': status === s,
    onClick: () => pick(s),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(s) }
    },
  })

  return (
    <div className="wb-ihead">
      <StackBar parts={parts.map(p => ({ ...p, key: STATUS_LABEL[p.key] }))} />
      <div className="wb-ihead-k">
        {parts.filter(p => p.n > 0).map(p => (
          <span key={p.key} {...keyProps(p.key, lit(p.key))}>
            <span className="wb-ihead-d" style={{ background: p.color }} />
            <b>{p.n}</b> {STATUS_LABEL[p.key].toLowerCase()}
          </span>
        ))}
        <span {...keyProps('all', status === 'all')}>
          <b>{total}</b> pending
        </span>
        <span className="wb-ihead-f">
          <span className="wb-ok-dot" />
          {b.waiting > 0 && `${b.waiting} answered, waiting on them · search finds them · `}
          sends live in Sends · {relAge(loadedAt)}
        </span>
      </div>
    </div>
  )
}
