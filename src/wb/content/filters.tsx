/* ==========================================================================
   THE FILTER ROW — one search field, the pills that are ON, one disclosure.

   Copied from `src/exp/v2c/FilterRow.tsx`. Every rule it encodes survives:
   facets come from the loaded rows and never a hardcoded list; a filter shows
   BOTH numbers and says so when the server's exact count exceeds what the page
   holds; no filter is a default; "Any" is a value rather than an undo; the
   disclosure carries its own scope in its NAME because two rows on this
   surface run filters over two different tables.

   What changed is the chrome: a pill is a ds `Chip`, its panel is a ds
   `Popover` on a pointer canvas and a ds `Sheet` on the phone.
   ========================================================================== */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Facet, FacetOption, FilterState } from '../../lib/contentFilters'
import { Button, Chip, Icon, IconButton, Input, Popover, Sheet } from '../../ds'
import './content.css'

const MOBILE_MQ = '(max-width: 767px)'

function useSheetMode(): boolean {
  const [on, setOn] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const fn = (e: MediaQueryListEvent) => setOn(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return on
}

// Close on Escape and on a click outside. Both, because a popover that only
// closes by clicking the thing that opened it is a trap on a surface where the
// thing that opened it may have scrolled away. Escape is bound in BOTH modes
// (the sheet has its own scrim for the click half, and it must not be the one
// panel on this screen a keyboard cannot close); the key is stopped so it
// closes exactly one layer rather than also dropping the row selection behind
// it.
function useDismiss(open: boolean, close: () => void, outside: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey, true)
    if (outside) document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, close, outside])
  return ref
}

// A panel opened off a pill that sits anywhere in a row inside a narrow column
// will run off the pane's right edge. So it is measured once on open and
// flipped to the right edge if it does not fit, with its height capped to what
// is left below it. Two reads, no loop, no layout animation.
function usePlace(open: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ flip: boolean; maxH: number | null }>({ flip: false, maxH: null })
  useLayoutEffect(() => {
    if (!open) { setPlace({ flip: false, maxH: null }); return }
    const el = ref.current
    if (!el) return
    const pane = el.closest('.a-root') ?? document.documentElement
    const bounds = pane.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const flip = r.right > bounds.right - 4
    const room = Math.floor(window.innerHeight - r.top - 12)
    setPlace({ flip, maxH: room > 140 && room < r.height ? room : null })
  }, [open])
  return { ref, ...place }
}

// One option row, in both the popover and the sheet. The count is the honest
// half of the old wall and it is preserved verbatim: it is the number of loaded
// rows carrying that value, from the same buildFacets derivation.
function OptionRow({ o, on, onPick }: { o: FacetOption; on: boolean; onPick: () => void }) {
  return (
    <button className="a-ct-opt" data-on={on ? '' : undefined} onClick={onPick} type="button">
      <span className="a-ct-opt-l">{o.label}</span>
      <span className="a-ct-opt-t">{o.n}{on ? <Icon name="check" size={16} /> : null}</span>
    </button>
  )
}

function FacetOptions({ f, state, pick }: {
  f: Facet; state: FilterState; pick: (key: string, value: string) => void
}) {
  return (
    <>
      {/* Clearing one facet is a first-class option, not a second control:
          "Any" is the state the facet is in when nothing is picked, so it reads
          as a value rather than as an undo. */}
      <button
        className="a-ct-opt"
        data-on={state[f.key] ? undefined : ''}
        onClick={() => pick(f.key, '')}
        type="button"
      >
        <span className="a-ct-opt-l">Any {f.label.toLowerCase()}</span>
      </button>
      {f.options.map(o => (
        <OptionRow
          key={o.value} o={o} on={state[f.key] === o.value}
          onPick={() => pick(f.key, state[f.key] === o.value ? '' : o.value)}
        />
      ))}
    </>
  )
}

/** One `label: value` chip with its panel. */
function FacetPill({ f, state, setState, sheet }: {
  f: Facet; state: FilterState; setState: (s: FilterState) => void; sheet: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false), !sheet)
  const place = usePlace(open && !sheet)
  const active = state[f.key]
  const label = active
    ? (f.options.find(o => o.value === active)?.label ?? active)
    : 'Any'
  const pick = (key: string, value: string) => {
    const next = { ...state }
    if (value) next[key] = value
    else delete next[key]
    setState(next)
    setOpen(false)
  }
  const body = <FacetOptions f={f} state={state} pick={pick} />
  return (
    <div className="a-ct-fpop" ref={ref}>
      <Chip
        selected={!!active}
        onClick={() => setOpen(v => !v)}
        // The clear affordance only exists once there is something to clear.
        onRemove={active ? () => pick(f.key, '') : undefined}
        removeLabel={`Clear ${f.label.toLowerCase()} filter`}
      >
        {f.label}: <b>{label}</b>
      </Chip>
      {sheet ? (
        <Sheet open={open} onClose={() => setOpen(false)} title={f.label}>{body}</Sheet>
      ) : (
        <Popover
          open={open}
          label={f.label}
          className="a-ct-menu"
          style={place.maxH ? { maxHeight: place.maxH } : undefined}
        >
          <div ref={place.ref} data-flip={place.flip ? '' : undefined}>{body}</div>
        </Popover>
      )}
    </div>
  )
}

