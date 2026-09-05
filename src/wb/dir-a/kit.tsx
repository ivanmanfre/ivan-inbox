/* ==========================================================================
   src/wb/dir-a/kit.tsx — the parts every Direction A screen shares.

   These are compositions of `src/ds` primitives and the `dir-a.css` classes,
   not new primitives: nothing here invents a colour, a size or a radius, and
   nothing here holds state or touches data. A screen imports Screen/Group/Row
   and spends its own code on the ledger it has to keep.
   ========================================================================== */
import type { CSSProperties, ReactNode } from 'react'
import { Icon, type IconName } from '../../ds'
import './dir-a.css'
import '../../ds/ds.css'

export type Tone = 'accent' | 'clear' | 'attention' | 'urgent' | 'quiet'

/* The screen frame: a compact sticky head over a scrolling body. `ds-body`
   rides on the root so the focus ring and the reduced-motion collapse reach
   everything inside without `body` taking the system's ground colour. */
export function Screen({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`a-root ds-body${className ? ` ${className}` : ''}`}>{children}</div>
}

export function Head({ title, sub, lead, tail, children }: {
  title?: ReactNode
  sub?: ReactNode
  lead?: ReactNode
  tail?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="a-head">
      {lead}
      {(title || sub) && (
        <div className="a-head-t">
          {title && <h2 className="a-head-title">{title}</h2>}
          {sub && <div className="a-head-sub">{sub}</div>}
        </div>
      )}
      {children}
      {tail && <div className="a-head-tail">{tail}</div>}
    </div>
  )
}

/** The thin second bar under the head: filters, stage tabs, a range. */
export function Bar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`a-bar${className ? ` ${className}` : ''}`}>{children}</div>
}

export function Body({ flush, className, children, innerRef, onScroll }: {
  flush?: boolean
  className?: string
  children: ReactNode
  innerRef?: React.Ref<HTMLDivElement>
  onScroll?: React.UIEventHandler<HTMLDivElement>
}) {
  return (
    <div
      className={`a-body${className ? ` ${className}` : ''}`}
      data-flush={flush ? '' : undefined}
      ref={innerRef}
      onScroll={onScroll}
    >{children}</div>
  )
}

/** A grouped container. The eyebrow bar is drawn only when it is given a label. */
export function Group({ label, tail, foot, pad, quiet, stickyHead, className, style, children }: {
  label?: ReactNode
  tail?: ReactNode
  foot?: ReactNode
  pad?: boolean
  quiet?: boolean
  stickyHead?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <section className={`a-group${className ? ` ${className}` : ''}`} data-quiet={quiet ? '' : undefined} style={style}>
      {(label || tail) && (
        <div className="a-group-h" data-sticky={stickyHead ? '' : undefined}>
          {label && <span className="a-eyebrow">{label}</span>}
          {tail && <span className="a-group-tail">{tail}</span>}
        </div>
      )}
      {pad ? <div className="a-group-pad">{children}</div> : children}
      {foot && <div className="a-group-foot">{foot}</div>}
    </section>
  )
}

export function Rows({ className, children, innerRef }: {
  className?: string
  children: ReactNode
  innerRef?: React.Ref<HTMLDivElement>
}) {
  return <div className={`a-rows${className ? ` ${className}` : ''}`} ref={innerRef}>{children}</div>
}

