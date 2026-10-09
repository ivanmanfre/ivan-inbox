import { useMotionLevel } from '../../../ds/motionLevel'
import { useCallback, useMemo, useState } from 'react'
import { packsInWindow } from '../../../wb/sales/match'
import { callStats, segmentCalls, type CallSegment } from '../../../lib/transcripts'
import type { PlaceProps } from '../../places'
import { dHash } from '../../route'
import { useReportFailed } from '../../shell/health'
import { AnswerRow } from '../../ui/AnswerRow'
import { DIcon } from '../../ui/icons'
import { Failed, Skeleton } from '../../ui/states'
import { CallsOnRecord } from './Calls'
import { Window } from './Window'
import { Schedule } from './Schedule'
import { Segmented } from '../../../ds/Segmented'
import { filterFortnight, SalesFilter, tokenLine, useSalesTokens } from '../Filter'
import { nextCall, packIndex, readFortnight, throughLabel } from '../model'
import { OrbitHost } from '../OrbitHost'
import { useSalesData } from '../useSalesData'
import '../sales.css'
import './sales4.css'

// D · SALES. Desktop: the next call (both clocks, Join, pack links) over the
// fortnight and the packs on file | calls on record | the call window (j / k).
// Phone: the plate, the fortnight, calls on record, packs; a call opens full
// page (`?call=`). Orbit is a tool in the answer row. Read only, all of it:
// the only things that leave are links (Join, packs) into new tabs.
// Hooks rule: every hook runs before any branch that returns.

const ORBIT = dHash('sales', 'orbit', { tenant: 'ivan', range: '30d' })
const SEGS: CallSegment[] = ['open', 'recent', 'all']

export default function SalesPage({ layout, route, navigate }: PlaceProps) {
  const motion = useMotionLevel()
  const data = useSalesData()
  const [rail, setRail] = useState<'schedule' | 'calls'>('schedule')
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
  const packsIn = data.state.packs === 'ok' || data.packs.length > 0 ? packsInWindow(data.events, idx.slugs, idx.meta) : null
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
  const title = data.state.events === 'failed' && !data.events.length ? <>Could not read the calendar.</>
    : data.state.events === 'loading' ? <>Reading the calendar…</>
      : n ? (n.phase === 'running'
        ? <>On now: <mark>{n.name}</mark>, until {n.endWarsaw} Warsaw.</>
        : <>Next call: {n.name}, <b className="d-n">{n.day.split(' ')[0]} {n.warsaw}</b>.</>)
        : <>No calls booked through {through}.</>
  // One headline; the open promises are the "Action items" tab's count.
  const savedLine = Object.entries(data.saved).filter(([, saved]) => saved).map(([key]) => key).join(', ')
  const answer = <AnswerRow title={title} sub={savedLine ? `Showing saved ${savedLine}.` : undefined} tools={orbit} />

  if (route.sub === 'orbit') return <OrbitHost navigate={navigate} layout={layout} />

  const soft = [
    data.state.events === 'failed' && data.events.length > 0 ? `The calendar refresh failed (${data.eventsError}); showing the last read.` : '',
    data.state.packs === 'failed' ? data.packs.length > 0 ? 'The packs refresh failed; showing the last read.' : 'The packs did not load, so a call reading "no pack yet" may have one.' : '',
    data.state.calls === 'failed' && data.events.length > 0 ? 'The call reports did not load, so past calls show no report yet.' : '',
  ].filter(Boolean).join(' ')
  const cal = data.state.events === 'failed' && !data.events.length
    ? <Failed what="the calendar" detail={`${data.eventsError} This is not an empty week, it is an unread one.`} onRetry={data.retry} />
    : data.state.events === 'loading' ? <Skeleton lines={5} label="Reading the calendar" />
      : <>
        {soft && <div className="sl-warn">{soft}<button type="button" data-verb="retry" onClick={data.retry}>Read again</button></div>}
        <Schedule f={f} shown={shownF} now={data.now} next={n} idx={idx} packs={packsIn} tools={<SalesFilter tokens={tokens} setTokens={setTokens} />} filtered={tokenLine(tokens)} clear={() => setTokens([])} report={id => go('all', id)} packsFailed={data.state.packs === 'failed' && data.packs.length === 0} />
      </>

  const calls = (limit?: number) => (
    <CallsOnRecord calls={data.calls} state={data.state.calls} seg={seg} setSeg={s => go(s)} openId={open?.id ?? null}
      onOpen={id => go(seg, id)} onRetry={data.retry} limit={limit} />
  )

  if (layout === 'phone' && want && (open || missing)) {
    return (
      <div data-motion={motion} className="sl4 sl4-phone sl4-open" data-layout-v4="sales">
        <div className="sl-back">
          <button type="button" className="d-ib" aria-label="Back to Sales" onClick={() => navigate(dHash('sales', null, { seg }))}><DIcon name="back" /></button>
          <div><small>Calls on record</small><b>{at} of {queue.length}, {seg === 'open' ? 'with action items' : seg === 'recent' ? 'last 7 days' : 'all calls'}</b></div>
        </div>
        <Window row={open} at={at} of={queue.length} onStep={step} layout="phone" missing={missing} />
      </div>
    )
  }

  if (layout === 'phone') {
    return (
      <div data-motion={motion} className="sl4 sl4-phone" data-layout-v4="sales">
        {answer}
        {cal}
        {calls(6)}
      </div>
    )
  }

  return (
    <div data-motion={motion} className="sl4 sl4-desktop" data-layout-v4="sales">
      {answer}
      <div className="sl4-desk" data-rail={rail}>
        <div className="sl4-rail-tabs"><Segmented markerId="sl4-rail" label="Sales rail" value={rail} options={[{ id:'schedule', label:'Schedule' }, { id:'calls', label:'Calls' }]} onChange={r => setRail(r as 'schedule' | 'calls')} /></div>
        <section className="sl4-cal" data-d-scroll>{cal}</section>
        <section className="sl4-mid">{calls()}</section>
        <section className="sl4-win"><Window row={open} at={at} of={queue.length} onStep={step} layout="desktop" missing={missing} /></section>
      </div>
    </div>
  )
}
