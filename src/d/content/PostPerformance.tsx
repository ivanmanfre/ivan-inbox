import { useMemo, useState, type ReactNode } from 'react'
import type { ReachRead } from '../../lib/reach'
import { Failed, Skeleton } from '../ui/states'
import { LANE_TZ, LANE_TZ_WORD } from './laneTime'
import { LANE_NAME, type Lane } from './model'
import { change, MIN_N, perfRead, sortPosts, SETTLE_DAYS, type Bucket, type Period, type SortKey } from './perfModel'
import './perf.css'

const n0 = (v: number | null | undefined) => (v == null ? '–' : Math.round(v).toLocaleString('en-US'))
const pct = (v: number | null | undefined) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`)
const PERIODS: { p: Period; label: string }[] = [{ p: 30, label: '30 days' }, { p: 90, label: '90 days' }, { p: 0, label: 'All time' }]
const SORTS: { k: SortKey; label: string }[] = [{ k: 'impressions', label: 'Impressions' }, { k: 'engagement', label: 'Engagement' }, { k: 'comments', label: 'Comments' }, { k: 'newest', label: 'Newest' }]

function whenWord(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(Date.parse(iso)).replace(',', '')
}

function Delta({ now, before }: { now: number | null; before: number | null | undefined }) {
  const c = change(now, before)
  if (c == null) return null
  return <i className={c > 0 ? 'cn-perf-up' : c < 0 ? 'cn-perf-down' : undefined}>{c > 0 ? '▲' : c < 0 ? '▼' : ''} {Math.abs(c)}%</i>
}

function Bars({ title, list }: { title: string; list: Bucket[] }) {
  const top = Math.max(1, ...list.map(b => b.median ?? 0))
  return <div className="cn-perf-bars">
    <h3>{title}</h3>
    {list.map(b => <div key={b.key} className={`cn-perf-bar${b.best ? ' is-best' : ''}${b.n > 0 && b.n < MIN_N ? ' is-thin' : ''}`}>
      <span>{b.label}</span>
      <span className="cn-perf-track"><span style={{ width: `${((b.median ?? 0) / top) * 100}%` }} /></span>
      <b>{b.n ? n0(b.median) : '–'}</b>
      <small>{b.n} post{b.n === 1 ? '' : 's'}{b.best ? ' · best' : ''}</small>
    </div>)}
  </div>
}

export function PostPerformance({ lane, read, onRetry, now }: { lane: Lane; read: ReachRead | null; onRetry: () => void; now: number }) {
  const [period, setPeriod] = useState<Period>(90)
  const [sort, setSort] = useState<SortKey>('impressions')
  const [all, setAll] = useState(false)
  const tz = LANE_TZ[lane]
  const r = useMemo(() => (read?.kind === 'ready' ? perfRead(read.rows, tz, period, now) : null), [read, tz, period, now])
  const list = useMemo(() => (r ? sortPosts(r.posts, sort) : []), [r, sort])
  const since = period ? `vs the ${period} days before` : null

  let body: ReactNode
  if (lane === 'swishdm') body = <p className="cn-wk2-empty">{LANE_NAME[lane]} posts are not tracked yet, so there are no numbers to compare.</p>
  else if (!read) body = <Skeleton lines={4} label="Reading post numbers" />
  else if (read.kind !== 'ready') body = <Failed what="the post numbers" detail={read.message} onRetry={onRetry} />
  else if (!r || !r.posts.length) body = <p className="cn-wk2-empty">No post published in this period.</p>
  else body = <>
    <div className="cn-perf-stats">
      <div><small>Posts</small><b>{r.now.posts}</b>{r.before && <Delta now={r.now.posts} before={r.before.posts} />}</div>
      <div><small>Typical post</small><b>{n0(r.now.median)}</b><em>impressions</em>{r.before && <Delta now={r.now.median} before={r.before.median} />}</div>
      <div><small>Impressions</small><b>{n0(r.now.impressions)}</b>{r.before && <Delta now={r.now.settledImpressions} before={r.before.settledImpressions} />}</div>
      <div><small>Engagement</small><b>{pct(r.now.rate)}</b><em>typical post</em>{r.before && <Delta now={r.now.rate} before={r.before.rate} />}</div>
    </div>
    {(note => note && <p className="cn-perf-note">{note}</p>)([
      since && r.before ? `Arrows compare ${since}.` : '',
      r.fresh ? `${r.fresh} post${r.fresh === 1 ? ' is' : 's are'} under ${SETTLE_DAYS} days old and left out of the typical post, the impressions arrow and the best day and time.` : '',
      r.stalled ? `${r.stalled} post${r.stalled === 1 ? '' : 's'} stopped being tracked in the first ${SETTLE_DAYS} days, so ${r.stalled === 1 ? 'it is' : 'they are'} left out too.` : '',
    ].filter(Boolean).join(' '))}
    <div className="cn-perf-when">
      <Bars title="Typical impressions by day" list={r.days} />
      <div>
        <Bars title={`Typical impressions by time (${LANE_TZ_WORD[lane]})`} list={r.times} />
        {r.slot && <p className="cn-perf-note">{r.slot.n} of {r.slot.of} posts went out at about {r.slot.hm}, so this also compares that slot's posts with the ones sent at other times, not only the hour.</p>}
      </div>
    </div>
    <div className="cn-perf-head">
      <h3>Every post</h3>
      <div className="cn-wk2-chips cn-perf-chips" role="group" aria-label="Sort posts">{SORTS.map(s => <button key={s.k} type="button" aria-pressed={sort === s.k} onClick={() => setSort(s.k)}>{s.label}</button>)}</div>
    </div>
    <ol className="cn-perf-posts">
      <li className="cn-perf-row cn-perf-cols" aria-hidden="true"><span>Posted</span><span>Post</span><span>Impr.</span><span>React.</span><span>Comm.</span><span>Eng.</span><span>vs typical</span></li>
      {(all ? list : list.slice(0, 25)).map(p => <li key={p.id} className={`cn-perf-row${p.settled ? '' : ' is-fresh'}`} title={p.stalled ? 'Tracking stopped before this post had 3 days of numbers.' : undefined}>
        <span className="cn-perf-at">{whenWord(p.at, tz)}</span>
        <span className="cn-perf-title">{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a> : p.title}</span>
        <span data-k="Impressions">{n0(p.impressions)}</span>
        <span data-k="Reactions">{n0(p.reactions)}</span>
        <span data-k="Comments">{n0(p.comments)}</span>
        <span data-k="Engagement">{pct(p.rate)}</span>
        <span data-k="vs typical" className={!p.settled || p.vsTypical == null ? undefined : p.vsTypical >= 1.5 ? 'cn-perf-up' : p.vsTypical <= 0.67 ? 'cn-perf-down' : undefined}>{p.stalled ? 'not tracked' : !p.settled ? 'still counting' : p.vsTypical == null ? '–' : `${p.vsTypical >= 10 ? Math.round(p.vsTypical) : p.vsTypical.toFixed(1)}×`}</span>
        <span className="cn-perf-meta">{n0(p.impressions)} impressions · {n0(p.reactions)} reactions · {n0(p.comments)} comments · {pct(p.rate)}</span>
      </li>)}
    </ol>
    {list.length > 25 && <button type="button" className="cn-quiet-link" onClick={() => setAll(v => !v)}>{all ? 'Show top 25' : `Show all ${list.length} posts`}</button>}
  </>

  return <section className="cn-result-section cn-perf" aria-label="Post performance">
    <div className="cn-perf-top">
      <h2>Post performance</h2>
      {lane !== 'swishdm' && <div className="cn-wk2-chips cn-perf-chips" role="group" aria-label="Period">{PERIODS.map(x => <button key={x.p} type="button" aria-pressed={period === x.p} onClick={() => { setPeriod(x.p); setAll(false) }}>{x.label}</button>)}</div>}
    </div>
    {body}
  </section>
}
