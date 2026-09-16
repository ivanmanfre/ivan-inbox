/* ==========================================================================
   LEAD MAGNETS — Strategy's fifth view. What the lane's gated offers did, and
   who else on the timeline runs the same play.

   Two reads, two independent failures: `operator_lead_magnets` (the lane's own
   catalog, aggregates only) and `operator_gated_posts` (other accounts' gated
   posts, ranked by comments per 1,000 followers). One read failing never hides
   the other: each section carries its own Failed with a retry, and the root's
   `data-lm-state` reports the worse of the two so a shot can wait on it.

   Two layouts sit behind `?lm=a|b` for the ballot. They differ in hierarchy and
   density only: same reads, same numbers, same kit, same copy strings. The
   switch is NOT in the UI — `layoutFromLocation` reads the URL once at mount,
   which keeps the surface honest about having one shipped layout.

   Every number carries its denominator and every rate carries the set it was
   computed over. All arithmetic lives in lib/leadMagnets; this file selects,
   arranges and states.
   ========================================================================== */
import { useEffect, useMemo, useState } from 'react'
import { Segmented } from '../../../ds'
import { Group } from '../../kit'
import type { ContentLane } from '../../../lib/content'
import {
  LM_DEFAULT_LAYOUT, LM_WINDOWS, fetchGatedPosts, fetchLeadMagnets, layoutFromLocation,
  type GatedRead, type LeadMagnetsRead, type LmLayout, type LmWindow,
} from '../../../lib/leadMagnets'
import { FOOT, selectOwn, selectRoster } from './parts'
import { LayoutA } from './layoutA'
import { LayoutB } from './layoutB'
import '../content.css'
import '../reach.css'
import './leadmagnets.css'

export type LmState = 'loading' | 'ready' | 'denied' | 'failed'

/** The worse of the two reads, because a denied read is a different problem from a broken one. */
export function lmState(lm: LeadMagnetsRead | null, gated: GatedRead | null): LmState {
  if (!lm || !gated) return 'loading'
  if (lm.kind === 'denied' || gated.kind === 'denied') return 'denied'
  if (lm.kind === 'failed' || gated.kind === 'failed') return 'failed'
  return 'ready'
}

const DEFAULT_WINDOW: LmWindow = 12
const LAYOUT_KEY = 'a-lm-layout'

/* THE BALLOT ARM RIDES IN THE SEARCH, NOT IN THE HASH.
   The workbench Shell rewrites the hash to its own canonical form at boot and
   drops every key it does not own, so `#exp/brain-b/strategy?lm=b` is already
   `#exp/brain-b/strategy` by the time anything here runs. Reading it earlier is
   not available either: this view is reached through a lazily loaded screen
   (`src/exp/v2c/Shell.tsx`), so its module body evaluates AFTER that rewrite.
   Measured on 2026-09-16 against the dev server: the hash form arms layout A,
   `http://host/?lm=b#exp/brain-b/strategy` arms layout B.
   Whichever form armed it, the answer is held in sessionStorage so a lane
   switch, a pull to refresh or any other remount keeps the arm for the tab. */
export function armedLayout(loc: { hash: string; search: string }, store?: Pick<Storage, 'getItem' | 'setItem'>): LmLayout {
  // Anchored on both sides: `?film=b` and `#…?film=b` carry the substring `lm=b`
  // and must never arm a ballot layout.
  if (/[?&]lm=(a|b)\b/.test(loc.hash) || /(?:^\?|[?&])lm=(a|b)\b/.test(loc.search)) {
    const v = layoutFromLocation(loc)
    try { store?.setItem(LAYOUT_KEY, v) } catch { /* private window: the arm lasts this mount only */ }
    return v
  }
  try {
    const v = store?.getItem(LAYOUT_KEY)
    if (v === 'a' || v === 'b') return v
  } catch { /* nothing stored, nothing lost */ }
  return LM_DEFAULT_LAYOUT
}

