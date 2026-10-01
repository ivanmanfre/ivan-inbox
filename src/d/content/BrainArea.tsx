import { Suspense, lazy } from 'react'
import { BenchmarkBlock } from '../../wb/content/BenchmarkBlock'
import { Skeleton } from '../ui/states'
import { LANES, LANE_NAME, type Lane } from './model'
import { WhatWorksNow } from './WhatWorksNow'
import { RepeatEngagers } from './RepeatEngagers'
import './brain-account.css'
const InputsPage = lazy(() => import('./inputs/Inputs').then(m => ({ default: m.InputsPage })))
export function BrainArea({ lane, setLane, phone, query }: { lane: Lane; setLane: (lane: Lane) => void; phone: boolean; query: URLSearchParams }) {
  return <div className="cn-brain-area" data-client={lane}>
    <div className="cn-wk2-chips" role="tablist" aria-label="Client">{LANES.map(l => <button type="button" key={l} role="tab" aria-selected={lane === l} onClick={() => setLane(l)}>{LANE_NAME[l]}</button>)}</div>
    <WhatWorksNow key={`patterns:${lane}`} lane={lane} />
    <section className="cn-result-section" aria-label="Brain outliers"><h2>Outliers</h2><p className="cn-brain-note">Source posts to consider and label. Save idea keeps its existing path into Ideas.</p><Suspense fallback={<Skeleton lines={4} label="Reading outliers" />}><InputsPage key={`outliers:${lane}`} lane={lane} setLane={setLane} phone={phone} query={query} /></Suspense></section>
    <section className="cn-result-section" aria-label="Brain benchmark"><h2>Benchmark</h2><BenchmarkBlock key={`benchmark:${lane}`} lane={lane} view="results" /></section>
    <RepeatEngagers key={`repeat:${lane}`} lane={lane} />
  </div>
}
