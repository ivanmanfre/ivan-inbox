import type { PendingCardState } from '../../wb/ops/usePendingCard'

// An Arch comment's verdict reasoning, on the card itself (today's "Why, and
// what it read" fold, main PendingCard 755-786). Never gated on comment_id:
// Arch rows without one still carry why the drafter said what it said.
export function ArchWhy({ st }: { st: PendingCardState }) {
  if (!st.isArchComment || (!st.archReason && st.archSrc.length === 0)) return null
  return (
    <details className="op-why">
      <summary className="op-cap">Why, and what it read</summary>
      {st.archReason && <p>{st.archReason}</p>}
      {st.archOut === 'DRAFT' && st.archBasis && <p>Rests on: {st.archBasis}</p>}
      {st.archCaution && <p><i>Check first:</i> {st.archCaution}</p>}
      {st.archSrc.map(s => (
        <div className="op-src" key={s.id}>
          <span>{s.title}</span>
          <em>{s.source_type} · {s.public ? 'public' : 'private, context only'}</em>
        </div>
      ))}
    </details>
  )
}
