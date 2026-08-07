import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Facet, FacetOption, FilterState } from '../../lib/contentFilters'

// THE FILTER ROW — one search field, five pills, one disclosure.
//
// What it replaces: `FilterBar` (ContentBits.tsx), which rendered EVERY facet
// and EVERY value of every facet, always, as a permanently-expanded chip
// browser. Measured on the live Ivan lane at 1440×900 with the chat peer
// docked: 18 groups, 105 chips, 1,068px of filter chrome across two stacked
// walls, and the first actual draft row at y=1439 — 539px below the fold. Zero
// rows of work were visible in the first screen. That is the defect; the counts
// were never the defect, so they are all still here, one click away, per value.
//
// The anatomy is spine §11.2 and it is not new to this app: `SendsScreen.tsx`
// already ships `Range: 7d ⌄` in exactly this grammar (`.wb-fpill` / `.wb-fmenu`
// / `.wb-fopt`), which is why this component reuses those three classes rather
// than inventing a fourth filter chrome (§11.3: zero bespoke filter chrome).
//
//   label: value ⌄     26px, --surface2 fill, no border, label --text3/400,
//                      value --text/500, chevron 9px
//   active state       is the VALUE TEXT (§11.4). A filter pill never takes
//                      --accent as a background — accent is spent (§5.1).
//
// At 390 the pill row scrolls horizontally WITH a fade affordance, and a pill's
// panel opens as a bottom sheet instead of a popover. The previous horizontal
// scroller on this surface was a defect precisely because nothing announced it
// (faithful.css:952) — an unannounced scroller and an announced one are not the
// same control.

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
// thing that opened it may have scrolled away.
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, close])
  return ref
}

