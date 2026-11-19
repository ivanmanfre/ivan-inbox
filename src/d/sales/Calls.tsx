import { Fragment, useEffect, useRef, useState } from 'react'
import { callStats, callTitle, people, type CallRow } from '../../lib/transcripts'
import { warsawDm } from '../ui/time'
import type { ReadState } from './useSalesData'
import { archiveActions, ARCHIVE_TABS, clientRecorder, type ArchiveTab } from './archive'

export function CallsOnRecord({ lists, state, seg, setSeg, openId, onOpen, onRetry, limit }: {
  lists: Record<ArchiveTab, CallRow[]>; state: ReadState; seg: ArchiveTab; setSeg: (tab: ArchiveTab) => void
  openId: string | null; onOpen: (id: string) => void; onRetry: () => void; limit?: number
}) {
  const box = useRef<HTMLElement>(null)
  // The open call stays in view (a report or j / k can open one far down the list).
  useEffect(() => {
    if (!openId) return
    box.current?.querySelector(`[data-call="${openId.replace(/"/g, "")}"]`)?.scrollIntoView?.({ block: "nearest" })
  }, [openId, seg])
  const queue = lists[seg]
  const known = state === 'ok' || lists.all.length > 0
  const st = callStats(queue)
  const [more, setMore] = useState(false)
  const shown = limit && !more ? queue.slice(0, limit) : queue
  return (
    <section className="sl-rec" aria-label="Calls on record" ref={box}>
      <div className="sl-sec"><span>Calls on record</span><span className="sl-rt" title={known ? `${st.total} kept · ${st.meanMinutes}m average` : 'Call archive unverified'}>{known ? `${st.meanMinutes}m avg` : state === 'failed' ? '?' : <span className="ols-skeleton" aria-label="Reading average" />}</span></div>
      {state === 'failed' && (
        <div className="sl-warn">{lists.all.length ? 'The last read failed. These are the calls that loaded before it.' : 'The call archive did not load. This is not an empty archive, it is an unread one.'}
          <button type="button" data-verb="retry" onClick={onRetry}>Read again</button></div>
      )}
      {state === 'loading' && lists.all.length === 0 && <div className="sl-quiet">Reading the call archive…</div>}
      <div className="sl-seg" role="tablist" aria-label="Calls on record">
        {ARCHIVE_TABS.map(tab => (
          <button key={tab.id} type="button" role="tab" aria-selected={tab.id === seg} className={tab.id === seg ? 'sl-on' : ''} onClick={() => setSeg(tab.id)}>
            {tab.label} <b>{known ? lists[tab.id].length : state === 'failed' ? '?' : <span className="ols-skeleton" aria-label="Reading count" />}</b>
          </button>
        ))}
      </div>
      {state === 'ok' && queue.length === 0 && (
        <div className="sl-quiet">{ARCHIVE_TABS.find(tab => tab.id === seg)?.empty}</div>
      )}
      {shown.map((c, index) => {
        const n = archiveActions(c).length
        const preview = c.brief?.next_step?.trim() || c.summary?.trim()
        const recorder = clientRecorder(c)
        const group = seg === 'clients' && (index === 0 || Boolean(recorder) !== Boolean(clientRecorder(shown[index - 1])))
        const who = people(c.participants).slice(0, 3).join(', ')
        return (
          <Fragment key={c.id}>
            {group && <h3 className="sl-client-group">{recorder ? 'Client team recordings' : 'Your client calls'}</h3>}
            <button type="button" className={`sl-cr${c.id === openId ? ' sl-on' : ''}`} data-call={c.id} onClick={() => onOpen(c.id)}>
              <span className="sl-crt"><b>{callTitle(c.title)}</b>{n > 0 && <span>{n} {n === 1 ? 'action' : 'actions'}</span>}</span>
              {preview && <span className="sl-crl">{preview}</span>}
              <span className="sl-crm">{[recorder, c.date ? warsawDm(c.date) : 'date not recorded', c.duration_minutes ? `${c.duration_minutes}m` : '', who].filter(Boolean).join(' · ')}</span>
            </button>
          </Fragment>
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
