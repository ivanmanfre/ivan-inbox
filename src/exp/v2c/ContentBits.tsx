import { type ReactNode } from 'react'
import type { Facet, FilterState } from '../../lib/contentFilters'

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

/**
 * The filter bar.
 *
 * Rules it encodes (AFFORDANCES §3), all of which are about not lying:
 *  - facets come from the loaded rows, so nothing here is a hardcoded list;
 *  - a filter always shows BOTH numbers, and says so when the server's exact
 *    count exceeds what the page holds;
 *  - no filter is a default — a default filter is a hidden row;
 *  - filters are dropped on a lane switch by the caller, because a filter
 *    carried across lanes hides rows in a vocabulary that does not match.
 */
export function FilterBar({ facets, state, setState, shown, loaded, total, noun }: {
  facets: Facet[]
  state: FilterState
  setState: (s: FilterState) => void
  shown: number
  loaded: number
  total: number | null
  noun: string
}) {
  const active = Object.entries(state).filter(([, v]) => !!v)
  if (facets.length === 0 && active.length === 0) return null
  const toggle = (key: string, value: string) => {
    const next = { ...state }
    if (next[key] === value) delete next[key]
    else next[key] = value
    setState(next)
  }
  return (
    <div className="ct-filters">
      <div className="ct-fbar">
        {facets.map(f => (
          <div className="ct-fg" key={f.key}>
            <span className="ct-fgl">{f.label}</span>
            {f.options.map(o => (
              <span
                className={`ct-f${state[f.key] === o.value ? ' on' : ''}`}
                key={o.value}
                onClick={() => toggle(f.key, o.value)}
              >
                {o.label}<i>{o.n}</i>
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="ct-fnote">
        {active.length > 0
          ? <>
            <b>{shown}</b> of {loaded} {noun} shown
            <span className="ct-fclear" onClick={() => setState({})}>clear</span>
          </>
          : <>{loaded} {noun}</>}
        {total !== null && total > loaded && (
          // PostgREST caps a SELECT at 1000 long before a header count notices,
          // so a filter that ran over the page must never imply it ran over the
          // whole lane.
          <span className="ct-fcap">filtering the {loaded} loaded of {total} in the database</span>
        )}
      </div>
    </div>
  )
}

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
