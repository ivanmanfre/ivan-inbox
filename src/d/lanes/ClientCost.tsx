import { useEffect, useState } from 'react'
import { isStale, relAge } from '../../lib/money'
import { dHash } from '../route'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import type { LaneDayRow } from '../../lib/money'
import { fetchCostLaneDays, summarizeClientCost, type CostBucket, type CostPeriod } from './clientCostData'
import './clientCost.css'

const usd = (n: number) => n > 0 && n < 0.005 ? '<$0.01' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function ProviderRows({ title, buckets, now, assigned }: { title: string; buckets: CostBucket[]; now: number; assigned: boolean }) {
  return <div className="dl-cost-group">
    <h4>{title}</h4>
    {buckets.length === 0 ? <p className="dl-cost-empty">No recorded rows. Coverage is unknown.</p> :
      <div className="dl-cost-list">{buckets.map(b => <div className="dl-cost-row" key={b.vendor}>
        <div className="dl-cost-provider"><b>{b.vendor}</b><span>{b.vendor !== 'anthropic_api' && <>{b.runs} recorded {b.runs === 1 ? 'run' : 'runs'} · </>}observed {relAge(b.observedAt, now)}{isStale(b.observedAt, now) ? ' · stale' : ''}</span></div>
        <div className="dl-cost-value">
          <strong>{b.recorded !== null ? usd(b.recorded) : b.tokenEstimate !== null ? `${usd(b.tokenEstimate)} estimate` : 'Unknown'}</strong>
          <span>{b.recorded !== null ? 'recorded amount · ' : ''}{assigned ? 'inferred lane tag' : 'shared, owner unknown'}</span>
          {((b.vendor !== 'anthropic_api' && b.unsettledRuns > 0) || b.malformed > 0 || b.tokenEstimate !== null || b.presettle !== null) && <span>{[
            b.tokenEstimate !== null ? 'token-priced usage estimate' : null,
            b.presettle !== null ? `${usd(b.presettle)} presettle reading (separate)` : null,
            b.vendor !== 'anthropic_api' && b.unsettledRuns > 0 ? `${b.unsettledRuns} unsettled` : null,
            b.malformed > 0 ? `${b.malformed} invalid amount` : null,
          ].filter(Boolean).join(' · ')}</span>}
        </div>
      </div>)}</div>}
  </div>
}

export function ClientCost({ seat }: { seat: Seat }) {
  const [period, setPeriod] = useState<CostPeriod>(7)
  const [all, setAll] = useState(false)
  const [state, setState] = useState<{ rows: LaneDayRow[]; error: string | null; loadedAt: number | null }>({ rows: [], error: null, loadedAt: null })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setState({ rows: [], error: null, loadedAt: null })
    fetchCostLaneDays(period, Date.now(), controller.signal).then(rows => {
      if (live) setState({ rows, error: null, loadedAt: Date.now() })
    }).catch(error => {
      if (live) setState({ rows: [], error: error instanceof Error ? error.message : 'Cost read failed', loadedAt: null })
    })
    return () => { live = false; controller.abort() }
  }, [period, retry])
  const summary = state.loadedAt === null ? null : summarizeClientCost(state.rows)
  return <div className="dl-cost">
    <div className="dl-cost-controls" aria-label="Cost view">
      <div className="dl-cost-pick"><button type="button" aria-pressed={!all} onClick={() => setAll(false)}>{SEAT_NAME[seat]}</button><button type="button" aria-pressed={all} onClick={() => setAll(true)}>All clients</button></div>
      <div className="dl-cost-pick"><button type="button" aria-pressed={period === 7} onClick={() => setPeriod(7)}>7 days</button><button type="button" aria-pressed={period === 30} onClick={() => setPeriod(30)}>30 days</button></div>
    </div>
    <p className="dl-cost-warning" role="note"><b>Partial recorded allocation.</b> Engine spend can remain in unassigned shared usage even when a client's rows look small. Provider presence and full client cost are unknown.</p>
    <p className="dl-cost-note">Daily provider aggregates for {period} UTC calendar days including today. Seat ownership comes from inferred lane tags. The view has no run-level attribution evidence.</p>
    {state.error ? <p className="dl-cost-error" role="alert">Cost read failed: {state.error}. <button type="button" onClick={() => setRetry(v => v + 1)}>Retry</button></p> :
      !summary ? <p className="dl-cost-empty" role="status">Reading recorded costs…</p> : <>
        <div className="dl-cost-groups">{(all ? SEATS : [seat]).map(s => <ProviderRows key={s} title={SEAT_NAME[s]} buckets={summary.bySeat[s]} now={state.loadedAt!} assigned />)}</div>
        <ProviderRows title="Unassigned shared usage" buckets={summary.unassigned} now={state.loadedAt!} assigned={false} />
        <p className="dl-cost-note">Unassigned usage stays outside client allocations. Harvest and SC feed coverage is missing here. Absent provider rows leave spend unknown. Anthropic token-priced usage is shown as an estimate. Other source kinds are unavailable in this view.</p>
        <p className="dl-cost-read">Read {relAge(new Date(state.loadedAt!).toISOString())} · vs_lane_day_v · {state.rows.length} daily provider rows</p>
      </>}
    <a className="dl-cost-link" href={dHash('settings', 'money')}>Open Money for the deeper ledger →</a>
  </div>
}
