/* ==========================================================================
   src/wb/dir-a/sends/Overview.tsx — S09, the Sends overview, as an instrument.

   Rebuilt from `src/screens/kpi/OverviewView.tsx`. Every fetch, every derived
   number, every threshold and every string is the one that file already had;
   what changed is the view. The four decision tiles are one LEDGER of cells
   sharing a baseline and a right edge instead of a deck of four boxes; the
   funnel draws each step as a lime segment with its count inside it; the day
   ledger and the campaigns list are the design system's Table with mono,
   right-aligned numerals; per-lane volume is a run of measured bars.

   The colour maps the old file carried inline (nine hexes for four lanes, four
   severities and three modes) are gone: a lane is a category and a category is
   never colour, while a governor at its cap, a mode that is holding cold sends
   and a lane under two days of runway are live signals and keep the severity
   tones. Nothing here invents a number, and nothing that read "No data" now
   reads zero.
   ========================================================================== */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  buildLanes, fetchSends, fetchSendsDaily, fetchCampaignSends,
  type Lane, type DailyRow, type CampaignSend,
} from '../../../lib/sends'
import { getExpVariant } from '../../../exp'
import {
  fetchAccept, fetchReply, fetchPipeline, fetchGovernor, fetchScanOpens, fetchOutcomes, fetchRangeKpis,
  fetchReplacement, replacementRate, daysToEmpty, fetchDayLedger, buildLedger,
  acceptRate, runwayDays, laneLabel, governorEnforcementGap,
  type AcceptRow, type ReplyRow, type PipelineRow, type GovernorRow, type ScanOpenRow, type OutcomeRow, type RangeKpiRow,
  type ReplacementRow, type LedgerRow,
} from '../../../lib/kpis'
import { Badge, Icon, Table, type TableColumn } from '../../../ds'
import { BarLine, Body, Cell, Dot, Group, KV, Ledger, Row, Rows, Sep, Spark, type Tone } from '../kit'
import './sends.css'

type Client = 'all' | 'ivan' | 'risedtc' | 'arch'
type Timeframe = '7d' | '30d' | 'custom'
type DateRange = { from: string; to: string }

// The four-step severity vocabulary of the old file, expressed in the system's
// tones. `neutral` is not a colour any more: it is the absence of one.
type Sev = 'green' | 'amber' | 'red' | 'neutral'
const SEV_TONE: Record<Sev, Tone | undefined> = {
  green: 'clear', amber: 'attention', red: 'urgent', neutral: undefined,
}
const MODE: Record<GovernorRow['mode'], { label: string; tone: Tone }> = {
  normal: { label: 'NORMAL', tone: 'clear' },
  warm_only: { label: 'WARM-ONLY', tone: 'attention' },
  cold_paused: { label: 'COLD-PAUSED', tone: 'urgent' },
}
const MODE_RANK: Record<GovernorRow['mode'], number> = { normal: 0, warm_only: 1, cold_paused: 2 }

// A seat sitting AT its cap is not "NORMAL", whatever its adaptive mode says: the
// sender is refusing every pick until the window rolls. Badge says so (Ivan
// 2026-09-01, Arch read "NORMAL · 35/35 · 0 left today").
const CAP_HIT: { label: string; tone: Tone } = { label: 'CAP REACHED', tone: 'attention' }
function modeBadge(g: GovernorRow | null, used: number, cap: number): { label: string; tone: Tone } {
  if (cap > 0 && used >= cap) return CAP_HIT
  return g ? MODE[g.mode] : MODE.normal
}
// Arch's governor is a daily ramp (window_label 'day'); "this day" is not English.
const windowWord = (w: string) => (w === 'day' ? 'today' : `this ${w}`)

// Governor severity is honest: over-cap (used>=cap) or a non-normal mode never
// reads green. Only a normal-mode governor still under its cap is green.
function govSev(g: GovernorRow): Sev {
  if (g.mode === 'cold_paused') return 'red'
  if (g.mode === 'warm_only') return 'amber'
  if (g.cap > 0 && g.used >= g.cap) return 'amber'
  return 'green'
}

// Small local copies of SendsScreen primitives — duplicated (not imported) to
// avoid a circular import, since SendsScreen imports this file.
function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function sum<T>(rows: T[], key: keyof T): number {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
}

function latestIso(list: (string | null)[]): string | null {
  let m: string | null = null
  for (const s of list) if (s && (!m || s > m)) m = s
  return m
}

function inClient(id: string, client: Client): boolean {
  return client === 'all' || id === client
}

const TITLE = (id: string) => (id === 'risedtc' ? 'Rise' : id.charAt(0).toUpperCase() + id.slice(1))

// 'YYYY-MM-DD…' to 'MM-DD' without the timezone drift new Date() would introduce
// on a bare date string.
function shortDate(d: string): string {
  const mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  return mm ? `${mm[2]}-${mm[3]}` : d
}

/** An eyebrow line and its predicate, over one instrument. */
function Section({ label, tail, children }: { label: ReactNode; tail?: ReactNode; children: ReactNode }) {
  return (
    <section className="a-sends-sec">
      <div className="a-sends-h">
        <span className="a-eyebrow">{label}</span>
        {tail !== undefined && tail !== null && <span className="a-sends-h-s">{tail}</span>}
      </div>
      {children}
    </section>
  )
}

