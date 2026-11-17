/* Acceptance, replies and calls per week of invites: the current Warsaw week
   and the 7 before it, oldest first, so the rows keep moving with the
   calendar. A recorded targeting change is a note on the week it took effect,
   never a period of its own. Read-only. */
import { fetchAdjustmentCohorts, type AdjustmentCohort } from '../../lib/laneAdjustments'
import type { Seat } from '../seats'
import { useRetryRead } from './useRead'
import './changeRates.css'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
// Date-only strings: read the parts, never a local timestamp.
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
const span = (r: AdjustmentCohort) => r.period_to == null ? `${day(r.period_from)} on`
  : r.period_to === r.period_from ? day(r.period_from) : `${day(r.period_from)} to ${day(r.period_to)}`
const rate = (hit: number, base: number) => base > 0 ? hit / base * 100 : null
const n = (v: number) => Number(v).toLocaleString('en-US')
const calls = (v: number) => `${n(v)} call${Number(v) === 1 ? '' : 's'}`

export function ChangeRateRows({ rows, seat }: { rows: AdjustmentCohort[]; seat: Seat }) {
  const all = rows.filter(r => r.client_id === seat).sort((a, b) => a.period_from.localeCompare(b.period_from))
  // A seat that started inside the window opens on its first week with an invite or a noted change, never on empty rows.
  const first = all.findIndex(r => Number(r.invites) > 0 || Boolean(r.label))
  const mine = first < 0 ? [] : all.slice(first)
  if (mine.length === 0) return <p className="dl-chg-note">No invite went out on this seat in the last 8 weeks.</p>
  const top = Math.max(0, ...mine.map(r => rate(r.accepted, r.accept_base) ?? 0))
  const max = Math.max(10, Math.ceil(top / 10) * 10)
  return <>
    <ol className="dl-chg-rows">{mine.map(r => {
      const acc = rate(r.accepted, r.accept_base), rep = rate(r.replied, r.reply_base)
      const young = r.invites - r.accept_base
      return <li key={r.period_from} className={r.accept_base > 0 && r.accept_base < 20 ? 'dl-chg-thin' : undefined}>
        <div className="dl-chg-l"><b>{span(r)}</b>{r.label && <small>{r.label}</small>}</div>
        <span className="dl-chg-k" aria-hidden="true"><i style={{ width: `${acc == null ? 0 : Math.max(acc > 0 ? 1.5 : 0, acc / max * 100)}%` }} /></span>
        <div className="dl-chg-v">{acc == null ? <span>{Number(r.invites) === 0 ? 'No invites sent' : 'No invite old enough yet'}</span>
          : <><b>{acc.toFixed(1)}%</b><small>{n(r.accepted)} of {n(r.accept_base)} accepted</small></>}
          {young > 0 && <small>{n(young)} under 72 hours</small>}</div>
        {/* A period still filling has few invites past 7 days, so its raw reply count is shown beside the rate. */}
        <p className="dl-chg-sub">{rep == null ? `${n(r.replied_so_far)} replied so far` : `Replied within 7 days: ${rep.toFixed(1)}% (${n(r.replied)} of ${n(r.reply_base)})${r.reply_base < r.invites ? `, ${n(r.replied_so_far)} replied so far` : ''}`} · {calls(r.calls)}</p>
      </li>
    })}</ol>
    <p className="dl-chg-note">Bar length: 0 to {max}%. Each row is one week of invites, Monday to Sunday, Warsaw dates. The line under a week names a targeting change that took effect in it. Acceptance counts invites that have had 72 hours. Replies count invites that have had 7 days, without reactions, vendor pitches or auto-replies. Calls are every call booked by people in the row. Counts below 20 are a small sample.</p>
  </>
}

export function ChangeRates({ seat }: { seat: Seat }) {
  const [read, retry] = useRetryRead(fetchAdjustmentCohorts, 'lane-adjustment-cohorts')
  return <section className="dl4-panel dl-chg" aria-label="Acceptance by week" data-bx-block>
    <h2>Acceptance by week</h2>
    {read.kind === 'ready' ? <ChangeRateRows rows={read.data} seat={seat} />
      : read.kind === 'failed' ? <p role="status" className="dl-chg-note">These rates could not be read. <button type="button" onClick={retry}>Retry</button></p>
        : <p role="status" className="dl-chg-note">Reading rates…</p>}
  </section>
}
