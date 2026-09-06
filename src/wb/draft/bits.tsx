/* ==========================================================================
   src/wb/draft/bits.tsx — the register primitives the evidence rail is made of.

   Ported from src/exp/v2c/{ContentBits,Register}.tsx, on `src/ds`. Every rule
   these carried is kept and every string is the one that was there:

     · a REGISTER IS A DOCUMENT, not a card: nothing is dropped;
     · a FOLD announces what it holds and what it costs to open, so a reader
       always knows the thing exists (the silent clamp is what it replaced);
     · a CLAMP is not a fold: it shows the prose and stops, and it only draws a
       control when the text actually overflows;
     · a status is a CHIP, and the tones are the system's three severities ,
       a live gate refusal is a live signal, not a category.
   ========================================================================== */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, Chip, Icon } from '../../ds'
import './draft.css'

function humanizeKey(k: string): string {
  const spaced = k.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** PASS is clear, FAIL and HALT are urgent, anything else stated is attention. */
export function chipTone(status: string | null): 'neutral' | 'clear' | 'attention' | 'urgent' {
  if (status === 'PASS' || status === 'APPROVED') return 'clear'
  if (status === 'FAIL' || status === 'HALT') return 'urgent'
  if (status) return 'attention'
  return 'neutral'
}

export function Val({ v }: { v: unknown }): ReactNode {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    return (
      <span className="a-dw-vlist">
        {v.map((x, i) => <span className="a-dw-vli" key={i}><Val v={x} /></span>)}
      </span>
    )
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== null && x !== undefined && x !== '')
    if (entries.length === 0) return null
    return (
      <span className="a-dw-vobj">
        {entries.map(([k, x]) => (
          <span className="a-dw-vrow" key={k}>
            <span className="a-eyebrow">{humanizeKey(k)}</span>
            <span className="a-dw-vv"><Val v={x} /></span>
          </span>
        ))}
      </span>
    )
  }
  return String(v)
}

/** A titled block: an eyebrow with an optional headline fact, then its body. */
export function Block({ label, tail, children }: { label: string; tail?: ReactNode; children: ReactNode }) {
  return (
    <section className="a-dw-block">
      <div className="a-dw-block-h">
        <span className="a-eyebrow">{label}</span>
        {tail && <span className="a-mono a-dim">{tail}</span>}
      </div>
      {children}
    </section>
  )
}

/** A well: a surface a body of evidence rests in, never a second boundary. */
export function Well({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`a-dw-well${className ? ` ${className}` : ''}`}>{children}</div>
}

/** Verbatim prose, wrapped, in the reading register. */
export function Pre({ children }: { children: ReactNode }) {
  return <div className="a-dw-pre">{children}</div>
}

/**
 * A label/value register. Values are ReactNode where the caller has already
 * decided how to draw them; `KeyRows` wraps a raw value in `Val` first, so a
 * register never receives a bare database value.
 */
export function Rows({ items }: { items: [string, ReactNode][] }) {
  if (items.length === 0) return null
  return (
    <dl className="a-dw-rows">
      {items.map(([k, v], i) => (
        <span key={`${k}-${i}`} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </span>
      ))}
    </dl>
  )
}

// Every remaining key of an agent-written object, rendered rather than dropped.
// The roster is the data's: an unnamed key appears the day it appears, so this
// only humanises the SHAPE of the key (underscores, sentence case), it never
// invents a fixed vocabulary for keys `labels.ts` has never seen.
export function KeyRows({ items }: { items: [string, unknown][] }) {
  if (items.length === 0) return null
  return <Rows items={items.map(([k, v]) => [humanizeKey(k), <Val v={v} key={k} />])} />
}

/**
 * The fold. It states its own label AND what it holds, so a reader knows the
 * block exists and what opening it costs. The caret is the system's disclose
 * icon; the old `›` was a unicode glyph doing an icon's job.
 */
export function Fold({ label, tail, children, defaultOpen }: {
  label: string; tail?: ReactNode; children: ReactNode; defaultOpen?: boolean
}) {
  return (
    <details className="a-dw-fold" open={defaultOpen}>
      <summary>
        <Icon name="forward" size={16} className="a-dw-caret" />
        <span className="a-dw-fold-k">{label}</span>
        {tail && <span className="a-mono a-dim a-dw-fold-t">{tail}</span>}
      </summary>
      <div className="a-dw-fold-b">{children}</div>
    </details>
  )
}

/**
 * A CLAMP, WHICH IS NOT A FOLD. The judge's summary is the one piece of prose
 * that IS the verdict, so it is never folded: this shows the prose and stops.
 * It only ever renders a control when the text actually overflows the clamp —
 * a "more" under nine lines is a lie about there being a tenth.
 */
export function Clamp({ lines, children, chars }: { lines: number; children: ReactNode; chars: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // scrollHeight against clientHeight while clamped — the only honest test,
    // because a character count cannot know the rail's width.
    setOver(el.scrollHeight - el.clientHeight > 4)
  }, [children])
  return (
    <>
      <div
        ref={ref}
        className="a-dw-clamp"
        data-open={open ? '' : undefined}
        style={open ? undefined : { WebkitLineClamp: lines }}
      >
        {children}
      </div>
      {(over || open) && (
        <Button variant="quiet" size="sm" onClick={() => setOpen(o => !o)}>
          {open ? 'Show less' : `Show all ${chars.toLocaleString()} characters`}
        </Button>
      )}
    </>
  )
}

/** A status mark: the register's one severity carrier. */
export function Mark({ status, children }: { status: string | null; children: ReactNode }) {
  return <Chip tone={chipTone(status)}>{children}</Chip>
}

/** A count, said with its predicate. */
export function Count({ children, label }: { children: ReactNode; label: string }) {
  return <Badge label={label}>{children}</Badge>
}