/** The dense hairline row. `actions` appear on hover or focus, inside the row. */
export function Row({
  lead, title, titleWrap, sub, subWrap, meta, tail, actions, sev, unread, selected, focused,
  onClick, title_, className, id, children,
}: {
  lead?: ReactNode
  title?: ReactNode
  titleWrap?: boolean
  sub?: ReactNode
  subWrap?: boolean
  meta?: ReactNode
  tail?: ReactNode
  actions?: ReactNode
  sev?: 'attention' | 'urgent'
  unread?: boolean
  selected?: boolean
  focused?: boolean
  onClick?: () => void
  /** The native tooltip, kept where the screen it came from had one. */
  title_?: string
  className?: string
  id?: string
  children?: ReactNode
}) {
  const inner = (
    <>
      {lead && <span className="a-row-lead">{lead}</span>}
      {(title || sub || meta || children) && (
        <span className="a-row-main">
          {title && <span className="a-row-title" data-wrap={titleWrap ? '' : undefined}>{title}</span>}
          {sub && <span className="a-row-sub" data-wrap={subWrap ? '' : undefined}>{sub}</span>}
          {meta && <span className="a-row-meta">{meta}</span>}
          {children}
        </span>
      )}
      {tail && <span className="a-row-tail">{tail}</span>}
      {actions && <span className="a-row-actions">{actions}</span>}
    </>
  )
  const cls = `a-row${className ? ` ${className}` : ''}`
  const data = {
    'data-sev': sev,
    'data-unread': unread ? '' : undefined,
    'data-selected': selected ? '' : undefined,
    'data-focused': focused ? '' : undefined,
  }
  if (!onClick) return <div className={cls} id={id} title={title_} {...data}>{inner}</div>
  return (
    <div
      className={cls}
      id={id}
      title={title_}
      data-interactive=""
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      {...data}
    >{inner}</div>
  )
}

/** One ledger cell. A number never appears without its predicate. */
export function Cell({ label, value, note, tone, onClick, on, emptyText = 'No reading', children }: {
  label: ReactNode
  value?: ReactNode
  note?: ReactNode
  tone?: Tone
  onClick?: () => void
  on?: boolean
  emptyText?: ReactNode
  children?: ReactNode
}) {
  const body = (
    <>
      <span className="a-cell-l">{label}</span>
      <span className={`a-cell-v${tone ? ` a-sev-${tone}` : ''}`}>
        {value === null || value === undefined || value === '' ? <span className="a-dim-2">{emptyText}</span> : value}
      </span>
      {note && <span className="a-cell-n">{note}</span>}
      {children}
    </>
  )
  if (!onClick) return <div className="a-cell">{body}</div>
  return <button type="button" className="a-cell" data-interactive="" data-on={on ? '' : undefined} onClick={onClick}>{body}</button>
}

export function Ledger({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`a-ledger${className ? ` ${className}` : ''}`}>{children}</div>
}

/** A measured bar with its value on the right. */
export function BarLine({ pct, tone, tail }: { pct: number; tone?: Tone; tail?: ReactNode }) {
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div className="a-barline">
      <span className="a-bartrack"><span className="a-barfill" data-tone={tone} style={{ width: `${w}%` }} /></span>
      {tail !== undefined && <span className="a-mono a-dim">{tail}</span>}
    </div>
  )
}

/** One line whose segments draw the shape of a queue. */
export function StackBar({ segs }: { segs: Array<{ id: string; n: number; tone?: Tone; note?: string }> }) {
  const total = segs.reduce((a, s) => a + s.n, 0)
  if (total <= 0) return <div className="a-stackbar" />
  return (
    <div className="a-stackbar">
      {segs.filter(s => s.n > 0).map(s => (
        <span key={s.id} className="a-stackseg" data-tone={s.tone} title={s.note} style={{ width: `${(s.n / total) * 100}%` }} />
      ))}
    </div>
  )
}

export function Spark({ values, highlightLast }: { values: number[]; highlightLast?: boolean }) {
  const max = Math.max(1, ...values)
  return (
    <span className="a-spark" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className="a-sparkbar"
          data-on={highlightLast && i === values.length - 1 ? '' : undefined}
          style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
        />
      ))}
    </span>
  )
}

export function Dot({ tone, off }: { tone?: Tone; off?: boolean }) {
  return <span className="a-dot" data-tone={tone} data-off={off ? '' : undefined} />
}

export function Sep() { return <span className="a-sep" aria-hidden="true">·</span> }

/** A key/value grid, for a context block. */
export function KV({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="a-kv">
      {rows.map(([k, v], i) => <span key={i} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></span>)}
    </dl>
  )
}

/** An icon with its meta label, the instrument's smallest compound. */
export function Meta({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <span className="a-wrapline">
      {icon && <Icon name={icon} size={16} />}
      <span className="a-mono">{children}</span>
    </span>
  )
}