// A popover that opens off a pill sitting anywhere in a row inside a NARROW
// column (620px with the peer docked) will run off the pane's right edge — the
// "Filters" pill is the last one in the row, and measured, its panel clipped the
// counts clean off. So the panel is measured once on open and flipped to the
// right edge if it does not fit, and its height is capped to what is left below
// it. Two reads, no loop, no layout animation.
function usePlace(open: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ flip: boolean; maxH: number | null }>({ flip: false, maxH: null })
  useLayoutEffect(() => {
    if (!open) { setPlace({ flip: false, maxH: null }); return }
    const el = ref.current
    if (!el) return
    const pane = el.closest('.rows') ?? document.documentElement
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
    <button className={`wb-fopt${on ? ' on' : ''}`} onClick={onPick} type="button">
      <span className="wb-fopt-l">{o.label}</span>
      <span className="wb-fopt-t">{o.n}{on ? ' ✓' : ''}</span>
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
        className={`wb-fopt${state[f.key] ? '' : ' on'}`}
        onClick={() => pick(f.key, '')}
        type="button"
      >
        <span className="wb-fopt-l">Any {f.label.toLowerCase()}</span>
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

// The bottom sheet. Its own overlay, tap-out to close, a drag handle that is
// also a close button so the gesture has a keyboard equivalent, and ≥44px rows.
function Sheet({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="ct-fsheet-scrim" onClick={onClose} role="presentation">
      <div className="ct-fsheet" onClick={e => e.stopPropagation()}>
        <button className="ct-fsheet-grab" onClick={onClose} type="button" aria-label="Close filter">
          <i />
        </button>
        <div className="ct-fsheet-h">{title}</div>
        <div className="ct-fsheet-b">{children}</div>
      </div>
    </div>
  )
}

// One `label: value ⌄` pill with its panel.
function FacetPill({ f, state, setState, sheet }: {
  f: Facet; state: FilterState; setState: (s: FilterState) => void; sheet: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open && !sheet, () => setOpen(false))
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
    <div className="ct-fpop" ref={ref}>
      <button
        className={`wb-fpill ct-fpill${active ? ' on' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        type="button"
      >
        {f.label}: <b>{label}</b><i>⌄</i>
      </button>
      {/* The clear affordance only exists once there is something to clear, and
          it is its own button so it never steals the pill's own click. */}
      {active && (
        <button
          className="ct-fx"
          onClick={() => pick(f.key, '')}
          title={`Clear ${f.label.toLowerCase()}`}
          aria-label={`Clear ${f.label.toLowerCase()} filter`}
          type="button"
        >✕</button>
      )}
      {open && (sheet
        ? <Sheet title={f.label} onClose={() => setOpen(false)}>{body}</Sheet>
        : (
          <div
            className={`wb-fmenu ct-fmenu${place.flip ? ' ct-fmenu-r' : ''}`}
            ref={place.ref}
            style={place.maxH ? { maxHeight: place.maxH } : undefined}
          >{body}</div>
        ))}
    </div>
  )
}

// The disclosure. Every demoted facet in ONE scrollable panel, each with the
// same option-with-count rows, and a live badge of how many of them are set —
// because a filter you cannot see is the one that hides rows.
function MorePill({ facets, state, setState, sheet, badgeKeys, label }: {
  facets: Facet[]; state: FilterState; setState: (s: FilterState) => void; sheet: boolean
  // Which facets this pill is allowed to COUNT. On the command strip it holds
  // every facet, including the ones already rendered as their own active pill
  // beside it — counting those would print "2" next to two visible chips that
  // between them say the same thing. It counts what it alone is hiding.
  badgeKeys?: string[]
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open && !sheet, () => setOpen(false))
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
        <div className="ct-fgrp" key={f.key}>
          <div className="ct-fgrp-h wb-eyebrow">{f.label}</div>
          <FacetOptions f={f} state={state} pick={pick} />
        </div>
      ))}
      {facets.length === 0 && (
        <div className="ct-fgrp-e">No further facets in the loaded rows.</div>
      )}
    </>
  )
  if (facets.length === 0 && n === 0) return null
  return (
    <div className="ct-fpop" ref={ref}>
      <button
        className={`wb-fpill ct-fpill${n > 0 ? ' on' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        type="button"
        title={facets.map(f => f.label).join(' · ') || 'Every facet in the loaded rows'}
      >
        {label ?? 'Filters'}{n > 0 && <b className="ct-fn">{n}</b>}<i>⌄</i>
      </button>
      {open && (sheet
        ? <Sheet title="All filters" onClose={() => setOpen(false)}>{body}</Sheet>
        : (
          <div
            className={`wb-fmenu ct-fmenu ct-fmenu-wide${place.flip ? ' ct-fmenu-r' : ''}`}
            ref={place.ref}
            style={place.maxH ? { maxHeight: place.maxH } : undefined}
          >{body}</div>
        ))}
    </div>
  )
}

/**
 * The whole control. One row: search field, prominent pills, the disclosure,
 * Clear all — then the same honest footnote the old bar carried.
 *
 * The rules it still encodes, unchanged from FilterBar (AFFORDANCES §3):
 *  - facets come from the loaded rows, never a hardcoded list;
 *  - a filter always shows BOTH numbers and says so when the server's exact
 *    count exceeds what the page holds;
 *  - no filter is a default.
 */
export function FilterRow({
  prominent, demoted, state, setState, q, setQ, shown, loaded, total, noun, placeholder,
  idleCount = true, inline = false, label,
}: {
  prominent: Facet[]
  demoted: Facet[]
  state: FilterState
  setState: (s: FilterState) => void
  // Optional, and the absence is a real state rather than an empty box: the
  // idea band, the publish queue and the style roster have no free-text search
  // (their rows carry no title/topic pair to run one over), so they render the
  // pills without a field that would match nothing.
  q?: string
  setQ?: (q: string) => void
  shown: number
  loaded: number
  total: number | null
  noun: string
  placeholder?: string
  // Set false by a caller that already prints this same total right above the
  // row (the post lane's chart card footer: `Total: 224 of 285 in the lane`).
  // With no filter on, "224 drafts" here is that number said a second time
  // 150px lower — and two statements of one figure read as two figures. The
  // FILTERED line is never suppressed: `9 of 224 shown` is the number doing
  // work.
  idleCount?: boolean
  // INLINE (candidate B): the row is a member of the command strip rather than a
  // band of its own, so it drops the `.ct-filters` box and its own footnote LINE
  // — the count rides at the end of the pill row as one mono chunk. Nothing is
  // removed: every facet, every count, every escape is the same control in the
  // same order. This is the whole of "one filter system" on the strip's side.
  inline?: boolean
  // D9 · WHAT THE DISCLOSURE IS SCOPED TO. Two rows on this surface run
  // filters and they run over DIFFERENT TABLES — the strip's over `content`,
  // the ideas band's over `lm_idea_candidates` — so their state cannot be
  // shared and the honest fix is not one control, it is one GRAMMAR plus a
  // name. Two chips both reading "Filters" 90px apart is the ambiguity the
  // ledger row was actually about; "Idea filters" is not.
  label?: string
}) {
  const sheet = useSheetMode()
  const searchable = typeof setQ === 'function'
  const qv = q ?? ''
  const activeN = Object.values(state).filter(Boolean).length + (qv.trim() ? 1 : 0)
  if (prominent.length === 0 && demoted.length === 0 && activeN === 0) return null
  // ONLY THE SET ONES, and only in the inline row.
  //
  // On the command strip the five prominent facets were 500px of `Stage: Any ·
  // Kind: Any · Pillar: Any · Source: Any · QA: Any` — five controls printing
  // the word "Any", which is the state of a filter that is doing nothing. They
  // fold into the ONE disclosure that already holds every facet, every value
  // and every count, grouped and labelled. What earns a standing slot is a
  // filter that is ON: it hides rows, so it is never one click away.
  //
  // Nothing is removed and nothing is renamed — same component, same panel,
  // same option rows with the same counts. The band goes from two rows to one.
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
          <span className="ct-fcap">filtering the {loaded} loaded of {total} in the database</span>
        )}
      </>
    )
    : null

  const search = !searchable ? null : (
    <div className="ct-fsearch">
      <span className="ct-fsearch-i" aria-hidden>⌕</span>
      <input
        className="ct-fsearch-in"
        type="search"
        value={qv}
        placeholder={placeholder ?? `Search ${noun} by title or topic…`}
        onChange={e => setQ?.(e.target.value)}
        aria-label={`Search ${noun}`}
      />
      {qv && (
        <button
          className="ct-fx ct-fx-in" onClick={() => setQ?.('')} type="button"
          aria-label="Clear search"
        >✕</button>
      )}
    </div>
  )
  const pillRow = (
    <div className="ct-fpills">
      {pills.map(f => (
        <FacetPill key={f.key} f={f} state={state} setState={setState} sheet={sheet} />
      ))}
      <MorePill
        facets={inPanel} state={state} setState={setState} sheet={sheet}
        badgeKeys={inline ? demoted.map(f => f.key) : undefined}
        label={label}
      />
      {activeN > 0 && (
        <button
          className="ct-fclear-all"
          onClick={() => { setState({}); setQ?.('') }}
          type="button"
        >Clear all</button>
      )}
      {inline && note && <span className="ct-fnote ct-fnote-in">{note}</span>}
    </div>
  )

  if (inline) {
    return (
      <div className="ct-fr ct-fr-in">
        {search}
        {pillRow}
      </div>
    )
  }
  return (
    <div className="ct-filters">
      <div className="ct-fr">
        {search}
        {pillRow}
      </div>
      {/* The note line is dropped entirely when it would be empty — an empty
          footnote is 18px of chrome saying nothing. */}
      {note && <div className="ct-fnote">{note}</div>}
    </div>
  )
}
