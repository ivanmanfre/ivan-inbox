import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MONEY_TRUTH_RUN, NO_SOURCE_TEXT, RUNWAY_REFUSAL, STRIPE_UNVERIFIED_BANNER,
  TOKEN_PRICED_LABEL, UNVERIFIED_SUFFIX,
  aggregateByDay, aggregateByWeek, billingDay, clientLabel, computeRunway,
  fetchActorDay, fetchCashConfig, fetchEngineCounterDay, fetchLaneDay,
  fetchMonthChargesAndInvoices, fetchMrrRows, fetchOpenMoneyDecisions,
  fetchRenewalRiskRows, fetchStripeKeyExists, fmtUsd, fmtUsdPerUnit, isStale, isTokenPriced,
  laneTotals, lastNDays, mrrByClient, noteReason, provenanceText, riskNoteKind,
  riskNoteText, taskTitle, topActors, type ActorDayRow, type ClientMrrRow,
  type EngineCounterDayRow, type LaneDayRow, type MoneyLedgerRow,
  type MoneyTaskRow, type PeriodAgg,
} from '../../lib/money'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { CalmEmpty, Failed, SectionHead, relAge } from './Surface'

// MONEY — goal-run money-truth-2026-09-01.
//
// A whole-canvas reading surface (Job = 'money'; not a list job — nothing here
// hands a row to a peer). Its whole reason to exist is that every number on it
// is walked back to where it came from. That rule is enforced structurally, not
// by convention: <Cell> is the ONLY thing on this page allowed to print a
// number, <DataCell> is the only thing allowed to call <Cell> (it decides
// <Cell> vs <NoSource/> from whether a source row exists at all), and every
// section below builds its numbers by handing DataCell a source row. There is
// no code path on this page that interpolates a raw number into JSX.

// ---- Provenance primitives --------------------------------------------------

type Source = { source_kind: string; source_ref: string | null; observed_at: string | null }

// The one component licensed to render a number. `provenance` and `stale` are
// passed in pre-computed (by DataCell, below) rather than derived here, so
// there is exactly one place — provenanceText/isStale in lib/money — that
// decides what a provenance line says and when a cell counts as stale.
function Cell({ value, provenance, verified, stale }: {
  value: string
  provenance: string
  verified: boolean
  stale: boolean
}) {
  return (
    <div className={`wb-money-cell${!verified ? ' unv' : ''}${stale ? ' stale' : ''}`}>
      <div className="wb-money-cv">{value}</div>
      <div className="wb-money-cp">
        {provenance}
        {!verified && <span className="wb-money-unvtag"> · {UNVERIFIED_SUFFIX}</span>}
      </div>
    </div>
  )
}

// The literal text for a query that returned no row — never a blank, a dash,
// or a synthesised 0.
function NoSource() {
  return <span className="wb-money-nosource">{NO_SOURCE_TEXT}</span>
}

// The gate every numeric cell on this page passes through: no source row, no
// Cell — NoSource instead, by construction rather than by a caller remembering
// to check.
function DataCell({ value, source, now, verified = true }: {
  value: string | null
  source: Source | null
  now: number
  verified?: boolean
}) {
  if (value === null || source === null) return <NoSource />
  return (
    <Cell
      value={value}
      provenance={provenanceText(source, now)}
      verified={verified}
      stale={isStale(source.observed_at, now)}
    />
  )
}

function laneDisplay(lane: string): string {
  if (lane === 'unattributed') return 'Unattributed'
  return clientLabel(lane)
}

// ---- Section 1: MRR and next charges ---------------------------------------

function nextChargeIso(day: number, now: number): string {
  const d = new Date(now)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const daysInThisMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const daysInNextMonth = new Date(Date.UTC(y, m + 2, 0)).getUTCDate()
  const thisMonth = Date.UTC(y, m, Math.min(day, daysInThisMonth))
  if (thisMonth >= new Date(Date.UTC(y, m, d.getUTCDate())).getTime()) {
    return new Date(thisMonth).toISOString().slice(0, 10)
  }
  return new Date(Date.UTC(y, m + 1, Math.min(day, daysInNextMonth))).toISOString().slice(0, 10)
}

