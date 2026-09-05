/* ==========================================================================
   src/wb/money/index.tsx — S11 Money, on the design system.

   MONEY — goal-run money-truth-2026-09-01, rebuilt for the revamp.

   A whole-canvas reading surface (Job = 'money'; not a list job — nothing here
   hands a row to a peer). Its whole reason to exist is that every number on it
   is walked back to where it came from. That rule is enforced STRUCTURALLY, not
   by convention, and this rebuild keeps the structure byte for byte:

     · `<Cell>` is the ONLY component allowed to print a number.
     · `<DataCell>` is the only thing allowed to call `<Cell>`; it decides
       `<Cell>` vs `<NoSource/>` from whether a source row exists at all.
     · Every section builds its numbers by handing `DataCell` a source row.
     · No code path on this page interpolates a raw number into JSX.

   The raw `source_kind` strings (`vs_lane_day_v`, `engine_counter_day_v`,
   `client_api_usage_token_priced`) are rendered VERBATIM on every cell. That is
   the surface's designed feature, not a leak, and the ledger says so: it is the
   one place in the app where an internal name on screen is the point.

   WHAT THE REVAMP CHANGES. The seven sections are `Group`s and the tables are
   the design system's `Table`, so the numerals are tabular and the provenance
   line sits under the figure it belongs to instead of beside it. And the phone
   gets a real form: W1 measured this screen at 390 and found a seven-column
   table dragging the whole page sideways. Under 900px every table becomes a
   STACK — one block per record, the row's own name as its heading, one labelled
   line per column — so the page never scrolls sideways and no column is cut off
   the edge where nobody finds it.
   ========================================================================== */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  MONEY_TRUTH_RUN, NO_PRESETTLE_TEXT, NO_SOURCE_TEXT, RUNWAY_REFUSAL, STRIPE_UNVERIFIED_BANNER,
  TOKEN_PRICED_LABEL, UNATTRIBUTED_LANE, UNVERIFIED_SUFFIX,
  aggregateByDay, aggregateByWeek, billingDay, clientLabel, computeRunway, dayRangeLabel,
  fetchActorDay, fetchCashConfig, fetchEngineCounterDay, fetchLaneDay,
  fetchMonthChargesAndInvoices, fetchMrrRows, fetchOpenMoneyDecisions,
  fetchRenewalRiskRows, fetchStripeKeyExists, fmtShareOfTotal, fmtUsd, fmtUsdPerUnit, isStale, isTokenPriced,
  laneTotals, laneTotalsGrandTotal, lastNDays, mrrByClient, noteReason, provenanceText, riskNoteKind,
  riskNoteText, taskTitle, topActors, type ActorDayRow, type ClientMrrRow,
  type EngineCounterDayRow, type LaneDayRow, type LaneTotal, type MoneyLedgerRow,
  type MoneyTaskRow, type PeriodAgg,
} from '../../lib/money'
import { PullIndicator } from '../chrome/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { relAge } from '../../exp/v2c/Surface'
import { Banner, Button, Chip, EmptyState, Table, type TableColumn } from '../../ds'
import { Body, Group, Head, Rows, Row, Screen, Sep } from '../kit'
import './money.css'

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
    <span className="a-money-cell" data-unv={!verified ? '' : undefined} data-stale={stale ? '' : undefined}>
      <span className="a-money-cv a-mono">{value}</span>
      <span className="a-money-cp a-mono">
        {provenance}
        {!verified && <span className="a-money-unv"> · {UNVERIFIED_SUFFIX}</span>}
      </span>
    </span>
  )
}

