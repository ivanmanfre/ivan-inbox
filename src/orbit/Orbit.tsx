// src/orbit/Orbit.tsx — the /orbit shell. Owns filters, head, chip row,
// stats strip, the scrub bar, and mounts OrbitCanvas (S1's file, its own
// React.lazy boundary) plus the two panels. No graph math and no canvas
// rendering lives here — this file is state + chrome only.

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Chip, EmptyState, IconButton, LiveDot } from '../ds'
import { relAge } from '../wb/kit'
import { computeWindow, endOfDayIso } from './layout'
import { PersonPanel } from './PersonPanel'
import { PostPanel } from './PostPanel'
import { useOrbit } from './useOrbit'
import {
  computeStats, defaultFilters, matchesFilters, rangeOf, shortLaneLabel, sortedLaneChips,
  type DatePreset, type OrbitFilters,
} from './filters'
import type { OrbitPerson, OrbitTenant } from './types'
import './orbit.css'

// S1's canvas, its own lazy boundary — nothing else on the app pays for
// sigma/graphology until this route actually mounts.
const OrbitCanvasLazy = lazy(() => import('./OrbitCanvas'))

const TENANT_OPTS: { id: OrbitTenant; label: string }[] = [
  { id: 'ivan', label: 'Ivan' }, { id: 'arch', label: 'ARCH' }, { id: 'risedtc', label: 'RISE' },
]
const PRESET_OPTS: { id: DatePreset; label: string }[] = [
  { id: '7d', label: '7d' }, { id: '30d', label: '30d' }, { id: '90d', label: '90d' },
  { id: 'all', label: 'All' }, { id: 'custom', label: 'Custom' },
]

type Sel = { kind: 'person'; id: string } | { kind: 'post'; id: string } | null

// Route: #exp/brain-b/orbit?tenant=ivan&range=30d — read ONCE at mount, same
// convention route.ts's WB_PREFIX uses for its own once-per-load read.
// Garbage/absent values fall back to ivan/30d rather than throwing.
function initialFiltersFromHash(): OrbitFilters {
  let tenant: OrbitTenant = 'ivan'
  let preset: DatePreset = '30d'
  try {
    const q = location.hash.split('?')[1]
    if (q) {
      const params = new URLSearchParams(q)
      const t = params.get('tenant')
      if (t === 'ivan' || t === 'arch' || t === 'risedtc') tenant = t
      const r = params.get('range')
      if (r === '7d' || r === '30d' || r === '90d' || r === 'all') preset = r
    }
  } catch { /* malformed hash — keep the default */ }
  return { ...defaultFilters(tenant), preset }
}

