// One list row (mock `.q`): name + company, a line of mono tags then the text, and on the right a
// lime age, a date, or one verb. Every conversation row carries data-d-row (the deploy check's
// contract) and opens the thread on tap / Enter.
import type { KeyboardEvent, ReactNode } from 'react'
import type { RowTag } from './model'

type Props = {
  id: string
  name: string
  company?: string | null
  tags?: RowTag[]
  line?: ReactNode
  right?: ReactNode
  rightKind?: 'needs' | 'later' | 'fu' | 'plain'
  verbs?: RowVerb[]
  selected?: boolean
  checked?: boolean
  dim?: boolean
  /** A conversation row (opens a thread). Came-back and warm rows without a thread pass false. */
  conversation?: boolean
  onOpen?: () => void
  /** Unread inbound on the thread: a lime dot before the name (today's unread dot). */
  unread?: boolean
  /** The row's ⋯ key (Sum up, Copy chat link, Ask Claude, Discard): always drawn, never hover-only. */
  onMore?: () => void
  /** The Sum up line under the row, once Claude has read it. */
  note?: ReactNode
  /** A quiet signal beside the name ("came back · 2d"), its tooltip what they came back to. */
  signal?: { text: string; title: string } | null
}

export type RowVerb = { label: string; verb: string; run: () => void; busy?: boolean; quiet?: boolean }

export function Row({ id, name, company, tags = [], line, right, rightKind = 'plain', verbs, selected, checked, dim, conversation = true, onOpen, unread, onMore, note, signal }: Props) {
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && onOpen) { e.preventDefault(); onOpen() } }
  return (
    <div
      className={`dm-q${selected ? ' dm-sel' : ''}${dim ? ' dm-dim' : ''}${checked ? ' dm-checked' : ''}${rightKind === 'needs' ? ' dm-owed' : ''}`}
      data-d-row={conversation ? id : undefined}
      data-pid={id}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={onKey}
    >
      <div className="dm-qm">
        <div className="dm-n">{checked && <span className="dm-tick" aria-label="selected">✓</span>}{unread && <span className="dm-dot" role="img" aria-label="unread" />}{name}{signal && <span className="dm-sig" title={signal.title}>{signal.text}</span>}{company ? <span> {company}</span> : null}</div>
        <div className="dm-s">
          {tags.map((t, i) => <span key={i} className={`dm-tag dm-tag-${t.kind}`}>{t.text}</span>)}
          {line}
        </div>
        {note != null && <span className="dm-qnote" role="status">{note}</span>}
      </div>
      {verbs && verbs.length ? (
        <span className="dm-qvs">{verbs.map(v => (
          <button key={v.verb} type="button" className={`dm-qv${v.quiet ? ' dm-qv-q' : ''}`} data-verb={v.verb} disabled={v.busy}
            onClick={e => { e.stopPropagation(); v.run() }}>{v.busy ? '…' : v.label}</button>
        ))}</span>
      ) : right != null && right !== '' ? <time className={`dm-t-${rightKind}`}>{right}</time> : null}
      {onMore && <button type="button" className="dm-qmore" aria-label={`More for ${name}`} data-verb="row-more" onClick={e => { e.stopPropagation(); onMore() }}>⋯</button>}
    </div>
  )
}

export function Sec({ label, n, tail }: { label: ReactNode; n?: ReactNode; tail?: ReactNode }) {
  return <div className="dm-sec"><span>{label}</span><span>{tail ?? n}</span></div>
}

export function Quiet({ children }: { children: ReactNode }) {
  return <div className="dm-quiet">{children}</div>
}

export function Fold({ label, open, count, onToggle, verb }: { label: ReactNode; open: boolean; count: number; onToggle: () => void; verb: string }) {
  return (
    <button type="button" className="dm-fold" aria-expanded={open} data-verb={verb} onClick={onToggle}>
      <span>{label}</span><span>{open ? 'Hide' : 'Show'} {count}</span>
    </button>
  )
}
