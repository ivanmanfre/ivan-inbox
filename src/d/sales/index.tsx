import { useCallback, useMemo, useState } from 'react'
import { packsInWindow } from '../../wb/sales/match'
import { callStats, segmentCalls, type CallSegment } from '../../lib/transcripts'
import type { PlaceProps } from '../places'
import { dHash } from '../route'
import { useReportFailed } from '../shell/health'
import { AnswerRow } from '../ui/AnswerRow'
import { DIcon } from '../ui/icons'
import { Failed, Skeleton } from '../ui/states'
import { CallsOnRecord } from './Calls'
import { CallWindow } from './CallWindow'
import { FortnightList, PacksOnFile } from './Fortnight'
import { filterFortnight, SalesFilter, tokenLine, useSalesTokens } from './Filter'
import { moreThisWeek, nextCall, packIndex, readFortnight, throughLabel } from './model'
import { NextCallPlate } from './NextCall'
import { OrbitHost } from './OrbitHost'
import { useSalesData } from './useSalesData'
import './sales.css'

// D · SALES. Desktop: the next call (both clocks, Join, pack links) over the
// fortnight and the packs on file | calls on record | the call window (j / k).
// Phone: the plate, the fortnight, calls on record, packs; a call opens full
// page (`?call=`). Orbit is a tool in the answer row. Read only, all of it:
// the only things that leave are links (Join, packs) into new tabs.
// Hooks rule: every hook runs before any branch that returns.

const ORBIT = dHash('sales', 'orbit', { tenant: 'ivan', range: '30d' })
const SEGS: CallSegment[] = ['open', 'recent', 'all']

