import { useEffect, useRef } from 'react'
import { LEAD_LABEL, actionItems, callStats, callTitle, leadLine, owedByMe, people, segmentCalls, type CallRow, type CallSegment } from '../../lib/transcripts'
import { warsawDm } from '../ui/time'
import type { ReadState } from './useSalesData'

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
  const st = callStats(calls)
  const queue = segmentCalls(calls, seg)
  const shown = limit ? queue.slice(0, limit) : queue
  const counts: Record<CallSegment, number> = { open: st.withActions, recent: st.week, all: st.total }
  return (
    <section className="sl-rec" aria-label="Calls on record" ref={box}>
      <div className="sl-sec"><span>Calls on record</span><span className="sl-rt">{st.total} kept · {st.meanMinutes}m average</span></div>
      {state === 'failed' && (
        <div className="sl-warn">{calls.length ? 'The last read failed. These are the calls that loaded before it.' : 'The call archive did not load. This is not an empty archive, it is an unread one.'}
          <button type="button" data-verb="retry" onClick={onRetry}>Read again</button></div>
      )}
      {state === 'loading' && calls.length === 0 && <div className="sl-quiet">Reading the call archive…</div>}
      <div className="sl-seg" role="tablist" aria-label="Calls on record">
        {(['open', 'recent', 'all'] as CallSegment[]).map(s => (
          <button key={s} type="button" role="tab" aria-selected={s === seg} className={s === seg ? 'sl-on' : ''} onClick={() => setSeg(s)}>
            {SEG_LABEL[s]} <b>{counts[s]}</b>
          </button>
        ))}
      </div>
      {state === 'ok' && queue.length === 0 && (
        <div className="sl-quiet">{seg === 'open' ? 'Nothing was left open on any call.' : seg === 'recent' ? 'No calls in the last seven days.' : 'No calls have been transcribed yet.'}</div>
      )}
      {shown.map(c => {
        const n = actionItems(c).length
        const mine = owedByMe(c)
        const lead = leadLine(c)
        const who = people(c.participants).slice(0, 3).join(', ')
        return (
          <button key={c.id} type="button" className={`sl-cr${c.id === openId ? ' sl-on' : ''}`} data-call={c.id} onClick={() => onOpen(c.id)}>
            <span className="sl-crt"><b>{callTitle(c.title)}</b>{n > 0 && <span>{mine > 0 ? `${mine} yours` : `${n} open`}</span>}</span>
            {lead && <span className="sl-crl"><i>{LEAD_LABEL[lead.kind]}:</i> {lead.text}</span>}
            <span className="sl-crm">{[c.date ? warsawDm(c.date) : 'date not recorded', c.duration_minutes ? `${c.duration_minutes}m` : '', who].filter(Boolean).join(' · ')}</span>
          </button>
        )
      })}
      {limit && queue.length > limit && <div className="sl-quiet">{queue.length - limit} more in this list: open one and step with Next.</div>}
    </section>
  )
}
