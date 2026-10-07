// One list row (mock `.q`): name + company, a line of mono tags then the text, and on the right a
// lime age, a date, or one verb. Every conversation row carries data-d-row (the deploy check's
// contract) and opens the thread on tap / Enter.
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import type { RowTag } from './model'
import { initials, type PillTone } from './v4/pill'

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
  /** Brief 4 (skin section `dms`): the v4 anatomy. Same root contract, same handlers. */
  v4?: boolean
  /** v4 timeline rows: the left time column (HH:MM). Rows with it draw no avatar. */
  pre?: ReactNode
  /** v4: a status pill on line 2 (owner hold, Due / Estimated / Scheduled return). */
  pill?: { text: string; tone: PillTone; title?: string } | null
  /** v4: position among the rows on screen, for the entrance stagger. */
  index?: number
}

export type RowVerb = { label: string; verb: string; run: () => void; busy?: boolean; quiet?: boolean }

export function Row(p: Props) {
  if (p.v4) return <RowV4 {...p} />
  const { id, name, company, tags = [], line, right, rightKind = 'plain', verbs, selected, checked, dim, conversation = true, onOpen, unread, onMore, note, signal } = p
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

/** The v4 row (SPEC-dms §2.3.3): avatar 28 · name + age · pill + line + ⋯. The name stays a direct
 *  text node of .dm-n (the deploy check reads text nodes only); avatar, dot and tick sit outside it.
 *  No hooks: Row picks this at its top, before any hook could exist. */
function RowV4({ id, name, company, tags = [], line, right, rightKind = 'plain', verbs, selected, checked, dim, conversation = true, onOpen, unread, onMore, note, signal, pre, pill, index }: Props) {
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && onOpen) { e.preventDefault(); onOpen() } }
  const timeline = pre != null
  const hasVerbs = Boolean(verbs && verbs.length)
  return (
    <div
      className={`dm-q dx-row${timeline ? ' dx-row-t' : ''}${selected ? ' dm-sel' : ''}${dim ? ' dm-dim' : ''}${checked ? ' dm-checked' : ''}${rightKind === 'needs' ? ' dm-owed' : ''}${line == null || line === '' ? ' dx-row-1' : ''}`}
      data-d-row={conversation ? id : undefined}
      data-pid={id}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={onKey}
      style={index != null ? { '--i': Math.min(index, 10) } as CSSProperties : undefined}
    >
      {unread && <span className="dm-dot" role="img" aria-label="unread" />}
      {timeline ? <time className="dx-pre">{pre}</time>
        : checked ? <span className="dx-av dx-av-on" role="img" aria-label="selected">✓</span>
          : <span className="dx-av" aria-hidden="true">{initials(name)}</span>}
      <div className="dm-n">{name}{signal && <span className="dm-sig" title={signal.title}>{signal.text}</span>}{company ? <span className="dx-co"> {company}</span> : null}</div>
      {timeline
        ? pill && <span className={`dx-pill dx-pill-${pill.tone}`} title={pill.title}>{pill.text}</span>
        : !hasVerbs && right != null && right !== '' ? <time className={`dx-t dm-t-${rightKind}`}>{right}</time> : <span className="dx-t" />}
      {(line != null && line !== '') || (!timeline && (pill || tags.length > 0)) ? (
        <div className="dm-s">
          {!timeline && pill && <span className={`dx-pill dx-pill-${pill.tone}`} title={pill.title}>{pill.text}</span>}
          {tags.map((t, i) => <span key={i} className={`dm-tag dm-tag-${t.kind}`}>{t.text}</span>)}
          {line}
        </div>
      ) : null}
      {hasVerbs ? (
        <span className="dm-qvs">{verbs!.map(v => (
          <button key={v.verb} type="button" className={`dm-qv${v.quiet ? ' dm-qv-q' : ''}`} data-verb={v.verb} disabled={v.busy}
            onClick={e => { e.stopPropagation(); v.run() }}>{v.busy ? '…' : v.label}</button>
        ))}</span>
      ) : onMore ? <button type="button" className="dm-qmore" aria-label={`More for ${name}`} title={`More for ${name}`} data-verb="row-more" onClick={e => { e.stopPropagation(); onMore() }}>⋯</button> : null}
      {note != null && <span className="dm-qnote" role="status">{note}</span>}
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
