/* ==========================================================================
   EVIDENCE — the Strategy tab that wires the four content-evidence views
   (This week, Winners, Inputs, Results) into the existing Strategy tab
   idiom. One new top-level tab ("Evidence") in `strategy.tsx`, sub-tabbed
   internally with the same `Segmented` component the outer tab row already
   uses — no new dashboard, no new route, no second tab literally named
   "Results" competing with the existing Results tab (ReachBlock/Benchmark);
   the inner sub-view is labelled "Test results" instead (orchestrator
   ruling, Phase-2 fix pass: it is still the spec's Results view, the panel
   heading stays "Results", only the TAB text changes so two identical
   labels never sit in adjacent tablists at once).

   ONE shared read per lane, not four. `fetchContentEvidenceViews` is a
   single `operator_content_evidence` round trip; all four sub-views are
   derived from that one result and switching tabs never re-fetches (Phase-2
   review NOTE: the previous four independent hooks fired four identical
   round trips on every mount, which this file's own comment claimed did not
   happen).
   ========================================================================== */
import { useCallback, useEffect, useState } from 'react'
import { Segmented } from '../../../ds'
import { Bar } from '../../kit'
import type { ContentLane } from '../../../lib/content'
import { fetchContentEvidenceViews, type ContentEvidenceViews } from '../../../lib/contentEvidence'
import { ThisWeekPanel } from './ThisWeekPanel'
import { WinnersPanel } from './WinnersPanel'
import { InputsPanel } from './InputsPanel'
import { ResultsPanel } from './ResultsPanel'
import './evidence.css'

type SubView = 'this_week' | 'winners' | 'inputs' | 'results'

const SUB_VIEWS: Array<{ id: SubView; label: string }> = [
  { id: 'this_week', label: 'This week' },
  { id: 'winners', label: 'Winners' },
  { id: 'inputs', label: 'Inputs' },
  { id: 'results', label: 'Test results' },
]

function useContentEvidence(lane: ContentLane, tick: number) {
  const [views, setViews] = useState<ContentEvidenceViews | null>(null)
  useEffect(() => {
    let live = true
    setViews(null)
    void fetchContentEvidenceViews(lane).then(v => { if (live) setViews(v) })
    return () => { live = false }
  }, [lane, tick])
  return views
}

/** Loading has no fifth state of its own: `null` (nothing has loaded) simply
    renders nothing yet, the same "reading…" line every other block on this
    screen uses while its first fetch is in flight. */
function Loading({ label }: { label: string }) {
  return <div className="a-ct-sub a-prop-hold">Reading {label}…</div>
}

export function EvidenceBlock({ lane }: { lane: ContentLane }) {
  const [sub, setSub] = useState<SubView>('this_week')
  const [tick, setTick] = useState(0)
  const retry = useCallback(() => setTick(t => t + 1), [])

  const views = useContentEvidence(lane, tick)

  return (
    <div className="a-cev">
      <Bar className="a-cev-nav-bar">
        <Segmented
          label="Evidence views"
          className="a-cev-nav"
          markerId="a-cev-subview"
          value={sub}
          onChange={v => setSub(v as SubView)}
          options={SUB_VIEWS}
        />
      </Bar>

      {sub === 'this_week' && (views ? <ThisWeekPanel view={views.thisWeek} onRetry={retry} /> : <Loading label="this week's evidence" />)}
      {sub === 'winners' && (views ? <WinnersPanel view={views.winners} onRetry={retry} /> : <Loading label="the winners" />)}
      {sub === 'inputs' && (views ? <InputsPanel data={views.inputs} onRetry={retry} /> : <Loading label="the inputs" />)}
      {sub === 'results' && (views ? <ResultsPanel view={views.results} onRetry={retry} /> : <Loading label="the results" />)}
    </div>
  )
}
