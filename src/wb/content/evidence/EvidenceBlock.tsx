/* ==========================================================================
   EVIDENCE — the Strategy tab that wires the four content-evidence views
   (This week, Winners, Inputs, Results) into the existing Strategy tab
   idiom. One new top-level tab ("Evidence") in `strategy.tsx`, sub-tabbed
   internally with the same `Segmented` component the outer tab row already
   uses — no new dashboard, no new route, no second tab literally named
   "Results" competing with the existing Results tab (ReachBlock/Benchmark).

   Each sub-view fetches independently, only while it is the active sub-tab —
   the same "only the mounted block reads" idiom `OutliersBlock`/
   `ProposalsBlock` already use elsewhere on this screen.
   ========================================================================== */
import { useCallback, useEffect, useState } from 'react'
import { Segmented } from '../../../ds'
import { Bar } from '../../kit'
import type { ContentLane } from '../../../lib/content'
import {
  fetchInputs, fetchResults, fetchThisWeek, fetchWinners,
  type InputsView, type ResultsRead, type ThisWeekRead, type WinnersRead,
} from '../../../lib/contentEvidence'
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
  { id: 'results', label: 'Results' },
]

function useThisWeek(lane: ContentLane, tick: number) {
  const [view, setView] = useState<ThisWeekRead | null>(null)
  useEffect(() => {
    let live = true
    setView(null)
    void fetchThisWeek(lane).then(v => { if (live) setView(v) })
    return () => { live = false }
  }, [lane, tick])
  return view
}

function useWinners(lane: ContentLane, tick: number) {
  const [view, setView] = useState<WinnersRead | null>(null)
  useEffect(() => {
    let live = true
    setView(null)
    void fetchWinners(lane).then(v => { if (live) setView(v) })
    return () => { live = false }
  }, [lane, tick])
  return view
}

function useInputs(lane: ContentLane, tick: number) {
  const [view, setView] = useState<InputsView | null>(null)
  useEffect(() => {
    let live = true
    setView(null)
    void fetchInputs(lane).then(v => { if (live) setView(v) })
    return () => { live = false }
  }, [lane, tick])
  return view
}

function useResults(lane: ContentLane, tick: number) {
  const [view, setView] = useState<ResultsRead | null>(null)
  useEffect(() => {
    let live = true
    setView(null)
    void fetchResults(lane).then(v => { if (live) setView(v) })
    return () => { live = false }
  }, [lane, tick])
  return view
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

  const thisWeek = useThisWeek(lane, tick)
  const winners = useWinners(lane, tick)
  const inputs = useInputs(lane, tick)
  const results = useResults(lane, tick)

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

      {sub === 'this_week' && (thisWeek ? <ThisWeekPanel view={thisWeek} onRetry={retry} /> : <Loading label="this week's evidence" />)}
      {sub === 'winners' && (winners ? <WinnersPanel view={winners} onRetry={retry} /> : <Loading label="the winners" />)}
      {sub === 'inputs' && (inputs ? <InputsPanel data={inputs} onRetry={retry} /> : <Loading label="the inputs" />)}
      {sub === 'results' && (results ? <ResultsPanel view={results} onRetry={retry} /> : <Loading label="the results" />)}
    </div>
  )
}