// DEV-only, symmetric with useOrbit's ?fixture=1 escape hatch: `&open=person:<id>`
// or `&open=post:<id>` preselects a panel at mount, so a panel can be verified
// (screenshotted, poked at) without depending on a precise click into the
// canvas. Folds to `null` and is dead-code-eliminated in every production build.
function initialSelFromHash(): Sel {
  if (!import.meta.env.DEV) return null
  try {
    const q = location.hash.split('?')[1]
    if (!q) return null
    const open = new URLSearchParams(q).get('open')
    if (!open) return null
    // Split on the FIRST colon only — a post id is a full URN
    // (urn:li:activity:7503046818365329408) and contains colons of its own.
    const i = open.indexOf(':')
    if (i < 0) return null
    const kind = open.slice(0, i)
    const id = open.slice(i + 1)
    if ((kind === 'person' || kind === 'post') && id) return { kind, id }
  } catch { /* malformed hash — no preselection */ }
  return null
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export function Orbit() {
  const [filters, setFilters] = useState<OrbitFilters>(initialFiltersFromHash)
  const [sel, setSel] = useState<Sel>(initialSelFromHash)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  // null = live (now). A day ordinal = scrubbed to that day's end-of-day.
  const [scrubDay, setScrubDay] = useState<number | null>(null)
  const reducedMotion = usePrefersReducedMotion()

  const { graph, prev, loading, error, loadedAt, refresh } = useOrbit(filters)
  const { from: winFrom, to: winTo } = rangeOf(filters)

  const visible = useCallback((p: OrbitPerson) => matchesFilters(p, filters), [filters])

  const filteredPeople = useMemo(() => (graph ? graph.people.filter(visible) : []), [graph, visible])
  const stats = useMemo(() => computeStats(filteredPeople), [filteredPeople])
  const laneChips = useMemo(() => (graph ? sortedLaneChips(graph.lanes) : []), [graph])
  // The three never-reached chip counts: every OTHER active filter applies (lane,
  // content-only, moved-first, ICP floor, search) but not the neverReached filter
  // itself — same convention as the lane chips' own `n`, so toggling one bucket
  // chip doesn't zero out the other two chips' counts.
  const nrCounts = useMemo(() => {
    if (!graph) return { icpUnasked: 0, judgedOut: 0, unjudged: 0 }
    const base = graph.people.filter(p => matchesFilters(p, { ...filters, neverReached: new Set() }))
    return computeStats(base)
  }, [graph, filters])

  const toggleLane = useCallback((id: string) => {
    setFilters(f => {
      const next = new Set(f.lanes)
      if (next.has(id)) next.delete(id); else next.add(id)
      return { ...f, lanes: next }
    })
  }, [])

  const setTenant = useCallback((id: string) => {
    setFilters(f => ({ ...f, tenant: id as OrbitTenant, lanes: new Set() }))
    setSel(null)
  }, [])

  const setPreset = useCallback((id: string) => {
    if (id === 'custom') { setCustomOpen(true); return }
    setFilters(f => ({ ...f, preset: id as DatePreset }))
    setScrubDay(null)
  }, [])

  const applyCustom = useCallback(() => {
    if (!customFrom || !customTo) return
    setFilters(f => ({ ...f, preset: 'custom', from: customFrom, to: customTo }))
    setCustomOpen(false)
    setScrubDay(null)
  }, [customFrom, customTo])

  const selectedPerson = useMemo(() => {
    if (!graph || !sel || sel.kind !== 'person') return null
    return graph.people.find(p => p.id === sel.id) ?? null
  }, [graph, sel])
  const selectedPost = useMemo(() => {
    if (!graph || !sel || sel.kind !== 'post') return null
    return graph.posts.find(p => p.id === sel.id) ?? null
  }, [graph, sel])

  const win = useMemo(() => (graph ? computeWindow(graph) : null), [graph])
  const scrubTime = useMemo(() => {
    if (scrubDay == null || !win) return null
    const dateOnly = new Date(scrubDay * 86400000).toISOString().slice(0, 10)
    return endOfDayIso(dateOnly)
  }, [scrubDay, win])
  const scrubLabel = scrubDay != null && win ? new Date(scrubDay * 86400000).toISOString().slice(0, 10) : 'Live'

  return (
    <div className="a-root ds-body a-orbit" data-surface="orbit">
      <div className="a-orbit-head">
        <div className="a-orbit-head-row1">
          <span className="a-orbit-title">Orbit</span>
          <span className="a-orbit-live">
            <LiveDot label={loading ? 'Refreshing' : 'Live'} />
            {relAge(loadedAt)}
          </span>
        </div>
        {/* Tenant and date-range each get their own row now — the coordinator
            measured the combined row at 370px of 358 available at 390px
            (`.a-orbit-head-row2` overflowed and had to scroll). Two short
            rows both fit without a scroller; one long one didn't. */}
        <div className="a-orbit-head-row2">
          {TENANT_OPTS.map(t => (
            <button
              key={t.id} type="button" className="a-orbit-preset"
              data-active={filters.tenant === t.id ? '' : undefined}
              onClick={() => setTenant(t.id)}
            >{t.label}</button>
          ))}
        </div>
        <div className="a-orbit-head-row2">
          <div className="a-orbit-presets">
            {PRESET_OPTS.map(p => (
              <button
                key={p.id} type="button" className="a-orbit-preset"
                data-active={filters.preset === p.id ? '' : undefined}
                onClick={() => setPreset(p.id)}
              >{p.label}</button>
            ))}
          </div>
          <IconButton icon="refresh" label="Refresh now" size="sm" onClick={refresh} />
        </div>
        {customOpen ? (
          <div className="a-orbit-head-row2">
            <input type="date" value={customFrom} max={customTo || undefined} onChange={e => setCustomFrom(e.target.value)} className="a-orbit-search" />
            <input type="date" value={customTo} min={customFrom || undefined} onChange={e => setCustomTo(e.target.value)} className="a-orbit-search" />
            <Chip tone="accent" onClick={customFrom && customTo ? applyCustom : undefined}>Apply</Chip>
            <Chip tone="quiet" onClick={() => setCustomOpen(false)}>Cancel</Chip>
          </div>
        ) : null}
      </div>

      <ChipRow filters={filters} setFilters={setFilters} laneChips={laneChips} toggleLane={toggleLane} nrCounts={nrCounts} />

      {/* Four numbers, one phone row, no card chrome, no scroll — the
          coordinator's fix: the old StatTile row measured 950px of 390
          visible. The two rate readings are prose below rather than two
          more wide cards. */}
      <div className="a-orbit-stats">
        <div className="a-orbit-stat">
          <span className="a-orbit-stat-n">{stats.people}</span>
          <span className="a-orbit-stat-l">People</span>
        </div>
        <div className="a-orbit-stat">
          <span className="a-orbit-stat-n">{stats.reached}</span>
          <span className="a-orbit-stat-l">Reached</span>
        </div>
        <div className="a-orbit-stat">
          <span className="a-orbit-stat-n">{stats.replied}</span>
          <span className="a-orbit-stat-l">Replied</span>
        </div>
        <div className="a-orbit-stat">
          <span className="a-orbit-stat-n">{stats.booked}</span>
          <span className="a-orbit-stat-l">Booked</span>
        </div>
      </div>
      <div className="a-orbit-rates">
        <p className="a-orbit-rate-line">
          {stats.movedFirstRate != null
            ? <><strong>{Math.round(stats.movedFirstRate * 100)}%</strong> of reached people who moved first went on to reply.</>
            : 'No reached people who moved first yet.'}
        </p>
        <p className="a-orbit-rate-line">
          {stats.coldFirstRate != null
            ? <><strong>{Math.round(stats.coldFirstRate * 100)}%</strong> of reached people we moved on first went on to reply.</>
            : 'No reached people we moved on first yet.'}
        </p>
      </div>

      <div className="a-orbit-canvas">
        {error ? (
          <div className="a-orbit-canvas-empty"><EmptyState icon="alert" title="The graph did not load" sub={error} /></div>
        ) : null}
        {!error && !loading && graph && graph.people.length === 0 ? (
          <div className="a-orbit-canvas-empty">
            <EmptyState icon="chart" ghosts title="Nothing in this window" sub="Widen the range or clear a filter." />
          </div>
        ) : null}
        <Suspense fallback={<div className="a-orbit-canvas-fallback" />}>
          <OrbitCanvasLazy
            graph={graph}
            prev={prev}
            visible={visible}
            selected={sel}
            onSelect={setSel}
            time={scrubTime}
            reducedMotion={reducedMotion}
          />
        </Suspense>
      </div>

      {win ? (
        <div className="a-orbit-scrub">
          <input
            type="range" min={win.fromDay} max={win.toDay} step={1}
            value={scrubDay ?? win.toDay}
            aria-label="Scrub through the window"
            onChange={e => {
              const v = Number(e.target.value)
              setScrubDay(v >= win.toDay ? null : v)
            }}
          />
          <span className="a-orbit-scrub-date">{scrubLabel}</span>
          <button type="button" className="a-orbit-live-btn" data-live={scrubDay == null} onClick={() => setScrubDay(null)}>Live</button>
        </div>
      ) : null}

      <PersonPanel
        person={selectedPerson}
        tenant={filters.tenant}
        lanes={graph?.lanes ?? []}
        onClose={() => setSel(null)}
      />
      <PostPanel
        post={selectedPost}
        tenant={filters.tenant}
        people={graph?.people ?? []}
        contentEdges={graph?.content_edges ?? []}
        onClose={() => setSel(null)}
        onOpenPerson={id => setSel({ kind: 'person', id })}
      />

      {/* Keeps the range computation visible for a11y tooling / future use
          without an unused-var lint hit; harmless if never read elsewhere. */}
      <span hidden data-window={`${winFrom}..${winTo}`} />
    </div>
  )
}

// Split into two rows on the coordinator's fix: the four toggle filters are
// what people reach for most, so they get their own row rather than being
// buried at the tail of a 3,690px campaign scroller; the campaign chips keep
// scrolling below, now with a right-edge fade so the cut reads as "more
// here" instead of a layout bug.
// The never-reached split (db/062): three independent bucket toggles replacing
// the old single "Never reached" chip. 'ICP never asked' is the headline of
// the three — it's the actionable one (a scored person nobody has approached
// yet) — so it goes first and keeps its accent tone even unselected.
function toggleNr(f: OrbitFilters, bucket: 'icp_unasked' | 'judged_out' | 'unjudged'): OrbitFilters {
  const next = new Set(f.neverReached)
  if (next.has(bucket)) next.delete(bucket); else next.add(bucket)
  return { ...f, neverReached: next }
}

function ChipRow({ filters, setFilters, laneChips, toggleLane, nrCounts }: {
  filters: OrbitFilters
  setFilters: React.Dispatch<React.SetStateAction<OrbitFilters>>
  laneChips: ReturnType<typeof sortedLaneChips>
  toggleLane: (id: string) => void
  nrCounts: { icpUnasked: number; judgedOut: number; unjudged: number }
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  return (
    <div className="a-orbit-chiprows">
      <div className="a-orbit-filterrow">
        <Chip tone="neutral" selected={filters.contentOnly} onClick={() => setFilters(f => ({ ...f, contentOnly: !f.contentOnly }))}>Content only</Chip>
        <Chip tone="neutral" selected={filters.movedFirst} onClick={() => setFilters(f => ({ ...f, movedFirst: !f.movedFirst }))}>Moved first</Chip>
        <Chip
          tone="accent" count={nrCounts.icpUnasked}
          selected={filters.neverReached.has('icp_unasked')}
          onClick={() => setFilters(f => toggleNr(f, 'icp_unasked'))}
        >ICP never asked</Chip>
        <Chip
          tone="neutral" count={nrCounts.judgedOut}
          selected={filters.neverReached.has('judged_out')}
          onClick={() => setFilters(f => toggleNr(f, 'judged_out'))}
        >Judged out</Chip>
        <Chip
          tone="neutral" count={nrCounts.unjudged}
          selected={filters.neverReached.has('unjudged')}
          onClick={() => setFilters(f => toggleNr(f, 'unjudged'))}
        >Not yet judged</Chip>
        <Chip tone="neutral" selected={filters.icpMin === 7} onClick={() => setFilters(f => ({ ...f, icpMin: f.icpMin === 7 ? null : 7 }))}>ICP ≥ 7</Chip>
        {searchOpen ? (
          <input
            className="a-orbit-search" autoFocus placeholder="Search name, company, headline"
            value={filters.q}
            onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
            onBlur={() => { if (!filters.q) setSearchOpen(false) }}
          />
        ) : (
          <IconButton icon="search" label="Search" size="sm" onClick={() => setSearchOpen(true)} />
        )}
      </div>
      {laneChips.length > 0 ? (
        <div className="a-orbit-lanerow">
          {laneChips.map(l => (
            <Chip
              key={l.id} tone={l.active ? 'neutral' : 'quiet'} selected={filters.lanes.has(l.id)}
              count={l.n} title={l.name} onClick={() => toggleLane(l.id)}
            >{shortLaneLabel(l.name)}</Chip>
          ))}
        </div>
      ) : null}
    </div>
  )
}
