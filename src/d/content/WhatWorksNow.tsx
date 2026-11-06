import { useEffect, useState } from 'react'
import { fetchPatternResults, rateText, type Holdout, type PatternRate, type PatternResults } from '../../lib/earlyReads'
import { TRAIT } from './plan/planBrain'
import { warsawDm, warsawDow } from '../ui/time'
import { Failed, Skeleton } from '../ui/states'
import type { Lane } from './model'
import './early-read.css'
import { BRAIN_NOT_COVERED } from '../../lib/brainAccount'

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

// PLAIN WORDS (review 2026-11-06, Ivan asks for simple wording): no "n=", no "90% interval", no "holdout". A row says
// what kind of post it is, how often those took off, the usual rate, and how many posts that rests on.
/** "Personal posts", "Posts about a career risk"; an unmapped value reads as "Screenshot visual posts". */
export function patternLabel(p: Pick<PatternRate, 'dimension' | 'value'>): string {
  const known = TRAIT[p.dimension]?.[p.value]
  if (known) return known
  const w = p.value.replaceAll('_', ' ').trim()
  return w ? `${w[0].toUpperCase()}${w.slice(1)} posts` : 'Posts'
}
const posts = (n: number) => `${n.toLocaleString('en-US')} post${n === 1 ? '' : 's'}`
/** The recent-post check in one plain sentence. */
export function checkText(h: Holdout): string {
  const top = h.top.rate, bottom = h.bottom.rate
  const split = top != null && bottom != null ? ` The best third took off ${rateText(top)} of the time, the weakest third ${rateText(bottom)}.` : ''
  if (h.state === 'confirmed') return `It held on newer posts (from September on).${split}`
  if (h.state === 'cannot_judge') return 'Not proven on newer posts yet: too many of them scored the same, so they could not be split into best and weakest.'
  return `Not proven on newer posts yet.${split}`
}

export function WhatWorksNowBody({ lane, data, error, onRetry }: { lane: Lane; data: PatternResults | null; error: string | null; onRetry: () => void }) {
  const top = data?.topPatterns.filter(p => p.n >= 25).slice(0, 3) ?? []
  const keys = new Set(top.map(cellKey))
  const bottom = data?.bottomPatterns.filter(p => p.n >= 25 && !keys.has(cellKey(p))).slice(0, 3) ?? []
  const h = data?.holdout
  const list = (rows: PatternRate[]) => <ul className="cn-pattern-list">{rows.map(p => <li key={cellKey(p)}>
    <span><b>{patternLabel(p)}</b><small>from {posts(p.n)}</small></span>
    <span className="cn-pattern-rate"><b>{rateText(p.rate)}</b><small>took off</small></span>
    <small className="cn-pattern-base">Usual in this niche: {rateText(p.base_rate)}</small>
  </li>)}</ul>
  return <section className="cn-result-section cn-what-works" aria-label="What works now">
    <h2>What works now</h2><p className="cn-pattern-caption">Which kinds of posts took off in this client’s niche{lane === 'arch' || data?.smallSample ? '. Few posts so far, so read it loosely' : ''}.</p>
    {error === BRAIN_NOT_COVERED ? <p className="cn-wk2-empty">{error}</p> : error ? <Failed what="the niche patterns" detail={error} onRetry={onRetry} /> : !data ? <Skeleton lines={3} label="Reading niche patterns" /> : <>
      {!top.length && !bottom.length ? <p className="cn-wk2-empty">Not enough niche posts yet: each kind needs at least 25.</p> : <div className="cn-pattern-groups">
        <div><h3>Took off more often</h3>{top.length ? list(top) : <p>None stands out yet.</p>}</div>
        <div><h3>Took off less often</h3>{bottom.length ? list(bottom) : <p>None stands out yet.</p>}</div>
      </div>}
      <p className="cn-read-note">A post took off when it got at least 40 likes and three times what its author usually gets. This describes the niche. It is no promise for one post.</p>
      <div className="cn-pattern-check"><b>Checked on newer posts</b><p>{h ? checkText(h) : 'Not checked on newer posts yet.'}</p></div>
      {data.computedAt && <p className="cn-read-note">Worked out {Number.isFinite(Date.parse(data.computedAt)) ? `${warsawDow(data.computedAt)} ${warsawDm(data.computedAt)}` : data.computedAt}.</p>}
    </>}
  </section>
}
