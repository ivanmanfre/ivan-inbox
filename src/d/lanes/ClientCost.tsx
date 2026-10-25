import { useEffect, useState } from 'react'
import { relAge } from '../../lib/money'
import { dHash } from '../route'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import { fetchClientProviderCosts, summarizeClientCost, type ClientProviderCosts, type CostPeriod, type Evidence, type ProviderAccount, type ProviderCostRow } from './clientCostData'
import './clientCost.css'

const providerName = { apify: 'Apify', harvestapi: 'HarvestAPI', scrapecreators: 'ScrapeCreators' }
const usd = (n: number | null) => n === null ? 'Unknown' : n > 0 && n < 0.005 ? '<$0.01' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const credits = (n: number | null) => n === null ? 'Unknown' : `${n.toLocaleString('en-US')} credits`
const label = (value: string) => value.replaceAll('_', ' ')
const age = (value: string | null) => value ? relAge(value) : 'unknown'

function EvidenceLine({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return null
  return <ul className="dl-cost-evidence">{evidence.map((e, index) =>
    <li key={`${e.basis}:${e.source}:${index}`}>{label(e.basis)} · {e.confidence} · {label(e.method)} · {e.freshness} · {e.coverage} · observed {age(e.observed_at)}</li>
  )}</ul>
}

function ProviderRow({ row }: { row: ProviderCostRow }) {
  const m = row.measures
  const headline = row.provider === 'apify' ? usd(m.apify_settled_usd) : row.provider === 'harvestapi' ? usd(m.harvest_booked_usd) : credits(m.supplier_credits)
  const basis = row.provider === 'apify' ? 'Settled run usage' : row.provider === 'harvestapi' ? 'Booked attempts / meter' : 'Supplier credits'
  return <div className="dl-cost-row" data-provider={row.provider}>
    <div className="dl-cost-provider"><b>{providerName[row.provider]}</b><span>{row.coverage} coverage · {row.freshness} feed · last success {age(row.last_success_at)}</span></div>
    <div className="dl-cost-value"><strong>{headline}</strong><span>{basis}</span>
      {row.provider === 'apify' && m.apify_presettle_usd !== null && <span>Presettle reading {usd(m.apify_presettle_usd)} · separate</span>}
      {row.provider === 'apify' && m.unsettled_runs !== null && m.unsettled_runs > 0 && <span>{m.unsettled_runs} unsettled runs</span>}
      {row.provider === 'harvestapi' && m.requests !== null && <span>{m.requests} booked requests</span>}
      {row.provider === 'scrapecreators' && <>
        <span>Producer-observed credits · overlaps account usage: {credits(m.producer_credits)}</span>
        <span>Supplier replacement value {usd(m.supplier_credit_value_usd)} · producer replacement value {usd(m.producer_credit_value_usd)}</span>
        <span>Cash paid {usd(m.cash_paid_usd)}</span>
        {m.producer_attempts !== null && <span>{m.producer_attempts} producer attempts</span>}
        {m.cache_hits !== null && <span>{m.cache_hits} cache hits</span>}
      </>}
      {row.flags.length > 0 && <span className="dl-cost-flags">{row.flags.map(label).join(' · ')}</span>}
    </div>
    <EvidenceLine evidence={row.evidence} />
  </div>
}

function ProviderGroup({ title, rows }: { title: string; rows: ProviderCostRow[] }) {
  return <section className="dl-cost-group"><h4>{title}</h4><div className="dl-cost-list">{rows.map(row => <ProviderRow key={row.provider} row={row} />)}</div></section>
}

function AccountRow({ account }: { account: ProviderAccount }) {
  return <div className="dl-cost-account-row">
    <b>{providerName[account.provider]}</b>
    <span>{account.coverage} coverage · {account.freshness} feed · last success {age(account.last_success_at)}</span>
    {account.provider === 'apify' && <p>Covered run history {usd(account.history_usd)} · exact allocation {usd(account.allocated_exact_usd)} · inferred allocation {usd(account.allocated_inferred_usd)} · unassigned {usd(account.unassigned_usd)}. This is usage, not an invoice.</p>}
    {account.provider === 'harvestapi' && <p>Current booked usage {usd(account.booked_usd)}. Dated supplier receipt {usd(account.supplier_usd)} · source observed {age(account.source_observed_at)} · stale for current charges. These bases are not comparable.</p>}
    {account.provider === 'scrapecreators' && <>
      <p>Supplier history {credits(account.history_credits)} · supplier daily {credits(account.supplier_credits)} · exact allocation {credits(account.allocated_exact_credits)} · unassigned {credits(account.unassigned_credits)}.</p>
      <p>Producer observations {credits(account.producer_observed_credits)} overlap supplier usage. Comparison: {label(account.comparison)}.</p>
      {account.days.filter(d => d.credit_discrepancy !== null || d.request_discrepancy !== null || d.comparison === 'mismatch').map(d =>
        <p key={d.day}>{d.day} UTC · {d.complete_day ? 'complete day' : 'partial day'} · credit discrepancy {d.credit_discrepancy === null ? 'unknown' : `${d.credit_discrepancy > 0 ? '+' : ''}${d.credit_discrepancy}`} · request discrepancy {d.request_discrepancy === null ? 'unknown' : `${d.request_discrepancy > 0 ? '+' : ''}${d.request_discrepancy}`}</p>
      )}
    </>}
    {account.flags.length > 0 && <span className="dl-cost-flags">{account.flags.map(label).join(' · ')}</span>}
  </div>
}

export function ClientCost({ seat }: { seat: Seat }) {
  const [period, setPeriod] = useState<CostPeriod>(7)
  const [all, setAll] = useState(false)
  const [state, setState] = useState<{ feed: ClientProviderCosts | null; period: CostPeriod; loadedAt: number | null; error: string | null; reading: boolean }>({ feed: null, period: 7, loadedAt: null, error: null, reading: true })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    let current: AbortController | null = null
    let sequence = 0
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      current?.abort()
      const controller = new AbortController()
      current = controller
      const mine = ++sequence
      setState(previous => ({ feed: previous.period === period ? previous.feed : null, period, loadedAt: previous.period === period ? previous.loadedAt : null, error: null, reading: true }))
      fetchClientProviderCosts(period, Date.now(), controller.signal).then(feed => {
        if (live && mine === sequence) setState({ feed, period, loadedAt: Date.now(), error: null, reading: false })
      }).catch(error => {
        if (live && mine === sequence && !controller.signal.aborted) setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Cost read failed', reading: false }))
      })
    }
    refresh()
    const interval = window.setInterval(refresh, 60000)
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { live = false; current?.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', visible) }
  }, [period, retry])
  const feed = state.period === period ? state.feed : null
  const summary = feed ? summarizeClientCost(feed) : null
  return <div className="dl-cost">
    <div className="dl-cost-controls" aria-label="Cost view">
      <div className="dl-cost-pick"><button type="button" aria-pressed={!all} onClick={() => setAll(false)}>{SEAT_NAME[seat]}</button><button type="button" aria-pressed={all} onClick={() => setAll(true)}>All clients</button></div>
      <div className="dl-cost-pick"><button type="button" aria-pressed={period === 7} onClick={() => setPeriod(7)}>7 days</button><button type="button" aria-pressed={period === 30} onClick={() => setPeriod(30)}>30 days</button></div>
      <button type="button" className="dl-cost-refresh" onClick={() => setRetry(v => v + 1)}>Retry</button>
    </div>
    <p className="dl-cost-note">{period} UTC calendar days including today · {feed ? `${feed.window.start}–${feed.window.end}` : 'reading window'}. Provider measures use different bases and are not an invoice total.</p>
    <p className="dl-cost-warning" role="note">Producer observations overlap account usage; do not add them to supplier credits. Unknown means no usable observation.</p>
    {state.error && <p className="dl-cost-error" role="alert">Cost read failed: {state.error}. {feed ? 'Last good read remains visible.' : 'No validated feed is available.'}</p>}
    {!summary ? <p className="dl-cost-empty" role="status">{state.reading ? 'Reading provider costs…' : 'Provider costs unavailable.'}</p> : <>
      <div className={`dl-cost-groups${all ? ' dl-cost-all' : ''}`}>{(all ? SEATS : [seat]).map(s => <ProviderGroup key={s} title={SEAT_NAME[s]} rows={summary.bySeat[s]} />)}</div>
      <ProviderGroup title="Unassigned / shared" rows={summary.shared} />
      <section className="dl-cost-group"><h4>Account reconciliation</h4><div className="dl-cost-accounts">{summary.accounts.map(account => <AccountRow key={account.provider} account={account} />)}</div></section>
      <section className="dl-cost-group"><h4>Anthropic · token estimate</h4>{(all ? SEATS : [seat]).flatMap(s => summary.legacyBySeat[s].map(r => <p key={`${s}:${r.observed_at}`} className="dl-cost-note">{SEAT_NAME[s]} · {usd(r.usd_estimate)} estimate · {r.coverage} coverage</p>))}{summary.legacyShared.map((r, index) => <p key={index} className="dl-cost-note">Shared · {usd(r.usd_estimate)} estimate · {r.coverage} coverage</p>)}</section>
      <p className="dl-cost-note">ScrapeCreators replacement value uses ${summary.creditValueRate.usd_per_credit.toFixed(5)} per credit as of {summary.creditValueRate.as_of}; it is a dated forecast, not cash paid.</p>
      <p className="dl-cost-read">Read {state.loadedAt ? relAge(new Date(state.loadedAt).toISOString()) : 'unknown'} · client_provider_costs v{feed?.schema_version}{state.reading ? ' · refreshing' : ''}</p>
    </>}
    <a className="dl-cost-link" href={dHash('settings', 'money')}>Open Money for the deeper ledger →</a>
  </div>
}
