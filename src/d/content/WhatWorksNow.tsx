import { useEffect, useState } from 'react'
import { fetchPatternResults, holdoutText, rateText, type PatternRate, type PatternResults } from '../../lib/earlyReads'
import { Failed, Skeleton } from '../ui/states'
import type { Lane } from './model'
import './early-read.css'

export function WhatWorksNow({ lane }: { lane: Lane }) {
  const [data, setData] = useState<PatternResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    const controller = new AbortController()
    setData(null); setError(null)
    void fetchPatternResults(lane, controller.signal).then(r => { if (live) setData(r) }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not read the niche evidence.') })
    return () => { live = false; controller.abort() }
  }, [lane, tick])
  return <WhatWorksNowBody lane={lane} data={data?.client === lane ? data : null} error={error} onRetry={() => setTick(t => t + 1)} />
}
const cellKey = (p: PatternRate) => `${p.dimension}:${p.value}`
export function WhatWorksNowBody({ lane, data, error, onRetry }: { lane: Lane; data: PatternResults | null; error: string | null; onRetry: () => void }) {
  const top = data?.topPatterns.filter(p => p.n >= 25).slice(0, 3) ?? []
  const keys = new Set(top.map(cellKey))
  const bottom = data?.bottomPatterns.filter(p => p.n >= 25 && !keys.has(cellKey(p))).slice(0, 3) ?? []
  const h = data?.holdout
  const list = (rows: PatternRate[]) => <ul className="cn-pattern-list">{rows.map(p => <li key={cellKey(p)}>
    <span><b>{p.value.replaceAll('_', ' ')}</b><small>{p.dimension.replaceAll('_', ' ')}</small></span>
    <span className="cn-pattern-rate"><b>{rateText(p.rate)}</b><small>n={p.n.toLocaleString('en-US')}</small></span>
    <small className="cn-pattern-base">Usual {rateText(p.base_rate)} · n={p.base_n.toLocaleString('en-US')}{p.wilson_low != null && p.wilson_high != null ? ` · 90% interval ${rateText(p.wilson_low)}–${rateText(p.wilson_high)}` : ''}</small>
  </li>)}</ul>
  return <section className="cn-result-section cn-what-works" aria-label="What works now">
    <h2>What works now</h2><p className="cn-pattern-caption">Early read{lane === 'arch' || data?.smallSample ? ' · small sample' : ''}. Patterns in this client’s niche, based on stored breakouts.</p>
    {error ? <Failed what="the niche patterns" detail={error} onRetry={onRetry} /> : !data ? <Skeleton lines={3} label="Reading niche patterns" /> : <>
      {!top.length && !bottom.length ? <p className="cn-wk2-empty">No patterns with at least 25 niche posts are stored yet.</p> : <div className="cn-pattern-groups">
        <div><h3>More breakouts</h3>{top.length ? list(top) : <p>No eligible stronger patterns.</p>}</div>
        <div><h3>Fewer breakouts</h3>{bottom.length ? list(bottom) : <p>No other eligible patterns.</p>}</div>
      </div>}
      <p className="cn-read-note">A stored breakout has at least 40 likes and three times that author’s usual score (likes + 3× reposts). These rates describe the niche, never a promise for a post.</p>
      <div className="cn-pattern-check"><b>Recent-post check</b><p>{h ? holdoutText(h) : 'No recent-post check is stored yet.'}</p>
        {h && <p>{h.top.n == null ? 'Top n not recorded' : `Top n=${h.top.n}${h.top.rate != null ? ` · ${rateText(h.top.rate)} breakouts` : ''}`} · {h.bottom.n == null ? 'Bottom n not recorded' : `bottom n=${h.bottom.n}${h.bottom.rate != null ? ` · ${rateText(h.bottom.rate)} breakouts` : ''}`}</p>}
        {h?.limitation && <p>{h.limitation}</p>}
      </div>
      {data.computedAt && <p className="cn-read-note">Computed {data.computedAt}.</p>}
    </>}
  </section>
}