// ---- Honest over-cap gauge (grafted from direction A) ----
// When used<=cap the fill is used/cap. When used>cap — the operator raised the
// cap on purpose — the number is NEVER clamped: the solid fill ends at a cap
// tick and the remainder becomes a hatched amber overflow segment, so the bar
// reads "past the line" calmly. ratioPct drives the "196% of cap" pill.
function gaugeGeom(used: number, cap: number) {
  if (cap <= 0) return { fillPct: used > 0 ? 100 : 0, capPct: 100, overflow: false, ratioPct: 0 }
  if (used <= cap) {
    const p = Math.round((used / cap) * 100)
    return { fillPct: p, capPct: 100, overflow: false, ratioPct: p }
  }
  const capPct = Math.round((cap / used) * 100)
  return { fillPct: capPct, capPct, overflow: true, ratioPct: Math.round((used / cap) * 100) }
}

function Gauge({ used, cap, tone, sm }: { used: number; cap: number; tone?: Tone; sm?: boolean }) {
  const g = gaugeGeom(used, cap)
  return (
    <span className="a-sends-g" data-sm={sm ? '' : undefined}>
      <span className="a-sends-g-f" data-tone={tone} style={{ width: `${g.fillPct}%` }} />
      {g.overflow && (
        <>
          <span className="a-sends-g-o" style={{ insetInlineStart: `${g.capPct}%` }} />
          <span className="a-sends-g-t" style={{ insetInlineStart: `${g.capPct}%` }} />
        </>
      )}
    </span>
  )
}

// A plain percentage gauge (no overflow logic) for the acceptance / runway tiles.
function BarGauge({ pct, tone, sm }: { pct: number; tone?: Tone; sm?: boolean }) {
  return (
    <span className="a-sends-g" data-sm={sm ? '' : undefined}>
      <span className="a-sends-g-f" data-tone={tone} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  )
}

function OverPill({ used, cap }: { used: number; cap: number }) {
  if (cap <= 0 || used <= cap) return null
  return <span className="a-sends-over">{Math.round((used / cap) * 100)}% of cap</span>
}

/** The unit that rides a figure: a size down, dim, never the thing being read. */
function Unit({ children }: { children: ReactNode }) {
  return <span className="a-sends-u">{children}</span>
}