export default function SalesPage({ layout, route, navigate }: PlaceProps) {
  const data = useSalesData()
  const idx = useMemo(() => packIndex(data.packs), [data.packs])
  const f = useMemo(() => readFortnight(data.events, idx, data.calls, data.now), [data.events, idx, data.calls, data.now])
  const stats = useMemo(() => callStats(data.calls), [data.calls])
  const q = route.query
  const segQ = q.get('seg') as CallSegment | null
  const seg: CallSegment = segQ && SEGS.includes(segQ) ? segQ : stats.withActions > 0 ? 'open' : 'recent'
  const queue = useMemo(() => segmentCalls(data.calls, seg), [data.calls, seg])
  const want = q.get('call')
  const wanted = want ? queue.find(c => c.id === want) ?? data.calls.find(c => c.id === want) ?? null : null
  // Today's "This call didn't load": the address names a call the archive read does not hold.
  const missing = Boolean(want) && !wanted && data.state.calls === 'ok'
  const open = wanted ?? (layout === 'desktop' && !missing ? queue[0] ?? null : null)
  const [tokens, setTokens] = useSalesTokens()
  const shownF = useMemo(() => filterFortnight(f, tokens), [f, tokens])
  const packsIn = data.state.packs === 'ok' ? packsInWindow(data.events, idx.slugs, idx.meta) : null
  // Today's density A/B (rows or cards), same localStorage key.
  const [density, setDensity] = useState<'a' | 'b'>(() => { try { return localStorage.getItem('sales.density') === 'b' ? 'b' : 'a' } catch { return 'a' } })
  const flipDensity = useCallback(() => setDensity(d => {
    const next = d === 'a' ? 'b' : 'a'
    try { localStorage.setItem('sales.density', next) } catch { /* private window */ }
    return next
  }), [])
  const at = open ? queue.findIndex(c => c.id === open.id) + 1 : 0
  const go = useCallback((s: CallSegment, call?: string | null) => navigate(dHash('sales', null, call ? { seg: s, call } : { seg: s })), [navigate])
  const step = useCallback((d: 1 | -1) => {
    const i = at - 1 + d
    if (i >= 0 && i < queue.length) go(seg, queue[i].id)
  }, [at, queue, seg, go])
  const failedReads = (data.state.events === 'failed' ? 1 : 0) + (data.state.packs === 'failed' ? 1 : 0) + (data.state.calls === 'failed' ? 1 : 0)
  useReportFailed('sales', failedReads)

  // Orbit opens inside the frame; the default view is today's (Ivan, 30 days).
  const orbit = (
    <a href={ORBIT} className="sl-orbit" data-verb="open-orbit" onClick={e => { e.preventDefault(); navigate(ORBIT) }}><DIcon name="eye" /><span>Orbit</span></a>
  )
  const n = nextCall(f)
  const through = throughLabel(data.week.to)
  const from = throughLabel(data.week.from)
  const title = data.state.events === 'failed' ? <>Could not read the calendar.</>
    : data.state.events === 'loading' ? <>Reading the calendar…</>
      : n ? (n.phase === 'running'
        ? <>On now: <mark>{n.name}</mark>, until {n.endWarsaw} Warsaw.</>
        : <>Next call: {n.name}, <b className="d-n">{n.day.split(' ')[0]} {n.warsaw}</b>.</>)
        : <>No calls booked through {through}.</>
  const sub = n?.phase === 'running' ? '' : data.state.calls === 'ok' && stats.withActions > 0 ? `${stats.withActions} past calls still carry a promise.` : ''
  const answer = <AnswerRow title={title} sub={sub} tools={orbit} />

  if (route.sub === 'orbit') return <OrbitHost navigate={navigate} layout={layout} />

  const soft = [
    data.state.packs === 'failed' ? 'The packs did not load, so a call reading "no pack yet" may have one.' : '',
    data.state.calls === 'failed' && data.events.length > 0 ? 'The call reports did not load, so past calls show no report yet.' : '',
  ].filter(Boolean).join(' ')
  const cal = data.state.events === 'failed'
    ? <Failed what="the calendar" detail={`${data.eventsError} This is not an empty week, it is an unread one.`} onRetry={data.retry} />
    : data.state.events === 'loading' ? <Skeleton lines={5} label="Reading the calendar" />
      : <>
        <NextCallPlate r={n} through={through} from={from} more={moreThisWeek(f, n)} />
        {soft && <div className="sl-warn">{soft}<button type="button" data-verb="retry" onClick={data.retry}>Read again</button></div>}
        <FortnightList f={shownF} from={data.week.from} onReport={id => go('all', id)} packs={packsIn}
          filtered={tokenLine(tokens)} onClear={() => setTokens([])}
          tools={<span className="sl-tools">
            <SalesFilter tokens={tokens} setTokens={setTokens} />
            <button type="button" className="sl-pl" data-verb="density" onClick={flipDensity}>{density === 'a' ? 'as cards' : 'as rows'}</button>
          </span>} />
      </>
  const calls = (limit?: number) => (
    <CallsOnRecord calls={data.calls} state={data.state.calls} seg={seg} setSeg={s => go(s)} openId={open?.id ?? null}
      onOpen={id => go(seg, id)} onRetry={data.retry} limit={limit} />
  )

  if (layout === 'phone' && want && (open || missing)) {
    return (
      <div className="sl-page sl-phone sl-open">
        <div className="sl-back">
          <button type="button" className="d-ib" aria-label="Back to Sales" onClick={() => navigate(dHash('sales', null, { seg }))}><DIcon name="back" /></button>
          <div><small>Calls on record</small><b>{at} of {queue.length}, {seg === 'open' ? 'with action items' : seg === 'recent' ? 'last 7 days' : 'all calls'}</b></div>
        </div>
        <CallWindow row={open} at={at} of={queue.length} onStep={step} layout="phone" missing={missing} />
      </div>
    )
  }

  if (layout === 'phone') {
    return (
      <div className="sl-page sl-phone" data-density={density}>
        {answer}
        {cal}
        {calls(6)}
        {data.state.packs !== 'failed' && <PacksOnFile idx={idx} />}
      </div>
    )
  }

  return (
    <div className="sl-page sl-desktop" data-density={density}>
      {answer}
      <div className="sl-desk">
        <section className="sl-cal">{cal}{data.state.packs !== 'failed' && <PacksOnFile idx={idx} />}</section>
        <section className="sl-mid">{calls()}</section>
        <section className="sl-win"><CallWindow row={open} at={at} of={queue.length} onStep={step} layout="desktop" missing={missing} /></section>
      </div>
    </div>
  )
}
