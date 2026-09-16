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
import type { ContentLane } from '../../../lib/content'
import {
  LM_WINDOWS, fetchGatedPosts, fetchLeadMagnets, layoutFromLocation,
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

/** The whole surface, pure: both reads in, nothing fetched. The tests render this one. */
export function LeadMagnetsPanel({ lm, gated, layout, weeks, onWeeks, now, onRetry }: {
  lm: LeadMagnetsRead | null
  gated: GatedRead | null
  layout: LmLayout
  weeks: LmWindow
  onWeeks?: (w: LmWindow) => void
  now?: number
  onRetry?: () => void
}) {
  const [mountedAt] = useState(() => Date.now())
  const [showAll, setShowAll] = useState(false)
  const at = now ?? mountedAt
  const thisYear = new Date(at).getUTCFullYear()
  const state = lmState(lm, gated)

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
        onRetry={onRetry}
      />
    )

  return (
    <div className="a-lm" data-lm-layout={layout} data-lm-state={state} data-lm-window={weeks}>
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
  )
}

/** The mounted view: the lane comes from Strategy's own lane control, never a second one. */
export function LeadMagnetsView({ lane }: { lane: ContentLane }) {
  const [lm, setLm] = useState<{ lane: ContentLane; read: LeadMagnetsRead } | null>(null)
  const [gated, setGated] = useState<{ lane: ContentLane; read: GatedRead } | null>(null)
  const [tick, setTick] = useState(0)
  const [weeks, setWeeks] = useState<LmWindow>(DEFAULT_WINDOW)
  // Read once at mount: the layout is a ballot switch on the URL, not a control
  // the operator flips mid-session.
  const [layout] = useState<LmLayout>(() =>
    typeof window === 'undefined' ? 'a' : layoutFromLocation(window.location))

  useEffect(() => {
    let live = true
    setLm(null); setGated(null)
    fetchLeadMagnets(lane)
      .then(read => { if (live) setLm({ lane, read }) })
      .catch(e => { if (live) setLm({ lane, read: { kind: 'failed', message: e instanceof Error ? e.message : 'The lead magnets could not be read.' } }) })
    fetchGatedPosts(lane)
      .then(read => { if (live) setGated({ lane, read }) })
      .catch(e => { if (live) setGated({ lane, read: { kind: 'failed', message: e instanceof Error ? e.message : 'The gated posts could not be read.' } }) })
    return () => { live = false }
  }, [lane, tick])

  return (
    <LeadMagnetsPanel
      lm={lm?.lane === lane ? lm.read : null}
      gated={gated?.lane === lane ? gated.read : null}
      layout={layout}
      weeks={weeks}
      onWeeks={setWeeks}
      onRetry={() => setTick(t => t + 1)}
    />
  )
}