/** The whole surface, pure: both reads in, nothing fetched. The tests render this one. */
export function LeadMagnetsPanel({ lm, gated, layout, weeks, onWeeks, now, onRetryLm, onRetryGated }: {
  lm: LeadMagnetsRead | null
  gated: GatedRead | null
  layout: LmLayout
  weeks: LmWindow
  onWeeks?: (w: LmWindow) => void
  now?: number
  /** One retry per read: the two halves fail and recover independently. */
  onRetryLm?: () => void
  onRetryGated?: () => void
}) {
  const [mountedAt] = useState(() => Date.now())
  const [showAll, setShowAll] = useState(false)
  const [showAllOwn, setShowAllOwn] = useState(false)
  const at = now ?? mountedAt
  const thisYear = new Date(at).getUTCFullYear()
  const state = lmState(lm, gated)

  // A lane change remounts the whole view (Strategy keys it by lane), and a window
  // change swaps both lists underneath, so neither fold may stay open across one.
  useEffect(() => { setShowAll(false); setShowAllOwn(false) }, [weeks])

  const own = useMemo(() => (lm?.kind === 'ready' ? selectOwn(lm, weeks, at) : null), [lm, weeks, at])
  const roster = useMemo(() => (gated?.kind === 'ready' ? selectRoster(gated, weeks, at) : null), [gated, weeks, at])
  const ownFail = lm && lm.kind !== 'ready' ? lm.message : null
  const rosterFail = gated && gated.kind !== 'ready' ? gated.message : null

  const Layout = layout === 'b' ? LayoutB : LayoutA
  const body = state === 'loading'
    ? <div className="a-ct-sub">Reading this lane’s lead magnets…</div>
    : (
      <Layout
        own={own}
        roster={roster}
        ownFail={ownFail}
        rosterFail={rosterFail}
        weeks={weeks}
        thisYear={thisYear}
        showAll={showAll}
        onShowAll={() => setShowAll(v => !v)}
        showAllOwn={showAllOwn}
        onShowAllOwn={() => setShowAllOwn(v => !v)}
        onRetryLm={onRetryLm}
        onRetryGated={onRetryGated}
      />
    )

  return (
    <div className="a-lm" data-lm-layout={layout} data-lm-state={state} data-lm-window={weeks}>
      <Group className="a-lm-g" label="Lead magnets and the gated roster" pad>
        <div className="a-lm-body">
          <div className="a-lm-filters">
            <Segmented
              label="Window"
              markerId="a-lm-window"
              value={String(weeks)}
              onChange={id => onWeeks?.(Number(id) as LmWindow)}
              options={LM_WINDOWS.map(w => ({ id: String(w), label: `Last ${w} weeks` }))}
            />
          </div>
          {body}
          <div className="a-lm-foot">{FOOT}</div>
        </div>
      </Group>
    </div>
  )
}

/** The mounted view: the lane comes from Strategy's own lane control, never a second one. */
export function LeadMagnetsView({ lane }: { lane: ContentLane }) {
  const [lm, setLm] = useState<{ lane: ContentLane; read: LeadMagnetsRead } | null>(null)
  const [gated, setGated] = useState<{ lane: ContentLane; read: GatedRead } | null>(null)
  const [lmTick, setLmTick] = useState(0)
  const [gatedTick, setGatedTick] = useState(0)
  const [weeks, setWeeks] = useState<LmWindow>(DEFAULT_WINDOW)
  // The arm was read when this module loaded (see `armedLayout`); a later read
  // of the URL would find the hash already normalised. It is a ballot switch,
  // never a control the operator flips mid-session.
  const [layout] = useState<LmLayout>(() =>
    typeof window === 'undefined' ? LM_DEFAULT_LAYOUT : armedLayout(window.location, window.sessionStorage))

  // Each read owns its slot and its tick, the way `LeadMagnetsSection` does on the
  // Results block: retrying the half that broke re-runs only its own effect, so the
  // half already on screen is never blanked to re-fetch the other one.
  useEffect(() => {
    let live = true
    setLm(prev => (prev && prev.lane === lane ? prev : null))
    fetchLeadMagnets(lane)
      .catch((e: unknown): LeadMagnetsRead => ({ kind: 'failed', message: e instanceof Error ? e.message : 'The lead magnets could not be read.' }))
      .then(read => { if (live) setLm({ lane, read }) })
    return () => { live = false }
  }, [lane, lmTick])

  useEffect(() => {
    let live = true
    setGated(prev => (prev && prev.lane === lane ? prev : null))
    fetchGatedPosts(lane)
      .catch((e: unknown): GatedRead => ({ kind: 'failed', message: e instanceof Error ? e.message : 'The gated posts could not be read.' }))
      .then(read => { if (live) setGated({ lane, read }) })
    return () => { live = false }
  }, [lane, gatedTick])

  return (
    <LeadMagnetsPanel
      lm={lm?.lane === lane ? lm.read : null}
      gated={gated?.lane === lane ? gated.read : null}
      layout={layout}
      weeks={weeks}
      onWeeks={setWeeks}
      onRetryLm={() => setLmTick(t => t + 1)}
      onRetryGated={() => setGatedTick(t => t + 1)}
    />
  )
}
