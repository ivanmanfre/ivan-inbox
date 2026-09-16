/* ==========================================================================
   WHO JOINED THE NETWORK. Sits under the roster section in the reach block.

   The section carries the one number the reach headline cannot: the audience
   the posts reach NEXT, which is the network the outreach engine is accepting
   into the seat today. Every share line carries its denominator, and under
   DRIFT_FLOOR placed accepts only the count renders. Failure here never hides
   the reach block: the section shows Failed with its own retry. All arithmetic
   lives in lib/drift.
   ========================================================================== */
import { useEffect, useMemo, useState } from 'react'
import { LANE_LABEL, type ContentLane } from '../../lib/content'
import type { PostAudienceRow } from '../../lib/reach'
import {
  DRIFT_DAYS, DRIFT_FLOOR, driftSummary, fetchNetworkDrift,
  type DriftBucket, type DriftRead,
} from '../../lib/drift'
import { num } from '../../lib/benchmark'
import { Failed } from './parts'
import './reach.css'

const TITLE = 'Who joined the network'

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

function shares(list: DriftBucket[]): string {
  return list.map(b => `${b.label} ${b.pct}%`).join(', ')
}

export function DriftView({ read, own, lane, now, onRetry }: {
  read: DriftRead | null
  own: PostAudienceRow[]
  lane: ContentLane
  now: number
  onRetry?: () => void
}) {
  const s = useMemo(() => (read?.kind === 'ready' ? driftSummary(read.joined, own, now) : null), [read, own, now])
  if (!read) {
    return <div className="a-reach-sec" data-reach-drift="loading"><div className="a-eyebrow">{TITLE}</div><div className="a-ct-sub">Reading the accepts…</div></div>
  }
  if (read.kind !== 'ready' || !s) {
    return <div className="a-reach-sec" data-reach-drift={read.kind}><div className="a-eyebrow">{TITLE}</div><Failed what="The network read" message={read.kind === 'ready' ? 'The accepts could not be summarised.' : read.message} onRetry={onRetry} /></div>
  }
  const who = LANE_LABEL[lane].split(' ')[0]
  const underFloor = s.recent.placed < DRIFT_FLOOR
  const lines: Array<{ key: string; text: string; note: string }> = []
  if (!underFloor) {
    lines.push({
      key: 'countries',
      text: `Countries: ${shares(s.recent.countries)}.`,
      note: `${num(s.recent.placed)} of ${num(s.recent.n)} accepts carry a country`,
    })
    if (s.recent.titles.length) {
      lines.push({
        key: 'titles',
        text: `Titles: ${shares(s.recent.titles)}.`,
        note: `top ${num(s.recent.titles.length)} of the titles on these accepts`,
      })
    }
    for (const sh of s.shifts) {
      lines.push({
        key: `shift-${sh.label}`,
        text: `${sh.label}: ${sh.recentPct}% of accepts now, ${sh.priorPct}% in the ${DRIFT_DAYS} days before.`,
        note: `${num(s.recent.placed)} vs ${num(s.prior.placed)} placed accepts`,
      })
    }
  }
  if (s.reachTop) {
    lines.push({
      key: 'reach',
      text: `${who}'s posts reach ${s.reachTop.city} most, ${s.reachTop.pct}% of members reached in the last 4 weeks. Accepts in ${s.reachTop.city} these ${DRIFT_DAYS} days: ${num(s.reachTop.joinedInCity)} of ${num(s.recent.n)}.`,
      note: `location share from the reach rows above; city match on the accept's location text`,
    })
  }
  return (
    <div className="a-reach-sec" data-reach-drift="ready" data-drift-recent={s.recent.n} data-drift-shifts={s.shifts.length} data-drift-reach={s.reachTop ? 1 : 0}>
      <div className="a-eyebrow">{TITLE}</div>
      <div className="a-ct-sub">
        {plural(s.recent.n, 'connection')} accepted through outreach in the last {DRIFT_DAYS} days, {num(s.prior.n)} in the {DRIFT_DAYS} before.
        {underFloor ? ` Under ${DRIFT_FLOOR} placed accepts, so no shares yet.` : ''}
      </div>
      {lines.length ? (
        <ul className="a-reach-ins">
          {lines.map(l => (
            <li key={l.key} className="a-reach-in" data-drift-line={l.key}>
              <span className="a-reach-in-t">{l.text}</span>
              <span className="a-mono a-dim-2 a-reach-in-n">{l.note}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="a-reach-foot">The network a post reaches next is the one the seat is accepting now. A post spreads to people like the network it came from, so the country mix here is the lever behind the location share above.</div>
    </div>
  )
}

export function DriftSection({ lane, own, now }: { lane: ContentLane; own: PostAudienceRow[]; now: number }) {
  const [read, setRead] = useState<{ lane: ContentLane; read: DriftRead } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setRead(null)
    fetchNetworkDrift(lane)
      .then(r => { if (live) setRead({ lane, read: r }) })
      .catch(e => { if (live) setRead({ lane, read: { kind: 'failed', message: e instanceof Error ? e.message : 'The network could not be read.' } }) })
    return () => { live = false }
  }, [lane, tick])
  const current = read?.lane === lane ? read.read : null
  return <DriftView read={current} own={own} lane={lane} now={now} onRetry={() => setTick(t => t + 1)} />
}