// The literal text for a query that returned no row — never a blank, a dash,
// or a synthesised 0.
function NoSource() {
  return <span className="a-money-nosource a-mono">{NO_SOURCE_TEXT}</span>
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

// ---- The table, and its phone form -----------------------------------------

/**
 * One ledger table, drawn twice and shown once.
 *
 * Above 900px it is the design system's `Table`: a hairline grid, tabular
 * numerals, a sticky header. At or below 900px the same columns become a stack
 * of records — the first column is the record's name, every other column is a
 * labelled line under it. Nothing is dropped and nothing is cut off; the row
 * simply becomes taller instead of wider. The two are mutually exclusive in
 * CSS, so a screen reader meets exactly one of them.
 */
function Ledger<R>({ label, columns, rows, rowKey, empty }: {
  label: string
  columns: Array<TableColumn<R>>
  rows: R[]
  rowKey: (r: R, i: number) => string
  empty?: ReactNode
}) {
  return (
    <>
      <div className="a-money-wide">
        <Table
          label={label}
          columns={columns}
          rows={rows}
          rowKey={r => rowKey(r, rows.indexOf(r))}
          empty={empty}
        />
      </div>
      <div className="a-money-narrow">
        {rows.length === 0 && empty
          ? empty
          : (
            <Rows>
              {rows.map((r, i) => (
                <Row key={rowKey(r, i)} titleWrap title={columns[0].cell(r)}>
                  <span className="a-money-stack">
                    {columns.slice(1).map(c => (
                      <span className="a-money-pair" key={c.id}>
                        <span className="a-money-pk a-eyebrow">{c.header}</span>
                        <span className="a-money-pv">{c.cell(r)}</span>
                      </span>
                    ))}
                  </span>
                </Row>
              ))}
            </Rows>
          )}
      </div>
    </>
  )
}

/** The eyebrow every section carries: its number, then what it is. */
function sectionLabel(n: string, title: string): ReactNode {
  return <>{n} <Sep />{title}</>
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
  const cols: Array<TableColumn<ClientMrrRow | null>> = [
    { id: 'client', header: 'Client', cell: c => (c ? clientLabel(c.clientId) : <NoSource />) },
    {
      id: 'mrr',
      header: 'MRR',
      numeric: true,
      cell: c => {
        if (!c) return <NoSource />
        if (c.amountRow) {
          return <DataCell value={fmtUsd(c.amountRow.amount_usd)} source={c.amountRow} now={now} verified={c.amountRow.verified} />
        }
        return (
          <>
            <NoSource />
            <span className="a-money-note a-meta">reason: {noteReason(c.latestRow.note ?? '')}</span>
          </>
        )
      },
    },
    {
      id: 'next',
      header: 'Next charge',
      numeric: true,
      cell: c => {
        if (!c) return <NoSource />
        const billRow = c.amountRow ?? c.latestRow
        const day = billingDay(billRow)
        if (!day) return <span className="a-money-note a-meta">no billing day on file</span>
        return <DataCell value={nextChargeIso(day, now)} source={billRow} now={now} verified={billRow.verified} />
      },
    },
  ]
  return (
    <Group label={sectionLabel('1', 'MRR and next charges')}>
      <Ledger
        label="MRR and next charges"
        columns={cols}
        rows={display}
        rowKey={(c, i) => c?.clientId ?? `row-${i}`}
      />
    </Group>
  )
}

// ---- Section 2: renewal and churn risk -------------------------------------

function RiskSection({ rows, now, loadedAt }: { rows: MoneyLedgerRow[]; now: number; loadedAt: string | null }) {
  return (
    <Group label={sectionLabel('2', 'Renewal and churn risk')} tail={rows.length > 0 ? `${rows.length}` : undefined}>
      {rows.length === 0
        ? (
          <EmptyState
            icon="money"
            title="No renewal or risk notes on file."
            sub={<span className="a-mono">Checked {relAge(loadedAt)}</span>}
          />
        )
        : (
          <Rows>
            {rows.map(r => {
              const kind = riskNoteKind(r.note ?? '')
              return (
                <Row
                  key={r.id}
                  lead={<Chip tone={kind === 'renewal' ? 'quiet' : 'attention'}>{kind === 'renewal' ? 'Renewal' : 'Risk'}</Chip>}
                  title={clientLabel(r.client_id)}
                >
                  <span className="a-body-t">{riskNoteText(r.note ?? '')}</span>
                  {/* prose is a claim too: a verified=false row wears the same suffix a numeric cell does */}
                  <span className="a-money-cp a-mono">
                    {provenanceText(r, now)}
                    {!r.verified && <span className="a-money-unv"> · {UNVERIFIED_SUFFIX}</span>}
                  </span>
                </Row>
              )
            })}
          </Rows>
        )}
    </Group>
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
    <Group label={sectionLabel('3', 'Runway')} pad>
      {!stripeKeyExists && (
        <Banner tone="attention" icon="alert">{STRIPE_UNVERIFIED_BANNER}</Banner>
      )}
      <div className="a-money-runway">
        {runway.ok
          ? (
            <DataCell
              value={fmtUsd(runway.value)}
              source={{ source_kind: 'computed', source_ref: 'cash_on_hand_usd + cash_as_of_date + 30d vendor spend + verified mrr', observed_at: cash.observedAt }}
              now={now}
            />
          )
          : <span className="a-money-refusal a-mono">{RUNWAY_REFUSAL}</span>}
      </div>
    </Group>
  )
}

// ---- Section 4: vendor spend by actor, per day / per week -----------------

function PeriodTable({ title, rows, now }: { title: string; rows: PeriodAgg[]; now: number }) {
  const display: (PeriodAgg | null)[] = rows.length ? rows : [null]
  const src = (p: PeriodAgg | null): Source | null =>
    p ? { source_kind: 'vs_lane_day_v', source_ref: p.period, observed_at: p.observedAt } : null
  const riseSrc = (p: PeriodAgg | null): Source | null =>
    p ? { source_kind: 'vs_lane_day_v', source_ref: `${p.period} lane=risedtc`, observed_at: p.riseObservedAt } : null
  const engineSrc = (p: PeriodAgg | null): Source | null =>
    p ? { source_kind: 'engine_counter_day_v', source_ref: `${p.period} rise engines`, observed_at: p.riseClaimedObservedAt } : null

  const cols: Array<TableColumn<PeriodAgg | null>> = [
    { id: 'period', header: 'Period', cell: p => (p ? <span className="a-mono">{p.period}</span> : <NoSource />) },
    { id: 'runs', header: 'Runs', numeric: true, cell: p => <DataCell value={p ? String(p.runs) : null} source={src(p)} now={now} /> },
    { id: 'settled', header: 'Settled $', numeric: true, cell: p => <DataCell value={p && p.settledUsd !== null ? fmtUsd(p.settledUsd) : null} source={src(p)} now={now} /> },
    {
      id: 'presettle',
      header: 'Presettle $',
      numeric: true,
      cell: p => {
        if (!p) return <NoSource />
        if (p.presettleUsd === null) return <span className="a-money-nosource a-mono">{NO_PRESETTLE_TEXT}</span>
        return <DataCell value={fmtUsd(p.presettleUsd)} source={src(p)} now={now} />
      },
    },
    { id: 'billed', header: 'Rise billed $', numeric: true, cell: p => <DataCell value={p && p.riseBilledUsd !== null ? fmtUsdPerUnit(p.riseBilledUsd) : null} source={riseSrc(p)} now={now} /> },
    { id: 'claimed', header: 'Rise engines claimed $', numeric: true, cell: p => <DataCell value={p ? fmtUsdPerUnit(p.riseClaimedUsd) : null} source={engineSrc(p)} now={now} /> },
    { id: 'delta', header: 'Rise delta', numeric: true, cell: p => <DataCell value={p ? p.riseDeltaRatio : null} source={engineSrc(p)} now={now} /> },
  ]
  return (
    <div className="a-money-block">
      <div className="a-eyebrow a-money-tlabel">{title}</div>
      <Ledger label={title} columns={cols} rows={display} rowKey={(p, i) => p?.period ?? `row-${i}`} />
    </div>
  )
}

function ActorTable({ rows, now }: { rows: ActorDayRow[]; now: number }) {
  const agg = topActors(rows, 12)
  const display: (ReturnType<typeof topActors>[number] | null)[] = agg.length ? agg : [null]
  const src = (a: (typeof display)[number]): Source | null =>
    a ? { source_kind: 'vs_actor_day_v', source_ref: a.actor, observed_at: a.observedAt } : null
  const title = `By actor, ${dayRangeLabel(7, now)} (top 12)`
  const cols: Array<TableColumn<(typeof display)[number]>> = [
    {
      id: 'actor',
      header: 'Actor',
      cell: a => {
        if (!a) return <NoSource />
        return (
          <>
            <span className="a-mono">{a.actor}</span>
            {isTokenPriced(a.vendor) && <span className="a-money-note a-meta">{TOKEN_PRICED_LABEL}</span>}
          </>
        )
      },
    },
    { id: 'runs', header: 'Runs', numeric: true, cell: a => <DataCell value={a ? String(a.runs) : null} source={src(a)} now={now} /> },
    { id: 'usd', header: '$', numeric: true, cell: a => <DataCell value={a && a.usd !== null ? fmtUsd(a.usd) : null} source={src(a)} now={now} /> },
    { id: 'per', header: '$ per run', numeric: true, cell: a => <DataCell value={a && a.usdPerRun !== null ? fmtUsdPerUnit(a.usdPerRun) : null} source={src(a)} now={now} /> },
  ]
  return (
    <div className="a-money-block">
      <div className="a-eyebrow a-money-tlabel">{title}</div>
      <Ledger label={title} columns={cols} rows={display} rowKey={(a, i) => a?.actor ?? `row-${i}`} />
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
    <Group label={sectionLabel('4', 'Vendor spend by actor')} pad>
      <PeriodTable title={`Per day, ${dayRangeLabel(7, now)}`} rows={byDay} now={now} />
      <PeriodTable title="Last 4 ISO weeks" rows={byWeek} now={now} />
      <div className="a-money-note a-meta">
        Ratio covers the Rise lane only: its engines are the ones that self-report a cost. Ivan's 09:00 lane and Arch report nothing, so no ratio exists for them.
        Claims are bucketed on the engine's log time (run end), bills on run start; a run crossing midnight lands a day apart.
      </div>
      <ActorTable rows={lastNDays(actorDay, 7, now)} now={now} />
    </Group>
  )
}

// ---- Section 5: cost-to-serve by client, Ivan's lane separate -------------

type CostRow = { key: string; group: string | null; total: LaneTotal | null; withShare: boolean }

function CostToServeSection({ laneDay, now }: { laneDay: LaneDayRow[]; now: number }) {
  const totals = laneTotals(laneDay)
  const ivan = totals.filter(t => t.lane === 'ivan')
  const clients = totals.filter(t => t.lane !== 'ivan' && t.lane !== UNATTRIBUTED_LANE)
  const unattributed = totals.filter(t => t.lane === UNATTRIBUTED_LANE)
  const grand = laneTotalsGrandTotal(totals)
  const grandSrc: Source = {
    source_kind: 'vs_lane_day_v', source_ref: 'sum of every lane incl. unattributed',
    observed_at: totals.reduce<string | null>((m, t) => (t.apifyObservedAt && (!m || t.apifyObservedAt > m) ? t.apifyObservedAt : m), null),
  }

  // The grouped body the old table drew with colSpan rows. A group heading is a
  // row whose only cell is its name, so the phone stack keeps the same reading
  // order the table has.
  const body: CostRow[] = []
  const push = (name: string, list: LaneTotal[], key: string, withShare = false) => {
    body.push({ key: `h-${key}`, group: name, total: null, withShare: false })
    if (list.length) list.forEach(t => body.push({ key: `${key}-${t.lane}`, group: null, total: t, withShare }))
    else body.push({ key: `${key}-empty`, group: null, total: null, withShare })
  }
  push('Ivan (own lane)', ivan, 'ivan')
  push('Client lanes', clients, 'clients')
  push('Unattributed (not a client)', unattributed, 'unattributed', true)
  body.push({ key: 'h-total', group: 'Total (lanes and unattributed)', total: null, withShare: false })

  const apifySrc = (t: LaneTotal): Source => ({ source_kind: 'vs_lane_day_v', source_ref: `${t.lane} vendor=apify`, observed_at: t.apifyObservedAt })
  const anthSrc = (t: LaneTotal): Source => ({ source_kind: 'vs_lane_day_v', source_ref: `${t.lane} vendor=anthropic_api (client_api_usage, token-priced)`, observed_at: t.anthropicObservedAt })

  const cols: Array<TableColumn<CostRow>> = [
    {
      id: 'lane',
      header: 'Lane',
      cell: r => {
        if (r.group) return <span className="a-money-grp a-eyebrow">{r.group}</span>
        if (!r.total) return <NoSource />
        return laneDisplay(r.total.lane)
      },
    },
    {
      id: 'apify',
      header: 'Apify (settled)',
      numeric: true,
      cell: r => (r.group ? null : <DataCell value={r.total && r.total.apifyUsd !== null ? fmtUsd(r.total.apifyUsd) : null} source={r.total ? apifySrc(r.total) : null} now={now} />),
    },
    {
      id: 'runs',
      header: 'Apify runs',
      numeric: true,
      cell: r => (r.group ? null : <DataCell value={r.total ? String(r.total.apifyRuns) : null} source={r.total ? apifySrc(r.total) : null} now={now} />),
    },
    {
      id: 'anth',
      header: `Anthropic API (${TOKEN_PRICED_LABEL})`,
      numeric: true,
      cell: r => (r.group ? null : <DataCell value={r.total && r.total.anthropicUsd !== null ? fmtUsd(r.total.anthropicUsd) : null} source={r.total && r.total.anthropicUsd !== null ? anthSrc(r.total) : null} now={now} />),
    },
    {
      id: 'share',
      header: 'Share of Apify total',
      numeric: true,
      cell: r => (r.group || !r.total || !r.withShare ? null : <DataCell value={fmtShareOfTotal(r.total.apifyUsd, grand.apifyUsd)} source={grandSrc} now={now} />),
    },
  ]

  const title = `Cost to serve by client, ${dayRangeLabel(30, now)}`
  return (
    <Group label={sectionLabel('5', title)}>
      <Ledger label={title} columns={cols} rows={body} rowKey={r => r.key} />
      <div className="a-money-totalrow">
        <span className="a-eyebrow">Total</span>
        <span className="a-money-totals">
          <DataCell value={grand.apifyUsd === null ? null : fmtUsd(grand.apifyUsd)} source={grandSrc} now={now} />
          <DataCell value={String(grand.apifyRuns)} source={grandSrc} now={now} />
          <DataCell value={grand.anthropicUsd === null ? null : fmtUsd(grand.anthropicUsd)} source={grand.anthropicUsd === null ? null : grandSrc} now={now} />
        </span>
      </div>
    </Group>
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
  const display: (MoneyLedgerRow | null)[] = monthRows.length ? monthRows : [null]

  const recCols: Array<TableColumn<MoneyLedgerRow | null>> = [
    { id: 'client', header: 'Client', cell: r => (r ? clientLabel(r.client_id) : <NoSource />) },
    { id: 'kind', header: 'Kind', cell: r => (r ? r.kind : <NoSource />) },
    {
      id: 'amount',
      header: 'Amount',
      numeric: true,
      cell: r => <DataCell value={r && r.amount_usd !== null ? fmtUsd(r.amount_usd) : null} source={r} now={now} verified={r ? r.verified : true} />,
    },
    { id: 'date', header: 'Date', numeric: true, cell: r => (r ? <span className="a-mono">{r.occurred_on}</span> : <NoSource />) },
  ]

  type Exp = { row: MoneyLedgerRow; day: number } | null
  const expDisplay: Exp[] = expected.length ? expected : [null]
  const expCols: Array<TableColumn<Exp>> = [
    { id: 'client', header: 'Client', cell: e => (e ? clientLabel(e.row.client_id) : <NoSource />) },
    { id: 'day', header: 'Billing day', numeric: true, cell: e => <DataCell value={e ? String(e.day) : null} source={e ? e.row : null} now={now} verified={e ? e.row.verified : true} /> },
    { id: 'charge', header: 'Expected charge', numeric: true, cell: e => <DataCell value={e ? nextChargeIso(e.day, now) : null} source={e ? e.row : null} now={now} verified={e ? e.row.verified : true} /> },
  ]

  return (
    <Group label={sectionLabel('6', 'Invoice and receipt checklist (this month)')} pad>
      <div className="a-money-block">
        <div className="a-eyebrow a-money-tlabel">Recorded this month</div>
        <Ledger label="Recorded this month" columns={recCols} rows={display} rowKey={(r, i) => r?.id ?? `row-${i}`} />
      </div>
      <div className="a-money-block">
        <div className="a-eyebrow a-money-tlabel">Expected, from MRR billing day</div>
        <Ledger label="Expected, from MRR billing day" columns={expCols} rows={expDisplay} rowKey={(e, i) => e?.row.id ?? `row-${i}`} />
      </div>
    </Group>
  )
}

// ---- Section 7: open money decisions (read-only) ---------------------------

function DecisionsSection({ tasks }: { tasks: MoneyTaskRow[] }) {
  return (
    <Group
      label={sectionLabel('7', 'Open money decisions')}
      tail={tasks.length > 0 ? `${tasks.length}` : undefined}
      foot={tasks.length > 0 ? <span className="a-meta">Ticking stays on the Ops job.</span> : undefined}
    >
      {tasks.length === 0
        ? <EmptyState icon="money" title="No open money decisions in this run." sub={MONEY_TRUTH_RUN} />
        : (
          <Rows>
            {tasks.map(t => (
              <Row
                key={t.id}
                titleWrap
                title={taskTitle(t.body)}
                tail={<span className="a-mono a-dim">{t.context?.due_at ? `due ${t.context.due_at}` : 'no due date'}</span>}
              >
                {/* a task title can carry a dollar figure; it is a source row too, so it wears the same tag */}
                <span className="a-money-cp a-mono">
                  ops_drafts · {t.id.slice(0, 8)} · observed {t.created_at ? relAge(t.created_at) : 'never'}
                </span>
              </Row>
            ))}
          </Rows>
        )}
    </Group>
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
  // apify settled only; an unsettled row (NULL) is skipped, never counted as 0 spend and never as a floor
  const vendorSpend30dUsd = laneDay30.reduce((s, r) => s + (r.vendor === 'apify' && r.usd_settled !== null ? r.usd_settled : 0), 0)
  // Runway only ever sums an amount row that both EXISTS and is verified — a
  // client whose only mrr rows are note-only (no amountRow) contributes 0,
  // same as an unverified amount row.
  const verifiedMrrSumUsd = mrrByClient(m.mrrRows)
    .filter(c => c.amountRow?.verified)
    .reduce((s, c) => s + (c.amountRow?.amount_usd ?? 0), 0)

  const head = (
    <Head
      title="Money"
      sub={m.loadedAt ? `checked ${relAge(m.loadedAt)}` : 'loading'}
    />
  )

  if (m.error) {
    return (
      <Screen className="a-money">
        {head}
        <Body>
          <Banner
            tone="urgent"
            icon="error"
            title="Money didn’t load"
            action={<Button variant="quiet" onClick={m.refresh}>Try again</Button>}
          >
            {m.error}
          </Banner>
        </Body>
      </Screen>
    )
  }

  return (
    <Screen className="a-money">
      {head}
      <Body innerRef={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {m.loading
          ? <div className="a-meta a-money-load">Loading…</div>
          : (
            <>
              <MrrSection rows={m.mrrRows} now={now} />
              <RiskSection rows={m.riskRows} now={now} loadedAt={m.loadedAt} />
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
      </Body>
    </Screen>
  )
}
