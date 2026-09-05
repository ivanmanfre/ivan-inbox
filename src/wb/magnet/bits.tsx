/* ==========================================================================
   The agent-written-value renderers the magnet window needs.

   Copied from `src/exp/v2c/ContentBits.tsx`. Two of them exist because of a
   CONFIRMED live crash: an agent-written column is a jsonb object on many rows
   and the shipped pane pushed it straight into a JSX child, which throws
   "Objects are not valid as a React child" and blanks the pane. Every
   agent-written value here goes through <Val>, which renders a shape
   structurally instead of trusting a type annotation the database never
   agreed to.
   ========================================================================== */
import type { ReactNode } from 'react'
import { KV } from '../kit'
import './magnet.css'

// An agent-written object key humanised to its SHAPE only (underscores to
// spaces, sentence case), never to a fixed vocabulary: the roster of keys an
// agent writes into a payload is the data's to name, not this file's.
function humanizeKey(k: string): string {
  const spaced = k.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function Val({ v }: { v: unknown }): ReactNode {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    return (
      <div className="a-mg-vlist">
        {v.map((x, i) => <div className="a-mg-vli" key={i}><Val v={x} /></div>)}
      </div>
    )
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== null && x !== undefined && x !== '')
    if (entries.length === 0) return null
    return (
      <KV rows={entries.map(([k, x]) => [humanizeKey(k), <Val v={x} key={k} />])} />
    )
  }
  return String(v)
}

/** A labelled block inside a column of the reader. */
export function Block({ label, tail, children }: { label: string; tail?: ReactNode; children: ReactNode }) {
  return (
    <div className="a-mg-block">
      <div className="a-mg-block-h">
        <span className="a-eyebrow">{label}</span>
        {tail && <span className="a-mg-block-t">{tail}</span>}
      </div>
      {children}
    </div>
  )
}

/** A card of prose an agent wrote, preserved as it was typed. */
export function Prose({ text }: { text: string }) {
  return <div className="a-mg-card"><div className="a-pre">{text}</div></div>
}
