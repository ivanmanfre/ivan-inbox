import { Fragment, useEffect, useRef, useState } from 'react'
import { talkLine, type CallRow } from '../../../lib/transcripts'
import { warsawDm } from '../../ui/time'
import { Segmented } from '../../../ds/Segmented'
import { callsByWeek, otherPerson } from './model'
import type { ReadState } from '../useSalesData'
import { archiveActions, ARCHIVE_TABS, clientRecorder, type ArchiveTab } from '../archive'

export function CallsOnRecord({ lists, state, seg, setSeg, openId, onOpen, onRetry, limit, now = new Date() }: {
  lists: Record<ArchiveTab, CallRow[]>; state: ReadState; seg: ArchiveTab; setSeg: (tab: ArchiveTab) => void
  openId: string | null; onOpen: (id: string) => void; onRetry: () => void; limit?: number; now?: Date
}) {
  const box = useRef<HTMLElement>(null)
  // The open call stays in view (a report or j / k can open one far down the list).
  useEffect(() => {
    if (!openId) return
    box.current?.querySelector(`[data-call="${openId.replace(/"/g, "")}"]`)?.scrollIntoView?.({ block: "nearest" })
  }, [openId, seg])
  const queue = lists[seg]
  const known = state === 'ok' || lists.all.length > 0
  const weeks = callsByWeek(queue, now, state)
  const max = Math.max(1, ...(weeks?.map(w => w.n) ?? []))
  const [more, setMore] = useState(false)
  const shown = limit && !more ? queue.slice(0, limit) : queue
  return (
    <section className="sl4-rec" aria-label="Calls on record" ref={box}>
      <div className="sl4-record-head"><h2 className="sl4-eyebrow">Calls on record</h2>{weeks && <div className="sl4-spark" aria-label="Calls in the last 8 weeks">{weeks.map(w => <button key={w.day} type="button" title={`Week of ${w.day}: ${w.n} calls${w.avg != null ? ` · ${w.avg}m avg` : ''}`} aria-label={`Week of ${w.day}: ${w.n} calls`}><i data-current={w.current} style={{ height: `${Math.max(2,w.n / max * 100)}%` }} /></button>)}</div>}</div>
      {state === 'failed' && (
        <div className="sl-warn">{lists.all.length ? 'The last read failed. These are the calls that loaded before it.' : 'The call archive did not load. This is not an empty archive, it is an unread one.'}
          <button type="button" data-verb="retry" onClick={onRetry}>Read again</button></div>
      )}
      {state === 'loading' && lists.all.length === 0 && <div className="sl-quiet">Reading the call archive…</div>}
      <Segmented markerId="sl4-segment" className="sl4-segments" label="Calls on record" value={seg} onChange={s => setSeg(s as ArchiveTab)} options={ARCHIVE_TABS.map(tab => ({ id: tab.id, label: <>{tab.label} <b>{known ? lists[tab.id].length : state === 'failed' ? '?' : <span className="ols-skeleton" aria-label="Reading count" />}</b></> }))} />
      {state === 'ok' && queue.length === 0 && (
        <div className="sl-quiet">{ARCHIVE_TABS.find(tab => tab.id === seg)?.empty}</div>
      )}
      {shown.map((c, index) => {
        const n = archiveActions(c).length
        const preview = c.brief?.next_step?.trim() || c.summary?.trim()
        const recorder = clientRecorder(c)
        const group = seg === 'clients' && (index === 0 || Boolean(recorder) !== Boolean(clientRecorder(shown[index - 1])))
        const talk = talkLine(c)
        return (
          <Fragment key={c.id}>
            {group && <h3 className="sl-client-group">{recorder ? 'Client team recordings' : 'Your client calls'}</h3>}
            <button type="button" className={`sl4-cr${c.id === openId ? ' sl-on' : ''}`} data-call={c.id} onClick={() => onOpen(c.id)}>
              <span className="sl4-crt"><b>{otherPerson(c)}</b><span className="sl4-crm">{[recorder, c.date ? warsawDm(c.date) : 'no date'].filter(Boolean).join(' · ')}</span></span>
              {talk && <span className={`sl4-crtalk${talk.warn ? ' sl4-warn' : ''}`} data-talk>{talk.text}</span>}
              <span className="sl4-crb">
                <span className="sl4-crl">{preview}</span>
                {n > 0 && <span className="sl4-crn">{n} {n === 1 ? 'action' : 'actions'}</span>}
              </span>
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
