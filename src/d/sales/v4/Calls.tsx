import { useEffect, useRef, useState } from 'react'
import { LEAD_LABEL, actionItems, callStats, leadLine, owedByMe, segmentCalls, type CallRow, type CallSegment } from '../../../lib/transcripts'
import { warsawDm } from '../../ui/time'
import { Segmented } from '../../../ds/Segmented'
import { callsByWeek, otherPerson } from './model'
import type { ReadState } from '../useSalesData'

// CALLS ON RECORD: three segments with their counts (unfinished business
// first), then the rows. Read only: nothing here marks an item done.

export const SEG_LABEL: Record<CallSegment, string> = { open: 'Action items', recent: 'Last 7 days', all: 'All' }

export function CallsOnRecord({ calls, state, seg, setSeg, openId, onOpen, onRetry, limit }: {
  calls: CallRow[]; state: ReadState; seg: CallSegment; setSeg: (s: CallSegment) => void
  openId: string | null; onOpen: (id: string) => void; onRetry: () => void; limit?: number
}) {
  const box = useRef<HTMLElement>(null)
  // The open call stays in view (a report or j / k can open one far down the list).
  useEffect(() => {
    if (!openId) return
    box.current?.querySelector(`[data-call="${openId.replace(/"/g, "")}"]`)?.scrollIntoView?.({ block: "nearest" })
  }, [openId, seg])
  const known = state === 'ok' || calls.length > 0
  const st = callStats(calls)
  const weeks = callsByWeek(calls, new Date(), state)
  const max = Math.max(1, ...(weeks?.map(w => w.n) ?? []))
  const queue = segmentCalls(calls, seg)
  const [more, setMore] = useState(false)
  const shown = limit && !more ? queue.slice(0, limit) : queue
  const counts: Record<CallSegment, number> = { open: st.withActions, recent: st.week, all: st.total }
  return (
    <section className="sl4-rec" aria-label="Calls on record" ref={box}>
      <div className="sl4-record-head"><h2 className="sl4-eyebrow">Calls on record</h2>{weeks && <div className="sl4-spark" aria-label="Calls in the last 8 weeks">{weeks.map(w => <button key={w.day} type="button" title={`Week of ${w.day}: ${w.n} calls${w.avg != null ? ` · ${w.avg}m avg` : ''}`} aria-label={`Week of ${w.day}: ${w.n} calls`}><i data-current={w.current} style={{ height: `${Math.max(2,w.n / max * 100)}%` }} /></button>)}</div>}</div>
      {state === 'failed' && (
        <div className="sl-warn">{calls.length ? 'The last read failed. These are the calls that loaded before it.' : 'The call archive did not load. This is not an empty archive, it is an unread one.'}
          <button type="button" data-verb="retry" onClick={onRetry}>Read again</button></div>
      )}
      {state === 'loading' && calls.length === 0 && <div className="sl-quiet">Reading the call archive…</div>}
      <Segmented markerId="sl4-segment" className="sl4-segments" label="Calls on record" value={seg} onChange={s => setSeg(s as CallSegment)} options={(['open','recent','all'] as CallSegment[]).map(s => ({ id: s, label: <>{s === 'recent' ? '7 days' : SEG_LABEL[s]} <b>{known ? counts[s] : state === 'failed' ? '?' : <span className="ols-skeleton" aria-label="Reading count" />}</b></> }))} />
      {state === 'ok' && queue.length === 0 && (
        <div className="sl-quiet">{seg === 'open' ? 'Nothing was left open on any call.' : seg === 'recent' ? 'No calls in the last seven days.' : 'No calls have been transcribed yet.'}</div>
      )}
      {shown.map(c => {
        const n = actionItems(c).length
        const mine = owedByMe(c)
        const lead = leadLine(c)
                return (
          <button key={c.id} type="button" className={`sl4-cr${c.id === openId ? ' sl-on' : ''}`} data-call={c.id} onClick={() => onOpen(c.id)}>
            <span className="sl4-crt"><b>{otherPerson(c)}</b>{n > 0 && <span>{mine > 0 ? `${mine} yours` : `${n} open`}</span>}</span>
            {lead && <span className="sl4-crl"><i>{LEAD_LABEL[lead.kind]}:</i> {lead.text}</span>}
            <span className="sl4-crm">{[c.date ? warsawDm(c.date) : 'date not recorded', c.duration_minutes ? `${c.duration_minutes}m` : ''].filter(Boolean).join(' · ')}</span>
          </button>
        )
      })}
      {limit && queue.length > limit && !more && (
        <button type="button" className="sl-fold" data-verb="show-more" onClick={() => setMore(true)}>
          <span>{queue.length - limit} more in this list</span><small>show them</small>
        </button>
      )}
    </section>
  )
}
