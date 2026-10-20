import type { Seat } from '../../seats'
import { INTEREST_LABEL } from '../interest'
import { fetchInterestPerf, type InterestPerf } from '../interestReads'
import { useRetryRead } from '../useRead'

export function InterestPerformanceRows({ rows, seat }: { rows: InterestPerf[]; seat: Seat }) {
  const mine = rows.filter(r => r.client_id === seat && (r.invites_7d || r.dms_7d || r.replied_7d || r.calls_30d))
    .sort((a, b) => b.invites_7d - a.invites_7d)
  if (!mine.length) return <p className="dl-fo">No interest-source sends this week.</p>
  return <div className="dl-cps">{mine.map(r => <div className="dl-cp" key={r.source_lane}>
    <span className="dl-cn">{INTEREST_LABEL[r.source_lane]}</span>
    <span className="dl-nums"><span><b>{r.invites_7d}</b>invites</span><span><b>{r.dms_7d}</b>DMs</span><span><b>{r.replied_7d}</b>replied</span><span><b>{r.calls_30d}</b>calls 30d</span></span>
    <span className="dl-ln">{r.accept_judged ? `${Math.round(100 * r.accept_72h / r.accept_judged)}% accepted · ${r.accept_72h} of ${r.accept_judged} judged` : 'Accept rate: no invitation is 72h old yet'}</span>
  </div>)}</div>
}

export function InterestPerformance({ seat }: { seat: Seat }) {
  const [read, retry] = useRetryRead(fetchInterestPerf, 'interest-performance-v1')
  return <section className="dl4-panel dl4-campaigns" data-band="interest-sources" data-seat={seat} data-bx-block>
    <h2>Interest sources <small>7 days</small></h2>
    {read.kind === 'ready' ? <InterestPerformanceRows rows={read.data} seat={seat} />
      : read.kind === 'failed' ? <p className="dl-fo dl-unk">Interest sources could not be read. <button type="button" onClick={retry}>Retry</button></p>
        : <p className="dl-fo dl-unk">Reading interest sources…</p>}
  </section>
}