/** The disclosure. Every demoted facet in ONE panel, each with the same
    option-with-count rows, and a live badge of how many of them are set. */
function MorePill({ facets, state, setState, sheet, badgeKeys, label }: {
  facets: Facet[]; state: FilterState; setState: (s: FilterState) => void; sheet: boolean
  /** Which facets this pill is allowed to COUNT. It counts what it alone is
      hiding, never the ones already rendered as their own chip beside it. */
  badgeKeys?: string[]
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false), !sheet)
  const place = usePlace(open && !sheet)
  const counted = badgeKeys ? facets.filter(f => badgeKeys.includes(f.key)) : facets
  const n = counted.filter(f => state[f.key]).length
  const pick = (key: string, value: string) => {
    const next = { ...state }
    if (value) next[key] = value
    else delete next[key]
    setState(next)
    // Deliberately does NOT close: the whole point of the panel is that these
    // facets are secondary and often set two at a time.
  }
  const body = (
    <>
      {facets.map(f => (
        <div className="a-ct-fgrp" key={f.key}>
          <div className="a-ct-fgrp-h a-eyebrow">{f.label}</div>
          <FacetOptions f={f} state={state} pick={pick} />
        </div>
      ))}
      {facets.length === 0 && (
        <div className="a-ct-fgrp-e">No further facets in the loaded rows.</div>
      )}
    </>
  )
  if (facets.length === 0 && n === 0) return null
  const name = label ?? 'Filters'
  return (
    <div className="a-ct-fpop" ref={ref}>
      <Chip
        icon="filter"
        selected={n > 0}
        count={n > 0 ? n : undefined}
        onClick={() => setOpen(v => !v)}
      >
        {name}
      </Chip>
      {sheet ? (
        <Sheet open={open} onClose={() => setOpen(false)} title="All filters">{body}</Sheet>
      ) : (
        <Popover
          open={open}
          label={facets.map(f => f.label).join(' · ') || 'Every facet in the loaded rows'}
          className="a-ct-menu"
          style={place.maxH ? { maxHeight: place.maxH } : undefined}
        >
          <div ref={place.ref} data-wide="" data-flip={place.flip ? '' : undefined}>{body}</div>
        </Popover>
      )}
    </div>
  )
}

export function FilterRow({
  prominent, demoted, state, setState, q, setQ, shown, loaded, total, noun, placeholder,
  idleCount = true, inline = false, label,
}: {
  prominent: Facet[]
  demoted: Facet[]
  state: FilterState
  setState: (s: FilterState) => void
  /** Optional, and the absence is a real state: the idea band, the publish
      queue and the style roster have no free-text search. */
  q?: string
  setQ?: (q: string) => void
  shown: number
  loaded: number
  total: number | null
  noun: string
  placeholder?: string
  idleCount?: boolean
  inline?: boolean
  /** Two rows on this surface run filters over DIFFERENT TABLES, so their
      state cannot be shared and the honest fix is one grammar plus a name. */
  label?: string
}) {
  const sheet = useSheetMode()
  const searchable = typeof setQ === 'function'
  const qv = q ?? ''
  const activeN = Object.values(state).filter(Boolean).length + (qv.trim() ? 1 : 0)
  if (prominent.length === 0 && demoted.length === 0 && activeN === 0) return null
  // ONLY THE SET ONES. What earns a standing slot is a filter that is ON: it
  // hides rows, so it is never one click away.
  const pills = inline ? prominent.filter(f => state[f.key]) : prominent
  const inPanel = inline ? [...prominent, ...demoted] : demoted
  const note = (activeN > 0 || idleCount || (total !== null && total > loaded))
    ? (
      <>
        {activeN > 0
          ? <><b>{shown}</b> of {loaded} {noun} shown</>
          : idleCount ? <>{loaded} {noun}</> : null}
        {total !== null && total > loaded && (
          // PostgREST caps a SELECT at 1000 long before a header count notices,
          // so a filter that ran over the page must never imply it ran over the
          // whole lane.
          <span className="a-ct-fcap">filtering the {loaded} loaded of {total} in the database</span>
        )}
      </>
    )
    : null

  const search = !searchable ? null : (
    <Input
      className="a-ct-search"
      type="search"
      icon="search"
      value={qv}
      placeholder={placeholder ?? `Search ${noun} by title or topic…`}
      onChange={e => setQ?.(e.target.value)}
      label={`Search ${noun}`}
      labelHidden
      tail={qv
        ? <IconButton icon="clear" label="Clear search" size="sm" onClick={() => setQ?.('')} />
        : undefined}
    />
  )

  return (
    <>
      {search}
      {pills.map(f => (
        <FacetPill key={f.key} f={f} state={state} setState={setState} sheet={sheet} />
      ))}
      <MorePill
        facets={inPanel} state={state} setState={setState} sheet={sheet}
        badgeKeys={inline ? demoted.map(f => f.key) : undefined}
        label={label}
      />
      {activeN > 0 && (
        <Button
          variant="quiet" size="sm"
          onClick={() => { setState({}); setQ?.('') }}
        >Clear all</Button>
      )}
      {note && <span className="a-ct-fnote">{note}</span>}
    </>
  )
}
