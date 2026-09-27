/* Delivery by seat and by lane: today's DeliverySection (wb/sends/Control.tsx)
   as a D sheet. Per seat: invites / DMs / InMail with unique people (never
   added together), accepted ≤72h and replied ≤72h cohorts ("n of m invited"
   when no matured denominator exists, never a made-up rate), repliers. The
   attempted / refused / phantom disclosure, the source-lane table, the compare
   (only between two COMPLETE windows of equal length; small cohorts flagged),
   today as a partial day, and the payload's own notes. Read-only. */
import type { ReactNode } from 'react'
import type { CcCohort, CcPayload, CcRangeRow } from '../../lib/campaignControl'
import { SEATS, SEAT_NAME } from '../seats'
import { Sheet } from '../ui/Sheet'
import { Shs } from './CampaignSheet'
import { comparable, type Range } from './model'

const CH: Record<string, string> = { invitation: 'Invites', dm: 'DMs', inmail: 'InMail' }
const n = (v: number | null | undefined) => (v == null ? '?' : v.toLocaleString('en-US'))

export function cohortText(c: CcCohort | null | undefined, hit: 'accepted_within_72h' | 'replied_within_72h'): ReactNode {
  if (!c) return <span className="dl-dimt">no cohort</span>
  const h = c[hit]
  if (c.matured_denominator == null) {
    const base = hit === 'accepted_within_72h' ? c.invited : c.first_messaged
    return base != null ? <>{n(h)} of {n(base)} {hit === 'accepted_within_72h' ? 'invited' : 'first messaged'}</> : <>{n(h)} <span className="dl-dimt">no denominator</span></>
  }
  return <>{n(h)} / {n(c.matured_denominator)} <span className="dl-dimt">({c.rate_pct == null ? '—' : `${c.rate_pct}%`})</span></>
}

export function DeliverySheet({ p, pFailed = null, range, onClose }: { p: CcPayload | null; pFailed?: string | null; range: Range; onClose: () => void }) {
  const iv = p?.ranges.intervals.find(i => i.name === range) ?? null
  const row = (seat: string, ch: string, interval: string = range): CcRangeRow | undefined =>
    p?.ranges.rows.find(r => r.client_id === seat && r.channel === ch && r.interval === interval && r.source_lane === '__all__')
  const cmp = p ? comparable(p, range) : null
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title="Delivery by seat and lane"
      sub={!p ? undefined : iv ? `${iv.from.slice(0, 10)} to ${iv.to.slice(0, 10)} · ${iv.days} days · ${p!.ranges.tz}. Confirmed sends only.` : `No ${range} window in this snapshot.`}>
      {!p ? <p className={`dl-sl ${pFailed ? 'dl-bad' : 'dl-unk'}`}>{pFailed ? `The send monitor could not be read: ${pFailed}` : 'Reading the send monitor…'}</p> : !iv ? null : <>
        <table className="dl-steps"><thead><tr><th>Seat</th><th>Invites</th><th>DMs</th><th>InMail</th><th>Accepted ≤72h</th><th>Replied ≤72h</th></tr></thead><tbody>
          {SEATS.map(s => {
            const i = row(s, 'invitation'), d = row(s, 'dm'), m = row(s, 'inmail')
            const cell = (r?: CcRangeRow) => r ? <>{n(r.sent)} <span className="dl-dimt">{n(r.unique_recipients)} people</span></> : <span className="dl-dimt">no row</span>
            return <tr key={s}><td>{SEAT_NAME[s]}</td><td className="dl-m">{cell(i)}</td><td className="dl-m">{cell(d)}</td><td className="dl-m">{cell(m)}</td>
              <td className="dl-m">{cohortText(i?.acceptance_cohort, 'accepted_within_72h')}</td>
              <td className="dl-m">{d ? <>{cohortText(d.reply_cohort, 'replied_within_72h')} <span className="dl-dimt">{n(d.replies_people)} repliers</span></> : <span className="dl-dimt">no row</span>}</td></tr>
          })}
        </tbody></table>
        <p className="dl-sl">{SEATS.map(s => { const i = row(s, 'invitation'); return `${SEAT_NAME[s]}: ${n(i?.attempted)} invites attempted, ${n(i?.failed)} refused, ${n(i?.phantom)} phantom rows that never left the seat` }).join('. ')}. A cohort shown as "n of m" has no matured denominator, so no rate is shown.</p>
        {SEATS.map(s => {
          const rows = p.ranges.rows.filter(r => r.client_id === s && r.interval === range && r.source_lane !== '__all__' && r.sent)
          return rows.length ? <div key={s}>
            <Shs>{SEAT_NAME[s]}, by source lane</Shs>
            <table className="dl-steps"><thead><tr><th>Lane</th><th>Channel</th><th>Sent</th><th>People</th></tr></thead><tbody>
              {rows.sort((a, b) => b.sent - a.sent).map(r => <tr key={`${r.channel}:${r.source_lane}`}><td>{r.source_lane.replace(/_/g, ' ')}</td><td>{CH[r.channel] ?? r.channel}</td><td className="dl-m">{r.sent}</td><td className="dl-m">{n(r.unique_recipients)}</td></tr>)}
            </tbody></table>
          </div> : null
        })}
        <Shs>Against the previous {iv.days} days</Shs>
        {cmp && cmp.rows.length ? cmp.rows.map(r => (
          <p className="dl-sl dl-m" key={`${r.client_id}:${r.channel}`}>{SEAT_NAME[r.client_id as 'ivan'] ?? r.client_id} {CH[r.channel] ?? r.channel}: {r.sent_current} against {r.sent_previous} ({r.delta >= 0 ? '+' : ''}{r.delta})
            {r.delta_pp == null ? ' · no matured cohort on both sides' : ` · accept ${r.accept_rate_current_pct}% against ${r.accept_rate_previous_pct}%, ${r.delta_pp >= 0 ? '+' : ''}${r.delta_pp}pp${r.small_cohort ? ' · small cohort' : ''}`}</p>
        )) : <p className="dl-sl">No comparison for this window: a comparison needs two complete windows of equal length.</p>}
        {p.ranges.intervals.some(i => i.name === 'today') && <>
          <Shs>Today, a partial day, never compared</Shs>
          <p className="dl-sl dl-m">{SEATS.map(s => ['invitation', 'dm', 'inmail'].map(ch => { const r = row(s, ch, 'today'); return r ? `${SEAT_NAME[s]} ${CH[ch]} ${r.sent}` : null }).filter(Boolean).join(' · ')).filter(Boolean).join(' | ')}</p>
        </>}
        {p.ranges.notes.length > 0 && <p className="dl-sl dl-dimt">{p.ranges.notes.join(' · ')}</p>}
      </>}
    </Sheet>
  )
}
