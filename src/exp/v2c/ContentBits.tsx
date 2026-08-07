import { type ReactNode } from 'react'

// Shared primitives for the content section.
//
// Two of them exist because of a CONFIRMED live crash: `source_detail` is a
// jsonb object on 71 of 282 rows and the shipped pane pushed it straight into a
// JSX child, which throws "Objects are not valid as a React child" and blanks
// the pane. Every agent-written value in this section now goes through <Val>,
// which renders a shape structurally instead of trusting a type annotation the
// database never agreed to.

export function Val({ v }: { v: unknown }): ReactNode {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    return (
      <div className="dd-vlist">
        {v.map((x, i) => <div className="dd-vli" key={i}><Val v={x} /></div>)}
      </div>
    )
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== null && x !== undefined && x !== '')
    if (entries.length === 0) return null
    return (
      <div className="dd-vobj">
        {entries.map(([k, x]) => (
          <div className="dd-vrow" key={k}>
            <span className="dd-vk">{k}</span>
            <span className="dd-vv"><Val v={x} /></span>
          </div>
        ))}
      </div>
    )
  }
  return String(v)
}

export function Block({ label, tail, children }: { label: string; tail?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="res-hdr">{label}{tail && <span className="res-hdr-t">{tail}</span>}</div>
      {children}
    </>
  )
}

// A label/value card. Values are ReactNode where the caller has already decided
// how to draw them, and unknown where it has not — Rows never receives a raw
// database value without a <Val> around it.
export function Rows({ items }: { items: [string, ReactNode][] }) {
  if (items.length === 0) return null
  return (
    <div className="dd-card">
      {items.map(([k, v], i) => (
        <div className="dd-row" key={`${k}-${i}`}>
          <div className="dd-k">{k}</div>
          <div className="dd-v">{v}</div>
        </div>
      ))}
    </div>
  )
}

// Every remaining key of an agent-written object, rendered rather than dropped.
export function KeyRows({ items }: { items: [string, unknown][] }) {
  if (items.length === 0) return null
  return <Rows items={items.map(([k, v]) => [k.replace(/_/g, ' '), <Val v={v} key={k} />])} />
}

// THE FILTER BAR IS GONE (D9, 2026-08-07). It rendered every facet and every
// value of every facet, always, as a permanently-expanded chip browser —
// measured 238px on the phone, stacked directly under `FilterRow`'s pills over
// the SAME facet contract. Two grammars for one control. Its three remaining
// callers (the ideas band, the publish queue, the style roster) now render
// `FilterRow inline`; every count it printed is still printed, per value,
// inside the pill it belongs to.

// The filtered-empty state. An empty result caused by a filter and an empty lane
// must never look the same — the same distinction fetchLaneProbe draws at lane
// level, applied one level down.
export function FilteredEmpty({ noun, onClear }: { noun: string; onClear: () => void }) {
  return (
    <div className="wb-empty">
      <div className="wb-empty-l">No {noun} match this filter.</div>
      <div className="wb-empty-s">The lane is not empty — the filter is.</div>
      <div className="wb-empty-f"><span className="ct-fclear" onClick={onClear}>Clear the filter</span></div>
    </div>
  )
}

// A number with the denominator it was computed over. 28% of Ivan's rows and 36%
// of Mattan's carry no pillar at all, so any figure that hides its own
// denominator here is fabricated (IA §4.2).
export function Figure({ n, of, label }: { n: number; of: number; label: string }) {
  return (
    <span className="ct-fig">
      <b>{n}</b> of {of} {label}
    </span>
  )
}