// ---- HERO: four decision tiles (Converting? Throttled? Runway? Refilling?) ----
function Hero({ accept, governor, pipeline, replacement, client }: {
  accept: AcceptRow[]; governor: GovernorRow[]; pipeline: PipelineRow[]
  replacement: ReplacementRow[]; client: Client
}) {
  // Q1 — Is outreach converting? Acceptance 7d vs 30d baseline. Neutral (grey)
  // when the 7d cohort is too thin to judge — never a false green/red.
  const aRows = accept.filter(r => inClient(r.client_id, client))
  const sent7 = sum(aRows, 'sent_7d'), acc7 = sum(aRows, 'accepted_7d')
  const sent30 = sum(aRows, 'sent_30d'), acc30 = sum(aRows, 'accepted_30d')
  const r7 = acceptRate(sent7, acc7), r30 = acceptRate(sent30, acc30)
  const trend = r7 - r30
  let aSev: Sev
  if (aRows.length === 0 || sent7 === 0) aSev = 'neutral'
  else if (r30 === 0) aSev = r7 > 0 ? 'green' : 'neutral'
  else if (r7 >= r30) aSev = 'green'
  else if (r7 >= r30 * 0.65) aSev = 'amber'
  else aSev = 'red'

  // Q2 — Am I throttled? Governor used/cap + mode + headroom today. Over-cap or a
  // non-normal mode never reads green.
  const gRows = governor.filter(g => inClient(g.client_id, client))
  const gUsed = sum(gRows, 'used'), gCap = sum(gRows, 'cap')
  const gHeadDay = sum(gRows, 'headroom_day')
  const worst = gRows.reduce<GovernorRow | null>(
    (w, g) => (!w || MODE_RANK[g.mode] > MODE_RANK[w.mode] ? g : w), null)
  const gMode = modeBadge(worst, gUsed, gCap)
  let gSev: Sev = 'neutral'
  if (gRows.length > 0) {
    gSev = gRows.some(g => g.mode === 'cold_paused') ? 'red'
      : gRows.some(g => g.mode === 'warm_only') || gUsed >= gCap ? 'amber'
      : 'green'
  }

  // Q3 — Do I have runway? Total sendable ÷ daily send rate. Mirrors the
  // Pipeline block: 7d trailing average, floored by today's governor count.
  const pRows = pipeline.filter(r => inClient(r.client_id, client))
  const totalSendable = sum(pRows, 'sendable')
  const avg7 = pRows.reduce((s, r) => s + r.sent_7d, 0) / 7
  const govDaily = gRows.reduce((s, g) => s + g.daily_used, 0)
  const dailyRate = Math.max(avg7, govDaily)
  const runway = runwayDays(totalSendable, dailyRate)
  const rSev: Sev = pRows.length === 0 ? 'neutral' : runway < 2 ? 'red' : runway < 5 ? 'amber' : 'green'

  // Q4 — Is it refilling? Qualified IN / invites OUT over 7d. Runway above is a STOCK
  // measure and cannot see this: a pool draining every day still prints a positive
  // runway right until it hits zero. Measured 07-25..08-06, Ivan sat under 1.0x on 6 of
  // 13 days while Runway never once read 0.
  const cutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
  const repRows = replacement.filter(r => inClient(r.client_id, client) && r.day >= cutoff)
  const qIn = sum(repRows, 'qualified_in'), qOut = sum(repRows, 'sent_out')
  const rate = replacementRate(qIn, qOut)
  const dailyOut = qOut / 7
  const empty = daysToEmpty(totalSendable, dailyOut, rate)
  // Under 1.0 the pool shrinks every day, so amber starts at break-even, not below it.
  const repSev: Sev = repRows.length === 0 || rate == null ? 'neutral'
    : rate >= 1.2 ? 'green' : rate >= 1 ? 'amber' : 'red'

  const trendSev: Sev = trend >= 0 ? 'green' : trend >= -Math.max(3, r30 * 0.35) ? 'amber' : 'red'
  // The up, down and flat marks as lucide, per the system's glyph map: direction is read from the
  // mark before the colour, so a delta stays legible without hue.
  const trendIcon = trend > 0 ? 'deltaUp' : trend < 0 ? 'deltaDown' : 'minus'
  const trendClass = trendSev === 'green' ? 'a-up' : trendSev === 'amber' ? 'a-sev-attention' : 'a-sev-urgent'

  const mark = (s: Sev) => <Dot tone={SEV_TONE[s]} off={s === 'neutral'} />

  return (
    <Section label="Decision" tail="where do I stand right now">
      <Ledger>
        {/* Acceptance */}
        <Cell
          label={<span className="a-sends-cl">Accept{mark(aSev)}</span>}
          emptyText="No data"
          value={aRows.length === 0 ? undefined : <>{r7}<Unit>%</Unit></>}
          note={aRows.length === 0 ? undefined : (
            <>
              {acc7}/{sent7} <Sep />7d
              {' '}
              <span className={`a-sends-delta ${trendClass}`}>
                <Icon name={trendIcon} size={16} />{Math.abs(trend)}
              </span>
              {' '}<Sep />30d
            </>
          )}
        >
          {aRows.length > 0 && <BarGauge pct={r7} tone={SEV_TONE[aSev] ?? 'clear'} sm />}
        </Cell>
        {/* Governor */}
        <Cell
          label={<span className="a-sends-cl">Governor{mark(gSev)}</span>}
          emptyText="No data"
          value={gRows.length === 0 ? undefined : <>{gUsed}<Unit>/{gCap}</Unit></>}
          note={gRows.length === 0 ? undefined : (
            <>
              <span className={gMode.tone === 'clear' ? 'a-sev-clear' : gMode.tone === 'urgent' ? 'a-sev-urgent' : 'a-sev-attention'}>{gMode.label}</span>
              {' · '}{gHeadDay} left today
              <OverPill used={gUsed} cap={gCap} />
            </>
          )}
        >
          {gRows.length > 0 && <Gauge used={gUsed} cap={gCap} tone={gMode.tone} sm />}
        </Cell>
        {/* Runway */}
        <Cell
          label={<span className="a-sends-cl">Runway{mark(rSev)}</span>}
          emptyText="No data"
          value={pRows.length === 0 ? undefined : <>{runway >= 999 ? '∞' : runway}<Unit>{runway >= 999 ? '' : 'd'}</Unit></>}
          note={pRows.length === 0 ? undefined : `${totalSendable} sendable`}
        >
          {pRows.length > 0 && (
            <BarGauge pct={runway >= 999 ? 100 : (runway / 14) * 100} tone={SEV_TONE[rSev] ?? 'clear'} sm />
          )}
        </Cell>
        {/* Refill — the flow tile. Runway says how long the tank lasts; this says
            whether the tap is on. */}
        <Cell
          label={<span className="a-sends-cl">Refill{mark(repSev)}</span>}
          emptyText="No data"
          value={repRows.length === 0 || rate == null ? undefined : <>{rate.toFixed(2)}<Unit>x</Unit></>}
          note={repRows.length === 0 || rate == null ? undefined : (
            <>
              {qIn} in / {qOut} out <Sep />7d
              {empty != null && <span className="a-sev-urgent"> <Sep />empty in {empty}d</span>}
            </>
          )}
        >
          {/* 1.0x sits at the half mark, so "is the bar past halfway" reads as
              "is the pool growing" without needing the number. */}
          {repRows.length > 0 && rate != null && (
            <BarGauge pct={Math.min(100, (rate / 2) * 100)} tone={SEV_TONE[repSev] ?? 'clear'} sm />
          )}
        </Cell>
      </Ledger>
    </Section>
  )
}

// ---- The funnel bars ----
// One step is a neutral track with a lime layer clipped to its share of the
// first step; the count pill lives INSIDE the segment, so the figure and the
// quantity it stands for are the same mark. Only a real subset conversion
// carries a rate between two steps.
type Step = { id: string; n: number; label: string; rate?: string }