// A client can carry an amount row AND separate note-only rows (a
// `resolve live:` placeholder, a bare renewal/risk note) — mrrByClient keeps
// them apart, so a client with no amount row on file renders NoSource for the
// number plus the reason text, rather than reading a stranger row as if it
// were nothing at all.
function MrrSection({ rows, now }: { rows: MoneyLedgerRow[]; now: number }) {
  const clients = mrrByClient(rows)
  const display: (ClientMrrRow | null)[] = clients.length ? clients : [null]
  return (
    <>
      <SectionHead n="1" title="MRR and next charges" />
      <div className="wb-money-twrap">
        <table className="wb-money-table">
          <thead>
            <tr><th>Client</th><th>MRR</th><th>Next charge</th></tr>
          </thead>
          <tbody>
            {display.map(c => {
              if (!c) {
                return (
                  <tr key="empty">
                    <td><NoSource /></td>
                    <td><NoSource /></td>
                    <td><NoSource /></td>
                  </tr>
                )
              }
              const billRow = c.amountRow ?? c.latestRow
              const day = billingDay(billRow)
              return (
                <tr key={c.clientId ?? '__ivan__'}>
                  <td>{clientLabel(c.clientId)}</td>
                  <td>
                    {c.amountRow
                      ? <DataCell value={fmtUsd(c.amountRow.amount_usd)} source={c.amountRow} now={now} verified={c.amountRow.verified} />
                      : (
                        <>
                          <NoSource />
                          <div className="wb-money-note">reason: {noteReason(c.latestRow.note ?? '')}</div>
                        </>
                      )}
                  </td>
                  <td>
                    {day
                      ? <DataCell value={nextChargeIso(day, now)} source={billRow} now={now} verified={billRow.verified} />
                      : <span className="wb-money-note">no billing day on file</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---- Section 2: renewal and churn risk -------------------------------------

function RiskSection({ rows, now }: { rows: MoneyLedgerRow[]; now: number }) {
  return (
    <>
      <SectionHead n="2" title="Renewal and churn risk" />
      {rows.length === 0
        ? <CalmEmpty line="No renewal or risk notes on file." loadedAt={now ? new Date(now).toISOString() : null} />
        : (
          <div className="wb-money-risklist">
            {rows.map(r => (
              <div className={`wb-money-riskrow ${riskNoteKind(r.note ?? '')}`} key={r.id}>
                <div className="wb-money-riskhead">
                  <span className={`wb-money-riskkind ${riskNoteKind(r.note ?? '')}`}>
                    {riskNoteKind(r.note ?? '') === 'renewal' ? 'Renewal' : 'Risk'}
                  </span>
                  <span className="wb-money-riskclient">{clientLabel(r.client_id)}</span>
                </div>
                <div className="wb-money-risktext">{riskNoteText(r.note ?? '')}</div>
                <div className="wb-money-cp">{provenanceText(r, now)}</div>
              </div>
            ))}
          </div>
        )}
    </>
  )
}

// ---- Section 3: runway -------------------------------------------------

function RunwaySection({
  cash, vendorSpend30dUsd, verifiedMrrSumUsd, stripeKeyExists, now,
}: {
  cash: { cashOnHandUsd: number | null; cashAsOfDate: string | null; observedAt: string | null }
  vendorSpend30dUsd: number
  verifiedMrrSumUsd: number
  stripeKeyExists: boolean
  now: number
}) {
  const runway = computeRunway({
    cashOnHandUsd: cash.cashOnHandUsd,
    cashAsOfDate: cash.cashAsOfDate,
    vendorSpend30dUsd,
    verifiedMrrSumUsd,
    now,
  })
  return (
    <>
      <SectionHead n="3" title="Runway" />
      {!stripeKeyExists && <div className="wb-money-banner">{STRIPE_UNVERIFIED_BANNER}</div>}
      {runway.ok
        ? (
          <DataCell
            value={fmtUsd(runway.value)}
            source={{ source_kind: 'computed', source_ref: 'cash_on_hand_usd + cash_as_of_date + 30d vendor spend + verified mrr', observed_at: cash.observedAt }}
            now={now}
          />
        )
        : <div className="wb-money-refusal">{RUNWAY_REFUSAL}</div>}
    </>
  )
}

// ---- Section 4: vendor spend by actor, per day / per week -----------------

function PeriodTable({ title, rows, now }: { title: string; rows: PeriodAgg[]; now: number }) {
  const display = rows.length ? rows : [null]
  return (
    <div className="wb-money-twrap">
      <div className="wb-money-tlabel">{title}</div>
      <table className="wb-money-table">
        <thead>
          <tr>
            <th>Period</th><th>Runs</th><th>Settled $</th><th>Presettle $</th>
            <th>Engine-counter $</th><th>Delta ratio</th>
          </tr>
        </thead>
        <tbody>
          {display.map((p, i) => {
            if (!p) {
              return (
                <tr key="empty">
                  <td><NoSource /></td><td><NoSource /></td><td><NoSource /></td>
                  <td><NoSource /></td><td><NoSource /></td><td><NoSource /></td>
                </tr>
              )
            }
            const laneSrc: Source = { source_kind: 'vs_lane_day_v', source_ref: p.period, observed_at: p.observedAt }
            const engineSrc: Source = {
              source_kind: 'engine_counter_day_v',
              source_ref: p.period,
              observed_at: p.claimedDay ? `${p.claimedDay}T00:00:00Z` : null,
            }
            return (
              <tr key={p.period ?? i}>
                <td>{p.period}</td>
                <td><DataCell value={String(p.runs)} source={laneSrc} now={now} /></td>
                <td><DataCell value={fmtUsd(p.settledUsd)} source={laneSrc} now={now} /></td>
                <td><DataCell value={fmtUsd(p.presettleUsd)} source={laneSrc} now={now} /></td>
                <td><DataCell value={fmtUsd(p.claimedUsd)} source={engineSrc} now={now} /></td>
                <td><DataCell value={p.deltaRatio} source={engineSrc} now={now} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ActorTable({ rows, now }: { rows: ActorDayRow[]; now: number }) {
  const agg = topActors(rows, 12)
  const display = agg.length ? agg : [null]
  return (
    <div className="wb-money-twrap">
      <div className="wb-money-tlabel">By actor, last 7 days (top 12)</div>
      <table className="wb-money-table">
        <thead><tr><th>Actor</th><th>Runs</th><th>$</th><th>$/run</th></tr></thead>
        <tbody>
          {display.map((a, i) => {
            if (!a) {
              return <tr key="empty"><td><NoSource /></td><td><NoSource /></td><td><NoSource /></td><td><NoSource /></td></tr>
            }
            const src: Source = { source_kind: 'vs_actor_day_v', source_ref: a.actor, observed_at: a.observedAt }
            return (
              <tr key={a.actor ?? i}>
                <td>
                  {a.actor}
                  {isTokenPriced(a.vendor) && <div className="wb-money-note">{TOKEN_PRICED_LABEL}</div>}
                </td>
                <td><DataCell value={String(a.runs)} source={src} now={now} /></td>
                <td><DataCell value={fmtUsd(a.usd)} source={src} now={now} /></td>
                <td><DataCell value={fmtUsdPerUnit(a.usdPerRun)} source={src} now={now} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function VendorSpendSection({
  laneDay, actorDay, engineDay, now,
}: {
  laneDay: LaneDayRow[]
  actorDay: ActorDayRow[]
  engineDay: EngineCounterDayRow[]
  now: number
}) {
  const byDay = aggregateByDay(laneDay, engineDay).slice(0, 7)
  const byWeek = aggregateByWeek(laneDay, engineDay).slice(0, 4)
  return (
    <>
      <SectionHead n="4" title="Vendor spend by actor" />
      <PeriodTable title="Last 7 days" rows={byDay} now={now} />
      <PeriodTable title="Last 4 ISO weeks" rows={byWeek} now={now} />
      <ActorTable rows={lastNDays(actorDay, 7, now)} now={now} />
    </>
  )
}

// ---- Section 5: cost-to-serve by client, Ivan's lane separate -------------

function CostToServeSection({ laneDay, now }: { laneDay: LaneDayRow[]; now: number }) {
  const totals = laneTotals(laneDay)
  const ivan = totals.filter(t => t.lane === 'ivan')
  const clients = totals.filter(t => t.lane !== 'ivan')
  const row = (t: { lane: string; usd: number; runs: number; observedAt: string | null } | null, key: string) => {
    if (!t) {
      return <tr key={key}><td><NoSource /></td><td><NoSource /></td><td><NoSource /></td></tr>
    }
    const src: Source = { source_kind: 'vs_lane_day_v', source_ref: t.lane, observed_at: t.observedAt }
    return (
      <tr key={t.lane}>
        <td>{laneDisplay(t.lane)}</td>
        <td><DataCell value={fmtUsd(t.usd)} source={src} now={now} /></td>
        <td><DataCell value={String(t.runs)} source={src} now={now} /></td>
      </tr>
    )
  }
  return (
    <>
      <SectionHead n="5" title="Cost to serve by client (30 days)" />
      <div className="wb-money-twrap">
        <table className="wb-money-table">
          <thead><tr><th>Lane</th><th>$</th><th>Runs</th></tr></thead>
          <tbody>
            <tr className="wb-money-ivanrow"><td colSpan={3}>Ivan (own lane)</td></tr>
            {ivan.length ? ivan.map(t => row(t, t.lane)) : row(null, 'ivan-empty')}
            <tr className="wb-money-clientrow"><td colSpan={3}>Client lanes</td></tr>
            {clients.length ? clients.map(t => row(t, t.lane)) : row(null, 'clients-empty')}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---- Section 6: invoice and receipt checklist (this month) ----------------

function ChecklistSection({
  monthRows, mrrRows, now,
}: {
  monthRows: MoneyLedgerRow[]
  mrrRows: MoneyLedgerRow[]
  now: number
}) {
  // Billing day can live on either the amount row or a note-only row for the
  // same client — same fallback MrrSection uses.
  const expected = mrrByClient(mrrRows)
    .map(c => ({ row: c.amountRow ?? c.latestRow, day: billingDay(c.amountRow ?? c.latestRow) }))
    .filter((x): x is { row: MoneyLedgerRow; day: number } => x.day !== null)
  const display = monthRows.length ? monthRows : [null]
  return (
    <>
      <SectionHead n="6" title="Invoice and receipt checklist (this month)" />
      <div className="wb-money-tlabel">Recorded this month</div>
      <div className="wb-money-twrap">
        <table className="wb-money-table">
          <thead><tr><th>Client</th><th>Kind</th><th>Amount</th><th>Date</th></tr></thead>
          <tbody>
            {display.map((r, i) => {
              if (!r) {
                return <tr key="empty"><td><NoSource /></td><td><NoSource /></td><td><NoSource /></td><td><NoSource /></td></tr>
              }
              const src: Source = r
              return (
                <tr key={r.id ?? i}>
                  <td>{clientLabel(r.client_id)}</td>
                  <td>{r.kind}</td>
                  <td>
                    <DataCell
                      value={r.amount_usd !== null ? fmtUsd(r.amount_usd) : null}
                      source={src} now={now} verified={r.verified}
                    />
                  </td>
                  <td>{r.occurred_on}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="wb-money-tlabel">Expected, from MRR billing day</div>
      <div className="wb-money-twrap">
        <table className="wb-money-table">
          <thead><tr><th>Client</th><th>Billing day</th><th>Expected charge</th></tr></thead>
          <tbody>
            {expected.length === 0
              ? <tr><td><NoSource /></td><td><NoSource /></td><td><NoSource /></td></tr>
              : expected.map(({ row, day }) => {
                  const src: Source = row
                  return (
                    <tr key={row.id}>
                      <td>{clientLabel(row.client_id)}</td>
                      <td><DataCell value={String(day)} source={src} now={now} verified={row.verified} /></td>
                      <td><DataCell value={nextChargeIso(day, now)} source={src} now={now} verified={row.verified} /></td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---- Section 7: open money decisions (read-only) ---------------------------

function DecisionsSection({ tasks }: { tasks: MoneyTaskRow[] }) {
  return (
    <>
      <SectionHead n="7" title="Open money decisions" />
      {tasks.length === 0
        ? <CalmEmpty line="No open money decisions in this run." sub={MONEY_TRUTH_RUN} />
        : (
          <div className="wb-money-tasks">
            {tasks.map(t => (
              <div className="wb-money-task" key={t.id}>
                <div className="wb-money-tasktitle">{taskTitle(t.body)}</div>
                <div className="wb-money-taskdue">
                  {t.context?.due_at ? `due ${t.context.due_at}` : 'no due date'}
                </div>
              </div>
            ))}
            <div className="wb-money-note">Ticking stays on the Ops job.</div>
          </div>
        )}
    </>
  )
}

// ---- data hook --------------------------------------------------------

type MoneyState = {
  loading: boolean
  error: string | null
  mrrRows: MoneyLedgerRow[]
  riskRows: MoneyLedgerRow[]
  monthRows: MoneyLedgerRow[]
  laneDay: LaneDayRow[]
  actorDay: ActorDayRow[]
  engineDay: EngineCounterDayRow[]
  cash: { cashOnHandUsd: number | null; cashAsOfDate: string | null; observedAt: string | null }
  stripeKeyExists: boolean
  tasks: MoneyTaskRow[]
  loadedAt: string | null
}

const INITIAL: MoneyState = {
  loading: true, error: null, mrrRows: [], riskRows: [], monthRows: [],
  laneDay: [], actorDay: [], engineDay: [],
  cash: { cashOnHandUsd: null, cashAsOfDate: null, observedAt: null },
  stripeKeyExists: false, tasks: [], loadedAt: null,
}

function useMoney() {
  const [state, setState] = useState<MoneyState>(INITIAL)

  const refresh = useCallback(() => {
    setState(s => ({ ...s, loading: true }))
    Promise.all([
      fetchMrrRows(), fetchRenewalRiskRows(), fetchMonthChargesAndInvoices(),
      fetchLaneDay(30), fetchActorDay(30), fetchEngineCounterDay(30),
      fetchCashConfig(), fetchStripeKeyExists(), fetchOpenMoneyDecisions(),
    ]).then(([mrrRows, riskRows, monthRows, laneDay, actorDay, engineDay, cash, stripeKeyExists, tasks]) => {
      setState({
        loading: false, error: null, mrrRows, riskRows, monthRows, laneDay, actorDay, engineDay,
        cash, stripeKeyExists, tasks, loadedAt: new Date().toISOString(),
      })
    }).catch((e: unknown) => {
      setState(s => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'money data unavailable' }))
    })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { ...state, refresh }
}

// ---- top level --------------------------------------------------------

export function MoneyView() {
  const m = useMoney()
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => m.refresh())
  const now = Date.now()

  const laneDay30 = m.laneDay
  const vendorSpend30dUsd = laneDay30.reduce((s, r) => s + r.usd_settled, 0)
  // Runway only ever sums an amount row that both EXISTS and is verified — a
  // client whose only mrr rows are note-only (no amountRow) contributes 0,
  // same as an unverified amount row.
  const verifiedMrrSumUsd = mrrByClient(m.mrrRows)
    .filter(c => c.amountRow?.verified)
    .reduce((s, c) => s + (c.amountRow?.amount_usd ?? 0), 0)

  const head = (
    <div className="nav wb-head">
      <div className="row-top">
        <h2>Money</h2>
        <span className="wb-strat-age">
          {m.loadedAt ? `checked ${relAge(m.loadedAt)}` : 'loading'}
        </span>
      </div>
    </div>
  )

  if (m.error) {
    return (
      <>
        {head}
        <Failed what="Money" message={m.error} onRetry={m.refresh} loadedAt={null} />
      </>
    )
  }

  return (
    <>
      {head}
      <div className="rows ct-rows wb-money" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {m.loading
          ? <div className="wb-strat-note">Loading…</div>
          : (
            <>
              <MrrSection rows={m.mrrRows} now={now} />
              <RiskSection rows={m.riskRows} now={now} />
              <RunwaySection
                cash={m.cash}
                vendorSpend30dUsd={vendorSpend30dUsd}
                verifiedMrrSumUsd={verifiedMrrSumUsd}
                stripeKeyExists={m.stripeKeyExists}
                now={now}
              />
              <VendorSpendSection laneDay={m.laneDay} actorDay={m.actorDay} engineDay={m.engineDay} now={now} />
              <CostToServeSection laneDay={m.laneDay} now={now} />
              <ChecklistSection monthRows={m.monthRows} mrrRows={m.mrrRows} now={now} />
              <DecisionsSection tasks={m.tasks} />
            </>
          )}
        <div style={{ height: 96 }} />
      </div>
    </>
  )
}