function FunnelBars({ steps }: { steps: Step[] }) {
  const top = Math.max(1, ...steps.map(s => s.n))
  return (
    <div className="a-sends-fn">
      {steps.map((s, i) => {
        const pct = Math.max(0, Math.min(100, (s.n / top) * 100))
        const inner = (
          <>
            <span className="a-sends-fn-n">{s.n}</span>
            <span className="a-sends-fn-l">{s.label}</span>
          </>
        )
        return (
          <div key={s.id}>
            {i > 0 && (
              <div className="a-sends-farrow">
                {s.rate ? <>{s.rate}<Icon name="down" size={16} /></> : <Sep />}
              </div>
            )}
            <div className="a-sends-ftrack">
              <span className="a-sends-flayer">{inner}</span>
              <span
                className="a-sends-flayer"
                data-fill=""
                style={{ '--a-sends-pct': `${pct}%` } as CSSProperties}
              >{inner}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- FUNNEL: Sent, Accepted, Conversations, Calls (7d) ----
// Only the Sent to Accepted step is a real subset conversion, so only it carries a
// % arrow. Conversations (any inbound reply, optouts excluded) can arrive via
// InMail/email without an accept, and calls can come from any channel, so the
// later steps are neutral separators, never a "conversion" percentage.
function Funnel({ accept, scans, outcomes, client }: {
  accept: AcceptRow[]; scans: ScanOpenRow[]; outcomes: OutcomeRow[]; client: Client
}) {
  const aRows = accept.filter(r => inClient(r.client_id, client))
  const sent7 = sum(aRows, 'sent_7d'), acc7 = sum(aRows, 'accepted_7d')
  const sent30 = sum(aRows, 'sent_30d'), acc30 = sum(aRows, 'accepted_30d')

  const sRows = scans.filter(r => inClient(r.client_id, client))
  const opens7 = sum(sRows, 'opens_7d'), opens30 = sum(sRows, 'opens_30d')
  const distinct = sum(sRows, 'distinct_prospects')
  const lastOpen = latestIso(sRows.map(r => r.last_open))

  const oRows = outcomes.filter(r => inClient(r.client_id, client))
  const convos7 = sum(oRows, 'convos_7d'), convosTotal = sum(oRows, 'convos_total')
  const calls7 = sum(oRows, 'calls_7d'), callsTotal = sum(oRows, 'calls_total')

  const acceptStep = sent7 > 0 ? `${Math.round((acc7 / sent7) * 100)}%` : '—'

  if (aRows.length === 0 && sRows.length === 0 && oRows.length === 0) {
    return (
      <Section label="Funnel" tail="7d">
        <div className="a-sends-empty">No funnel data yet.</div>
      </Section>
    )
  }

  return (
    <Section label="Funnel" tail="last 7d">
      <FunnelBars steps={[
        { id: 'sent', n: sent7, label: 'Invites' },
        { id: 'accepted', n: acc7, label: 'Accepted', rate: acceptStep },
        { id: 'convos', n: convos7, label: 'Convos' },
        { id: 'calls', n: calls7, label: 'Calls' },
      ]} />
      <div className="a-sends-cap">
        Era totals · convos {convosTotal} · calls {callsTotal} · convos = replied at least once, optouts excluded.
      </div>
      <div className="a-sends-cap">
        30d · accepted {acc30}/{sent30} · scan opens 7d {opens7} / 30d {opens30} · {distinct} prospects{lastOpen ? ` · last ${ago(lastOpen)}` : ''}
      </div>
      <div className="a-sends-cap">Ivan scope counts the warm-lane era only (since 07-11); Rise counts full history. Recent sends are still maturing — accept rate only rises.</div>
    </Section>
  )
}

// ---- Daily ledger: the day-by-day numbers, per seat ----
// Ivan 2026-09-01: "the daily sends are missing". The Volume cards had a
// sparkline with no numbers and the Pipeline block had 7d/30d totals; the
// per-day figures he reads first were nowhere. Two columns sit side by side on
// purpose: Invites is what LEFT the seat, Cap is the seat's enforcement counter,
// spent before the provider answers. When Cap runs ahead of Invites, those slots
// went to refused sends — the Arch seat burned its whole cap 08-27..08-30 and
// sent nothing, and every tile above read that as a quiet lane.
function ledgerDayLabel(day: string, todayIso: string): string {
  if (day === todayIso) return 'Today'
  const d = new Date(day + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
}

type LedgerTableRow = {
  id: string
  label: string
  today: boolean
  total: boolean
  invites: number
  accepted: number
  dms: number
  inmails: number
  cap: ReactNode
  burned: number
}

function DayLedger({ rows, client, timeframe }: { rows: LedgerRow[]; client: Client; timeframe: Timeframe }) {
  // Nothing rendered when the view is not applied: the fetch soft-fails to [].
  if (rows.length === 0) return null
  const days = timeframe === '7d' ? 7 : 14
  const todayIso = new Date().toISOString().slice(0, 10)
  const led = buildLedger(rows, client, days, todayIso)
  const tot = led.reduce((a, d) => ({
    invites: a.invites + d.invites, accepted: a.accepted + d.accepted,
    dms: a.dms + d.dms, inmails: a.inmails + d.inmails, burned: a.burned + d.burned,
  }), { invites: 0, accepted: 0, dms: 0, inmails: 0, burned: 0 })
  const pct = (acc: number, inv: number) => (inv > 0 ? ` ${Math.round((acc / inv) * 100)}%` : '')
  const n = (v: number) => <span className={v === 0 ? 'a-dim-2' : undefined}>{v}</span>

  const tableRows: LedgerTableRow[] = [
    ...led.map(d => ({
      id: d.day,
      label: ledgerDayLabel(d.day, todayIso),
      today: d.day === todayIso,
      total: false,
      invites: d.invites,
      accepted: d.accepted,
      dms: d.dms,
      inmails: d.inmails,
      cap: (
        <>
          {d.cap_used == null ? '—' : `${d.cap_used}/${d.cap_limit ?? '?'}`}
          {d.burned > 0 && <i className="a-sends-burn">−{d.burned} burned</i>}
        </>
      ),
      burned: d.burned,
    })),
    {
      id: 'total',
      label: `${days}d`,
      today: false,
      total: true,
      invites: tot.invites,
      accepted: tot.accepted,
      dms: tot.dms,
      inmails: tot.inmails,
      cap: tot.burned > 0 ? <i className="a-sends-burn">−{tot.burned} burned</i> : <>—</>,
      burned: tot.burned,
    },
  ]

  const columns: Array<TableColumn<LedgerTableRow>> = [
    {
      id: 'day',
      header: 'Day',
      cell: r => (
        <span className="a-sends-day" data-today={r.today ? '' : undefined} data-total={r.total ? '' : undefined}>
          {r.label}
        </span>
      ),
    },
    { id: 'invites', header: 'Invites', numeric: true, cell: r => n(r.invites) },
    {
      id: 'accepted',
      header: 'Accepted',
      numeric: true,
      cell: r => (
        <>
          <span className={r.accepted === 0 && !r.total ? 'a-dim-2' : undefined}>{r.accepted}</span>
          <i className="a-sends-sub">{pct(r.accepted, r.invites)}</i>
        </>
      ),
    },
    { id: 'dms', header: 'DMs', numeric: true, cell: r => n(r.dms) },
    { id: 'inmails', header: 'InMail', numeric: true, cell: r => n(r.inmails) },
    { id: 'cap', header: 'Cap', numeric: true, cell: r => r.cap },
  ]

  return (
    <Section label="Daily" tail={`last ${days} days · UTC`}>
      <div className="a-scroll-x">
        <Table
          label="Sends by day"
          columns={columns}
          rows={tableRows}
          rowKey={r => r.id}
        />
      </div>
      <div className="a-sends-cap">
        Invites = notes that left the seat. Cap = the seat's counter, spent before the provider answers; when it runs ahead of Invites those slots went to refused sends. Accepted is of that day's invites and only rises.
      </div>
    </Section>
  )
}

// ---- Range summary (custom date selector) ----
// Explicit-range KPIs from inbox_range_kpis — no era cutoff, the picked dates
// are the scope. Daily sparkline data only reaches 90d back, but this RPC
// counts from the raw tables, so any range works.
function RangeSummary({ range, client }: { range: DateRange; client: Client }) {
  const [rows, setRows] = useState<RangeKpiRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setRows(null); setError(null)
    fetchRangeKpis(range.from, range.to)
      .then(r => { if (live) setRows(r) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Failed to load') })
    return () => { live = false }
  }, [range.from, range.to])

  const rs = (rows ?? []).filter(r => inClient(r.client_id, client))
  const sent = sum(rs, 'sent'), accepted = sum(rs, 'accepted')
  const convos = sum(rs, 'convos'), calls = sum(rs, 'calls')
  const pct = sent > 0 ? `${Math.round((accepted / sent) * 100)}%` : '—'

  return (
    <Section
      label="Range"
      tail={<>{shortDate(range.from)}<Icon name="next" size={16} />{shortDate(range.to)}</>}
    >
      {error ? (
        <div className="a-sends-empty">{error}</div>
      ) : rows === null ? (
        <div className="a-sends-empty">Loading…</div>
      ) : (
        <>
          <FunnelBars steps={[
            { id: 'sent', n: sent, label: 'Invites' },
            { id: 'accepted', n: accepted, label: 'Accepted', rate: pct },
            { id: 'convos', n: convos, label: 'Convos' },
            { id: 'calls', n: calls, label: 'Calls' },
          ]} />
          <div className="a-sends-cap">Exact range, no era cutoff — accepts counted on the notes sent inside it.</div>
        </>
      )}
    </Section>
  )
}

// ---- Volume (per-channel) ----
function laneCount(lane: Lane, daily: DailyRow[], client: Client, tf: Timeframe, range: DateRange | null): number {
  if (tf === '7d') return lane.sent_7d
  if (tf === '30d') return lane.sent_30d
  // custom: sum daily rows inside the picked range (daily reaches 90d back)
  return daily
    .filter(d => d.message_type === lane.key && inClient(d.client_id, client)
      && (!range || (d.day >= range.from && d.day <= range.to)))
    .reduce((s, d) => s + d.sent, 0)
}

function KpiRow({ lanes, daily, client, timeframe, range }: {
  lanes: Lane[]; daily: DailyRow[]; client: Client; timeframe: Timeframe; range: DateRange | null
}) {
  const counts = lanes.map(l => laneCount(l, daily, client, timeframe, range))
  const top = Math.max(1, ...counts)
  const total = counts.reduce((s, c) => s + c, 0)
  return (
    <Section
      label="Volume"
      tail={timeframe === 'custom' && range
        ? <>{shortDate(range.from)}<Icon name="next" size={16} />{shortDate(range.to)}</>
        : timeframe}
    >
      {/* M4 — the footer's Total is a sum over the SAME already-fetched aggregate
          rows the bars above are drawn from (inbox_sends_daily_v / the sends
          view), so the footer and the plot can never disagree, and nothing here
          is a rows.length of a capped page. A lane is a category, so its mark is
          a neutral dot: the one accent on this run is today's bar. */}
      <Group foot={(
        <span className="a-sends-foot">
          {lanes.map(lane => (
            <span className="a-sends-legend" key={lane.key}><Dot />{lane.label}</span>
          ))}
          <span className="a-sends-tot">Total: <b>{total}</b></span>
        </span>
      )}>
        <Rows>
          {lanes.map((lane, i) => (
            <Row
              key={lane.key}
              lead={<Dot />}
              title={lane.label}
              tail={<span className="a-sends-spk"><Spark values={lane.daily} highlightLast /></span>}
            >
              <BarLine pct={(counts[i] / top) * 100} tone="quiet" tail={<b className="a-ink">{counts[i]}</b>} />
              <span className="a-row-meta">24h: {lane.sent_24h}</span>
            </Row>
          ))}
        </Rows>
      </Group>
    </Section>
  )
}

// ---- Governor detail (weekly gauge + daily brake + mode + monthly) ----
function GovGauge({ g }: { g: GovernorRow }) {
  const m = modeBadge(g, g.used, g.cap)
  const sev = govSev(g)
  // Cohort accept is null while the matured window (sends 3-18d old) is still
  // empty — show "not enough data yet" (+ opens date if known), never a false 0%.
  const cohortStr = g.accept_rate == null
    ? `cohort: not enough data yet${g.cohort_opens_at ? ` (opens ~${shortDate(g.cohort_opens_at)})` : ''}`
    : `cohort accept (3-18d): ${g.accept_rate}%`
  const gated = governorEnforcementGap(g.used, g.cap, g.gov_used, g.gov_cap)
  return (
    <Row
      lead={<Dot tone={SEV_TONE[sev]} off={SEV_TONE[sev] === undefined} />}
      title={TITLE(g.client_id)}
      tail={<Badge tone={m.tone === 'quiet' ? 'neutral' : m.tone} label={`Mode ${m.label}`}>{m.label}</Badge>}
    >
      <span className="a-sends-stack">
        <Gauge used={g.used} cap={g.cap} tone={m.tone} />
        <span className="a-sends-gline">
          <b>{g.used}</b>/{g.cap} <span className="a-dim">{windowWord(g.window_label)}</span>
          <OverPill used={g.used} cap={g.cap} />
        </span>
        <span className="a-sends-gline">cap {g.cap} <Sep />{cohortStr}</span>
        {gated && (
          <span className="a-sends-gline a-sev-attention">governor counter {g.gov_used}/{g.gov_cap} (shared) — cold sends gated</span>
        )}
        {g.daily_cap > 0 && (
          <>
            <Gauge used={g.daily_used} cap={g.daily_cap} tone={m.tone} sm />
            <span className="a-sends-gline"><b>{g.daily_used}</b>/{g.daily_cap} today</span>
          </>
        )}
        <span className="a-sends-gline">
          {g.window_label === 'day'
            ? `${g.headroom_day} left today`
            : `${g.headroom_week} left this ${g.window_label} · ${g.headroom_day} left today`}
        </span>
        {g.monthly_cap != null && (
          <span className="a-sends-gline">{g.monthly_used}/{g.monthly_cap} this month</span>
        )}
      </span>
    </Row>
  )
}

function Governor({ rows, client }: { rows: GovernorRow[]; client: Client }) {
  const targets: string[] = client === 'all' ? ['ivan', 'risedtc', 'arch'] : [client]
  const cards = targets
    .map(t => rows.find(r => r.client_id === t))
    .filter((g): g is GovernorRow => Boolean(g))

  return (
    <Section label="Governor detail">
      {cards.length === 0 ? (
        <div className="a-sends-empty">No governor data.</div>
      ) : (
        <Group>
          <Rows>
            {cards.map(g => <GovGauge key={g.client_id} g={g} />)}
          </Rows>
        </Group>
      )}
    </Section>
  )
}

// ---- Seats: two-seat compare (grafted from direction B, placed in-column) ----
type PersonSummary = {
  id: string
  gov: GovernorRow | null
  sendable: number; runway: number
  vol24: number
  reply: ReplyRow | null
}

function personSummary(data: OverviewData, id: string): PersonSummary {
  const gov = data.governor.find(g => g.client_id === id) ?? null
  const pRows = data.pipeline.filter(r => r.client_id === id)
  const sendable = pRows.reduce((s, r) => s + r.sendable, 0)
  const avg7 = pRows.reduce((s, r) => s + r.sent_7d, 0) / 7
  const dailyRate = Math.max(avg7, gov ? gov.daily_used : 0)
  const runway = runwayDays(sendable, dailyRate)
  const vol24 = data.rows.filter(r => r.client_id === id).reduce((s, r) => s + r.sent_24h, 0)
  const reply = data.reply.find(r => r.client_id === id) ?? null
  return { id, gov, sendable, runway, vol24, reply }
}

function SeatCard({ p, selected, neutral, onSelect }: {
  p: PersonSummary; selected: boolean; neutral: boolean; onSelect?: () => void
}) {
  const g = p.gov
  const m = g ? modeBadge(g, g.used, g.cap) : null
  const runwayLbl = p.runway >= 999 ? '∞' : `${p.runway}d`
  const cohort = g == null || g.accept_rate == null ? '—' : `${g.accept_rate}%`
  // Reply rate of people who accepted AND got DM1 — the only denominator where a
  // reply was ever possible. 30d, because the 7d cohort is still being answered.
  const replyStr = p.reply == null || p.reply.rate_30d == null ? '—' : `${p.reply.rate_30d}%`
  const replySub = p.reply == null ? '' : `${p.reply.replied_30d}/${p.reply.dmd_30d}`
  return (
    <Row
      title={TITLE(p.id)}
      selected={selected && !neutral}
      onClick={onSelect}
      tail={m ? <Badge tone={m.tone === 'quiet' ? 'neutral' : m.tone} label={`Mode ${m.label}`}>{m.label}</Badge> : undefined}
    >
      <span className="a-sends-stack">
        {g ? (
          <>
            <Gauge used={g.used} cap={g.cap} tone={m!.tone} sm />
            {/* Ivan 2026-09-04: the three seats do NOT share a window. Ivan and RISE run a
                weekly governor (x/280); arch runs a daily ramp (x/40). Side by side with no
                label, arch read like a nearly-empty week when it was a half-spent day. The
                window is stated instead of normalised: multiplying arch's cap by seven would
                invent a weekly ceiling nothing actually enforces. */}
            <span className="a-sends-gline">
              <b>{g.used}</b>/{g.cap} <span className="a-dim">{windowWord(g.window_label)}</span>
              <OverPill used={g.used} cap={g.cap} />
            </span>
          </>
        ) : (
          <span className="a-sends-gline a-dim-2">no governor</span>
        )}
        {/* Ivan 2026-08-24: from the seat's numbers straight to the rules that
            produced them. The filters are what make these figures what they are,
            and having to go hunting for them is how a spec stops being read.
            stopPropagation because the whole card is a seat selector.

            WORKBENCH ONLY. SendsScreen (and this card with it) is SHARED with
            #exp/stock, which has no Strategy tab and none of the .wb styling, so
            in the escape hatch this would be an unstyled link to a dead route.
            Stock must not move. */}
        {getExpVariant() !== 'stock' && (
          <a
            className="a-sends-link" href="#exp/v2c/strategy"
            onClick={e => e.stopPropagation()}
          >
            What we filter on<Icon name="next" size={16} />
          </a>
        )}
        <KV rows={[
          ['Cohort accept', cohort],
          ['Reply 30d', <>{replyStr}<span className="a-sends-sub">{replySub}</span></>],
          ['Pipeline', <>{p.sendable}<span className="a-sends-sub">{runwayLbl}</span></>],
          ['24h vol', p.vol24],
        ] as Array<[ReactNode, ReactNode]>} />
      </span>
    </Row>
  )
}

function Seats({ data, client, setClient }: {
  data: OverviewData; client: Client; setClient?: (c: Client) => void
}) {
  const people = [personSummary(data, 'ivan'), personSummary(data, 'risedtc'), personSummary(data, 'arch')]
  const neutral = client === 'all'
  return (
    <Section label="Seats" tail="both counters, one glance">
      <Group>
        <Rows>
          {people.map(p => (
            <SeatCard
              key={p.id}
              p={p}
              selected={client === p.id}
              neutral={neutral}
              onSelect={setClient && client !== p.id ? () => setClient(p.id as Client) : undefined}
            />
          ))}
        </Rows>
      </Group>
    </Section>
  )
}

// ---- Pipeline (sendable per lane + runway) ----
function Pipeline({ rows, governor, client }: {
  rows: PipelineRow[]; governor: GovernorRow[]; client: Client
}) {
  const pRows = rows.filter(r => inClient(r.client_id, client))
  const byLane = new Map<string, { sendable: number; sent7: number; sent30: number }>()
  for (const r of pRows) {
    const e = byLane.get(r.lane) ?? { sendable: 0, sent7: 0, sent30: 0 }
    e.sendable += r.sendable; e.sent7 += r.sent_7d; e.sent30 += r.sent_30d
    byLane.set(r.lane, e)
  }
  const lanes = [...byLane.entries()]
  const totalSendable = lanes.reduce((s, [, e]) => s + e.sendable, 0)

  // Daily send rate: the 7d trailing average is a real full-day rate. The
  // governor's daily_used is only a partial-day count, so use it as a floor
  // (a heavy day shortens runway) but never as the estimate — otherwise runway
  // is overstated all morning and the amber/red lane dots under-trigger.
  const avg7 = pRows.reduce((s, r) => s + r.sent_7d, 0) / 7
  const govDaily = governor.filter(g => inClient(g.client_id, client)).reduce((s, g) => s + g.daily_used, 0)
  const dailyRate = Math.max(avg7, govDaily)

  const overallRunway = runwayDays(totalSendable, dailyRate)
  const maxSendable = Math.max(1, ...lanes.map(([, e]) => e.sendable))

  return (
    <Section label="Pipeline" tail={overallRunway >= 999 ? 'runway ∞' : `${overallRunway}d runway`}>
      {lanes.length === 0 ? (
        <div className="a-sends-empty">No pipeline data.</div>
      ) : (
        /* M4 — the pipeline's own legend + Total. The three legend entries are
           the runway thresholds the bar fills already encode (M14), so the
           footer names the encoding rather than repeating the numbers. */
        <Group foot={(
          <span className="a-sends-foot">
            <span className="a-sends-legend"><Dot tone="clear" />5d+</span>
            <span className="a-sends-legend"><Dot tone="attention" />2-5d</span>
            <span className="a-sends-legend"><Dot tone="urgent" />under 2d</span>
            <span className="a-sends-tot">Total: <b>{totalSendable}</b> sendable</span>
          </span>
        )}>
          <Rows>
            {lanes.map(([lane, e]) => {
              const laneRunway = dailyRate > 0 ? Math.floor(e.sendable / dailyRate) : 999
              const tone: Tone = laneRunway < 2 ? 'urgent' : laneRunway < 5 ? 'attention' : 'clear'
              return (
                <Row key={lane} lead={<Dot tone={tone} />} title={laneLabel(lane)}>
                  <BarLine pct={(e.sendable / maxSendable) * 100} tone={tone} tail={<b className="a-ink">{e.sendable}</b>} />
                  <span className="a-row-meta">sent · 7d {e.sent7} · 30d {e.sent30}</span>
                </Row>
              )
            })}
          </Rows>
        </Group>
      )}
    </Section>
  )
}

// ---- Campaigns ----
// Zero-send PAUSED campaigns are collapsed behind an expander by default so the
// active / sending campaigns aren't buried under a wall of "PAUSED 0" rows.
function Campaigns({ rows, client }: { rows: CampaignSend[]; client: Client }) {
  const [showPaused, setShowPaused] = useState(false)
  // Ivan ruling 2026-07-25: paused campaigns are retired history on the Ivan
  // scope — hide them outright (no expander). Rise keeps the expander.
  const visible = client === 'ivan' ? rows.filter(c => c.is_active) : rows
  const shown = visible.filter(c => c.is_active || c.sent > 0)
  const hidden = client === 'ivan' ? [] : visible.filter(c => !c.is_active && c.sent === 0)
  const tableRows = showPaused ? [...shown, ...hidden] : shown

  const columns: Array<TableColumn<CampaignSend>> = [
    { id: 'name', header: 'Campaign', cell: c => <span className="a-sends-nm">{c.campaign_name}</span> },
    {
      id: 'state',
      header: 'State',
      cell: c => (
        <Badge tone={c.is_active ? 'clear' : 'neutral'} label={c.is_active ? 'ACTIVE' : 'PAUSED'}>
          {c.is_active ? 'ACTIVE' : 'PAUSED'}
        </Badge>
      ),
    },
    { id: 'sent7', header: '7d', numeric: true, cell: c => (c.sent_7d != null ? c.sent_7d : <span className="a-dim-2">—</span>) },
    { id: 'sent', header: 'Sent', numeric: true, cell: c => c.sent },
  ]

  return (
    <Section label="Campaigns">
      {rows.length === 0 ? (
        <div className="a-sends-empty">No campaigns.</div>
      ) : (
        <>
          <div className="a-scroll-x">
            <Table
              label="Campaigns by sends"
              columns={columns}
              rows={tableRows}
              rowKey={c => c.campaign_id}
            />
          </div>
          {hidden.length > 0 && (
            <button type="button" className="a-sends-more" onClick={() => setShowPaused(v => !v)}>
              <Icon name={showPaused ? 'minus' : 'add'} size={16} />
              {hidden.length} paused, 0 sent
            </button>
          )}
          {/* M4 — the table's Total is the sum of the rows it is SHOWING, and it
              says so: `visible` is the scoped set, `shown` is what rendered.
              inbox_campaign_sends_v is a server-side aggregate, so these are full
              counts, not a page. */}
          <div className="a-sends-foot">
            <span>{shown.length} of {visible.length} campaigns shown</span>
            <span className="a-sends-tot">
              Total: <b>{shown.reduce((s, c) => s + c.sent, 0).toLocaleString()}</b> sent
            </span>
          </div>
        </>
      )}
    </Section>
  )
}

type OverviewData = {
  rows: Awaited<ReturnType<typeof fetchSends>>
  daily: Awaited<ReturnType<typeof fetchSendsDaily>>
  accept: AcceptRow[]
  pipeline: PipelineRow[]
  governor: GovernorRow[]
  scans: ScanOpenRow[]
  outcomes: OutcomeRow[]
  campaigns: CampaignSend[]
  replacement: ReplacementRow[]
  reply: ReplyRow[]
  ledger: LedgerRow[]
}

export function OverviewView({ client, timeframe, setClient, range = null }: {
  client: Client; timeframe: Timeframe; setClient?: (c: Client) => void
  range?: DateRange | null
}) {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    Promise.all([
      fetchSends(), fetchSendsDaily(), fetchAccept(), fetchPipeline(),
      fetchGovernor(), fetchScanOpens(), fetchOutcomes(), fetchCampaignSends(client),
      fetchReplacement(), fetchReply(), fetchDayLedger(),
    ])
      .then(([rows, daily, accept, pipeline, governor, scans, outcomes, campaigns, replacement, reply, ledger]) => {
        if (live) setData({ rows, daily, accept, pipeline, governor, scans, outcomes, campaigns, replacement, reply, ledger })
      })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Failed to load') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [client])

  if (loading && !data) return <Body><div className="a-sends-load">Loading…</div></Body>
  if (error) return <Body><div className="a-sends-load">{error}</div></Body>
  if (!data) return <Body><div className="a-sends-load">No data yet — the call returned, it just had nothing in it.</div></Body>

  const lanes = buildLanes(data.rows, data.daily, client)

  return (
    <Body>
      <Hero accept={data.accept} governor={data.governor} pipeline={data.pipeline} replacement={data.replacement} client={client} />
      {timeframe === 'custom' && range && <RangeSummary range={range} client={client} />}
      <DayLedger rows={data.ledger} client={client} timeframe={timeframe} />
      <Funnel accept={data.accept} scans={data.scans} outcomes={data.outcomes} client={client} />
      <div className="a-cols" data-cols="2">
        <KpiRow lanes={lanes} daily={data.daily} client={client} timeframe={timeframe} range={range} />
        <Pipeline rows={data.pipeline} governor={data.governor} client={client} />
      </div>
      <div className="a-cols" data-cols="2">
        <Governor rows={data.governor} client={client} />
        <div className="a-stack" data-wide>
          <Seats data={data} client={client} setClient={setClient} />
          <Campaigns rows={data.campaigns} client={client} />
        </div>
      </div>
    </Body>
  )
}
