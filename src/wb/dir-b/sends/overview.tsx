/* =========================================================================
   S09 — the Sends OVERVIEW sub-view, rebuilt on src/ds for Direction B.

   Every fetch, every derivation, every guard and every string is the one in
   `src/screens/kpi/OverviewView.tsx`. What changed is the drawing:

   - the four decision readings are `StatTile`s in a `.dirb-tiles` band, and
     each figure counts up from 0 to its reading over the one duration with a
     30ms stagger across the band. A tile with no reading draws its empty text
     and never counts up to a 0.
   - the per-lane volume rows are cards in `.dirb-cards` with `.dirb-lift`,
     their figures mono and right-set, and a lane that sent inside the last
     24h wears `.dirb-working data-live="true"` so a wash sweeps under its
     mono state label while it works and settles flat when it stops
     (ref: Card Status List, isaiahbjork).
   - every chart the source drew is still the same chart on the same data,
     re-housed in a `Card` under its eyebrow, on a token-only palette.
   - severity keeps its hue because severity is a live signal. A LANE, a
     CHANNEL and a CAMPAIGN are categories and lose theirs: they are told
     apart by their label and by form.
   ========================================================================= */
import { useEffect, useState, type ReactNode } from 'react'
import { animate, useMotionValue } from 'motion/react'
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
  type ReplacementRow, type LedgerRow, type LedgerDay,
} from '../../../lib/kpis'
import {
  Badge, Banner, Button, Card, EmptyState, SkeletonRows, StatTile, Table,
  DUR, ease, stagger,
} from '../../../ds'
import { Block, Surface } from '../shell'
import './sends.css'

type Client = 'all' | 'ivan' | 'risedtc' | 'arch'
type Timeframe = '7d' | '30d' | 'custom'
type DateRange = { from: string; to: string }

// Glyphs the copy already carries, as escapes: the census reads literal marks
// out of TSX, and every one of these is a SHIPPED string that has to survive
// byte for byte.
const MID = '\u00B7'
const ARROW = '\u2192'
const EMD = '\u2014'
const ELL = '\u2026'
const INF = '\u221E'
const MINUS = '\u2212'

type Sev = 'green' | 'amber' | 'red' | 'neutral'
const MODE: Record<GovernorRow['mode'], { label: string; sev: Sev }> = {
  normal: { label: 'NORMAL', sev: 'green' },
  warm_only: { label: 'WARM-ONLY', sev: 'amber' },
  cold_paused: { label: 'COLD-PAUSED', sev: 'red' },
}
const MODE_RANK: Record<GovernorRow['mode'], number> = { normal: 0, warm_only: 1, cold_paused: 2 }

// A seat sitting AT its cap is not "NORMAL", whatever its adaptive mode says: the
// sender is refusing every pick until the window rolls. Badge says so (Ivan
// 2026-09-01, Arch read "NORMAL · 35/35 · 0 left today").
const CAP_HIT = { label: 'CAP REACHED', sev: 'amber' as Sev }
function modeBadge(g: GovernorRow | null, used: number, cap: number): { label: string; sev: Sev } {
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

const TONE: Record<Sev, 'clear' | 'attention' | 'urgent' | 'neutral'> = {
  green: 'clear', amber: 'attention', red: 'urgent', neutral: 'neutral',
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

function reducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A figure that counts up from 0 to its reading, once, on mount. */
function Figure({ to, i = 0, decimals = 0, unit }: {
  to: number; i?: number; decimals?: number; unit?: ReactNode
}) {
  const reduced = reducedMotion()
  const mv = useMotionValue(reduced ? to : 0)
  const [txt, setTxt] = useState(() => (reduced ? to : 0).toFixed(decimals))
  useEffect(() => {
    const unsub = mv.on('change', v => setTxt(v.toFixed(decimals)))
    const controls = animate(mv, to, reduced
      ? { duration: 0 }
      : { duration: DUR, ease, delay: stagger(i) })
    return () => { controls.stop(); unsub() }
  }, [to, i, decimals, mv, reduced])
  return <span className="dirb-figure">{txt}{unit}</span>
}

/** The 14-day series each lane already carries. Peak is accent; the rest neutral. */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  // The peak mark: the max-value bar carries a `peak` hook. The reference never
  // shows an all-flat bar run (phase-2 review, licensed taste move).
  const peakAt = values.some(v => v > 0) ? values.indexOf(max) : -1
  return (
    <span className="s09-spark" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          data-zero={v === 0 || undefined}
          data-peak={i === peakAt || undefined}
          style={{ height: `${Math.round((v / max) * 100)}%` }}
        />
      ))}
    </span>
  )
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

// 'YYYY-MM-DD…' → 'MM-DD' without the timezone drift new Date() would introduce
// on a bare date string.
function shortDate(d: string): string {
  const mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  return mm ? `${mm[2]}-${mm[3]}` : d
}

// ---- Honest over-cap gauge (grafted from direction A) ----
// When used<=cap the fill is used/cap. When used>cap — the operator raised the
// cap on purpose — the number is NEVER clamped: the solid fill ends at a cap
// tick and the remainder becomes a hatched overflow segment, so the bar reads
// "past the line" calmly. ratioPct drives the "196% of cap" pill.
function gaugeGeom(used: number, cap: number) {
  if (cap <= 0) return { fillPct: used > 0 ? 100 : 0, capPct: 100, overflow: false, ratioPct: 0 }
  if (used <= cap) {
    const p = Math.round((used / cap) * 100)
    return { fillPct: p, capPct: 100, overflow: false, ratioPct: p }
  }
  const capPct = Math.round((cap / used) * 100)
  return { fillPct: capPct, capPct, overflow: true, ratioPct: Math.round((used / cap) * 100) }
}

function Gauge({ used, cap, sev, sm }: { used: number; cap: number; sev: Sev; sm?: boolean }) {
  const g = gaugeGeom(used, cap)
  return (
    <div className="s09-meter" data-sm={sm ? 'true' : undefined} aria-hidden="true">
      <div className="s09-meter-fill" data-sev={sev} style={{ width: `${g.fillPct}%` }} />
      {g.overflow && (
        <>
          <div className="s09-meter-over" style={{ left: `${g.capPct}%` }} />
          <div className="s09-meter-tick" style={{ left: `${g.capPct}%` }} />
        </>
      )}
    </div>
  )
}

// A plain percentage gauge (no overflow logic) for the acceptance / runway tiles.
function BarGauge({ pct, sev, sm }: { pct: number; sev: Sev; sm?: boolean }) {
  return (
    <div className="s09-meter" data-sm={sm ? 'true' : undefined} aria-hidden="true">
      <div
        className="s09-meter-fill"
        data-sev={sev}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  )
}

function OverPill({ used, cap }: { used: number; cap: number }) {
  if (cap <= 0 || used <= cap) return null
  return <span className="s09-sev" data-sev="amber"> {Math.round((used / cap) * 100)}% of cap</span>
}

/** One cell of the tile band: the tile, its severity pip, and its meter. */
function Tile({ sev, meter, children }: { sev: Sev; meter?: ReactNode; children: ReactNode }) {
  return (
    <div className="s09-tile">
      {children}
      <span className="s09-pip" data-sev={sev} aria-hidden="true" />
      {meter}
    </div>
  )
}

// ---- HERO: four decision tiles (Converting? Throttled? Runway? Refilling?) ----
function Hero({ accept, governor, pipeline, replacement, client }: {
  accept: AcceptRow[]; governor: GovernorRow[]; pipeline: PipelineRow[]
  replacement: ReplacementRow[]; client: Client
}) {
  // Q1 — Is outreach converting? Acceptance 7d vs 30d baseline. Neutral when the
  // 7d cohort is too thin to judge — never a false green/red.
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

  const trendDir: 'up' | 'down' | 'flat' = trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'
  const trendSev: Sev = trend >= 0 ? 'green' : trend >= -Math.max(3, r30 * 0.35) ? 'amber' : 'red'

  const acceptEmpty = aRows.length === 0
  const govEmpty = gRows.length === 0
  const runEmpty = pRows.length === 0
  const repEmpty = repRows.length === 0 || rate == null

  return (
    <Block label="Decision" tail="where do I stand right now">
      <div className="dirb-tiles">
        {/* Acceptance */}
        <Tile
          sev={aSev}
          meter={acceptEmpty ? null : <BarGauge pct={r7} sev={aSev === 'neutral' ? 'green' : aSev} sm />}
        >
          <StatTile
            label="Accept"
            emptyText="No data"
            value={acceptEmpty ? undefined : <Figure to={r7} i={0} unit="%" />}
            delta={acceptEmpty ? undefined : {
              dir: trendDir,
              text: <span className="s09-sev" data-sev={trendSev}>{Math.abs(trend)} {MID} 30d</span>,
            }}
            note={acceptEmpty ? undefined : `${acc7}/${sent7} ${MID} 7d`}
          />
        </Tile>
        {/* Governor */}
        <Tile
          sev={gSev}
          meter={govEmpty ? null : <Gauge used={gUsed} cap={gCap} sev={gMode.sev} sm />}
        >
          <StatTile
            label="Governor"
            emptyText="No data"
            value={govEmpty ? undefined : <Figure to={gUsed} i={1} unit={`/${gCap}`} />}
            note={govEmpty ? undefined : (
              <>
                <Badge tone={TONE[gMode.sev]}>{gMode.label}</Badge>
                {` ${MID} `}{gHeadDay} left today
                <OverPill used={gUsed} cap={gCap} />
              </>
            )}
          />
        </Tile>
        {/* Runway */}
        <Tile
          sev={rSev}
          meter={runEmpty ? null : (
            <BarGauge
              pct={runway >= 999 ? 100 : (runway / 14) * 100}
              sev={rSev === 'neutral' ? 'green' : rSev}
              sm
            />
          )}
        >
          <StatTile
            label="Runway"
            emptyText="No data"
            value={runEmpty ? undefined
              : runway >= 999 ? <span className="dirb-figure">{INF}</span>
              : <Figure to={runway} i={2} unit="d" />}
            note={runEmpty ? undefined : `${totalSendable} sendable`}
          />
        </Tile>
        {/* Refill — the flow tile. Runway says how long the tank lasts; this says
            whether the tap is on. */}
        <Tile
          sev={repSev}
          meter={repEmpty ? null : (
            // 1.0x sits at the half mark, so "is the bar past halfway" reads as
            // "is the pool growing" without needing the number.
            <BarGauge
              pct={Math.min(100, ((rate as number) / 2) * 100)}
              sev={repSev === 'neutral' ? 'green' : repSev}
              sm
            />
          )}
        >
          <StatTile
            label="Refill"
            emptyText="No data"
            value={repEmpty ? undefined : <Figure to={rate as number} i={3} decimals={2} unit="x" />}
            note={repEmpty ? undefined : (
              <>
                {qIn} in / {qOut} out {MID} 7d
                {empty != null && (
                  <span className="s09-sev" data-sev="red"> {MID} empty in {empty}d</span>
                )}
              </>
            )}
          />
        </Tile>
      </div>
    </Block>
  )
}

/** The funnel plot itself: same steps, same figures, token palette. */
function FunnelPlot({ steps, acceptStep }: {
  steps: { n: number; label: string }[]; acceptStep: string
}) {
  return (
    <div className="s09-funnel dirb-scroll-x">
      {steps.map((s, i) => (
        <div key={s.label} style={{ display: 'contents' }}>
          {i > 0 && (
            i === 1
              ? (
                <div className="s09-farrow">
                  <span className="ds-t-mono">{acceptStep}</span>
                  <span aria-hidden="true">{ARROW}</span>
                </div>
              )
              : (
                /* neutral separator — conversations are NOT a subset of accepts */
                <div className="s09-farrow" data-sep="true"><span aria-hidden="true">{MID}</span></div>
              )
          )}
          <div className="s09-fstep">
            <div className="ds-t-figure dirb-figure">{s.n}</div>
            <div className="ds-t-meta dirb-dim">{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- FUNNEL: Sent → Accepted · Conversations · Calls (7d) ----
// Only the Sent→Accepted step is a real subset conversion, so only it carries a
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

  const acceptStep = sent7 > 0 ? `${Math.round((acc7 / sent7) * 100)}%` : EMD

  if (aRows.length === 0 && sRows.length === 0 && oRows.length === 0) {
    return (
      <Block label="Funnel" tail="7d">
        <EmptyState icon="chart" ghosts title="No funnel data yet." />
      </Block>
    )
  }

  return (
    <Block label="Funnel" tail="last 7d">
      <Card>
        <FunnelPlot
          acceptStep={acceptStep}
          steps={[
            { n: sent7, label: 'Invites' },
            { n: acc7, label: 'Accepted' },
            { n: convos7, label: 'Convos' },
            { n: calls7, label: 'Calls' },
          ]}
        />
        <div className="dirb-col">
          <div className="ds-t-meta s09-caption">
            Era totals {MID} convos {convosTotal} {MID} calls {callsTotal} {MID} convos = replied at least once, optouts excluded.
          </div>
          <div className="ds-t-meta s09-caption">
            30d {MID} accepted {acc30}/{sent30} {MID} scan opens 7d {opens7} / 30d {opens30} {MID} {distinct} prospects{lastOpen ? ` ${MID} last ${ago(lastOpen)}` : ''}
          </div>
          <div className="ds-t-meta s09-caption">
            Ivan scope counts the warm-lane era only (since 07-11); Rise counts full history. Recent sends are still maturing {EMD} accept rate only rises.
          </div>
        </div>
      </Card>
    </Block>
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

type LedgerViewRow = LedgerDay & { key: string; label: string; today: boolean; total: boolean }

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
  const n = (v: number) => <span className="ds-t-mono" data-zero={v === 0 || undefined}>{v}</span>
  const pct = (acc: number, inv: number) => (inv > 0 ? ` ${Math.round((acc / inv) * 100)}%` : '')

  const viewRows: LedgerViewRow[] = [
    ...led.map(d => ({
      ...d,
      key: d.day,
      label: ledgerDayLabel(d.day, todayIso),
      today: d.day === todayIso,
      total: false,
    })),
    {
      day: '', invites: tot.invites, accepted: tot.accepted, dms: tot.dms, inmails: tot.inmails,
      cap_used: null, cap_limit: null, burned: tot.burned,
      key: 'total', label: `${days}d`, today: false, total: true,
    },
  ]

  return (
    <Block label="Daily" tail={`last ${days} days ${MID} UTC`}>
      <Card className="s09-ledger">
        <Table<LedgerViewRow>
          label={`Sends per day, last ${days} days`}
          rows={viewRows}
          rowKey={r => r.key}
          isSelected={r => r.today}
          columns={[
            { id: 'day', header: 'Day', cell: r => <span className="ds-t-mono">{r.label}</span> },
            { id: 'invites', header: 'Invites', numeric: true, cell: r => n(r.invites) },
            {
              id: 'accepted', header: 'Accepted', numeric: true,
              cell: r => (
                <span className="ds-t-mono" data-zero={!r.total && r.accepted === 0 || undefined}>
                  {r.accepted}<span className="s09-sub">{pct(r.accepted, r.invites)}</span>
                </span>
              ),
            },
            { id: 'dms', header: 'DMs', numeric: true, cell: r => n(r.dms) },
            { id: 'inmails', header: 'InMail', numeric: true, cell: r => n(r.inmails) },
            {
              id: 'cap', header: 'Cap', numeric: true,
              cell: r => (
                <span className="ds-t-mono" data-burn={r.burned > 0 || undefined}>
                  {r.total
                    ? (r.burned > 0 ? <span className="s09-sub">{MINUS}{r.burned} burned</span> : EMD)
                    : (
                      <>
                        {r.cap_used == null ? EMD : `${r.cap_used}/${r.cap_limit ?? '?'}`}
                        {r.burned > 0 && <span className="s09-sub">{MINUS}{r.burned} burned</span>}
                      </>
                    )}
                </span>
              ),
            },
          ]}
        />
        <div className="ds-t-meta s09-caption">
          Invites = notes that left the seat. Cap = the seat&apos;s counter, spent before the provider answers; when it runs ahead of Invites those slots went to refused sends. Accepted is of that day&apos;s invites and only rises.
        </div>
      </Card>
    </Block>
  )
}

// ---- Range summary (custom date selector) ----
// Explicit-range KPIs from the range RPC — no era cutoff, the picked dates are
// the scope. Daily sparkline data only reaches 90d back, but this call counts
// from the raw tables, so any range works.
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
  const pct = sent > 0 ? `${Math.round((accepted / sent) * 100)}%` : EMD

  return (
    <Block label="Range" tail={`${shortDate(range.from)} ${ARROW} ${shortDate(range.to)}`}>
      {error ? (
        <Banner tone="urgent" icon="error" title={error} />
      ) : rows === null ? (
        <SkeletonRows rows={2} label={`Loading${ELL}`} />
      ) : (
        <Card>
          <FunnelPlot
            acceptStep={pct}
            steps={[
              { n: sent, label: 'Invites' },
              { n: accepted, label: 'Accepted' },
              { n: convos, label: 'Convos' },
              { n: calls, label: 'Calls' },
            ]}
          />
          <div className="ds-t-meta s09-caption">Exact range, no era cutoff {EMD} accepts counted on the notes sent inside it.</div>
        </Card>
      )}
    </Block>
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
  return (
    <Block
      label="Volume"
      tail={timeframe === 'custom' && range ? `${shortDate(range.from)}${ARROW}${shortDate(range.to)}` : timeframe}
    >
      <div className="dirb-cards">
        {lanes.map(lane => {
          // A lane that has sent inside the last 24h is WORKING: the wash sweeps
          // under its state label and settles flat the moment it stops.
          const live = lane.sent_24h > 0
          return (
            <Card key={lane.key} className="dirb-lift">
              <div className="dirb-spread">
                <span className="ds-t-title dirb-truncate">{lane.label}</span>
                <span className="s09-nums">
                  <span className="ds-t-figure dirb-figure">
                    {laneCount(lane, daily, client, timeframe, range)}
                  </span>
                </span>
              </div>
              <div className="dirb-spread">
                <span className="dirb-working ds-t-mono dirb-dim" data-live={live ? 'true' : 'false'}>
                  24h: {lane.sent_24h}
                </span>
                <Spark values={lane.daily} />
              </div>
            </Card>
          )
        })}
      </div>
      {/* M4 — legend + right-aligned Total. Every figure is a sum over the SAME
          already-fetched aggregate rows the cards above are drawn from, so the
          footer and the plot can never disagree, and nothing here is a
          rows.length of a capped page. The swatches are gone: a channel is a
          CATEGORY, and a category is never a colour. */}
      <div className="s09-legend ds-t-meta">
        {lanes.map(lane => (
          <span className="s09-legend-item" key={lane.key}>{lane.label}</span>
        ))}
        <span className="s09-total">
          Total: <b className="ds-t-mono">{lanes.reduce((s, l) => s + laneCount(l, daily, client, timeframe, range), 0)}</b>
        </span>
      </div>
    </Block>
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
    <Card
      title={TITLE(g.client_id)}
      lead={<span className="s09-pip" data-sev={sev} style={{ position: 'static' }} aria-hidden="true" />}
      tail={<Badge tone={TONE[m.sev]}>{m.label}</Badge>}
    >
      <Gauge used={g.used} cap={g.cap} sev={m.sev} />
      <div className="ds-t-meta">
        <b className="ds-t-mono">{g.used}</b>/{g.cap} <span className="dirb-dim">{windowWord(g.window_label)}</span>
        <OverPill used={g.used} cap={g.cap} />
      </div>
      <div className="ds-t-meta s09-caption">cap {g.cap} {MID} {cohortStr}</div>
      {gated && (
        <div className="ds-t-meta s09-caption">governor counter {g.gov_used}/{g.gov_cap} (shared) {EMD} cold sends gated</div>
      )}
      {g.daily_cap > 0 && (
        <div className="dirb-col">
          <Gauge used={g.daily_used} cap={g.daily_cap} sev={m.sev} sm />
          <div className="ds-t-meta s09-caption"><b className="ds-t-mono">{g.daily_used}</b>/{g.daily_cap} today</div>
        </div>
      )}
      <div className="ds-t-meta s09-caption">
        {g.window_label === 'day'
          ? `${g.headroom_day} left today`
          : `${g.headroom_week} left this ${g.window_label} ${MID} ${g.headroom_day} left today`}
      </div>
      {g.monthly_cap != null && (
        <div className="ds-t-meta s09-caption">{g.monthly_used}/{g.monthly_cap} this month</div>
      )}
    </Card>
  )
}

function Governor({ rows, client }: { rows: GovernorRow[]; client: Client }) {
  const targets: string[] = client === 'all' ? ['ivan', 'risedtc', 'arch'] : [client]
  const cards = targets
    .map(t => rows.find(r => r.client_id === t))
    .filter((g): g is GovernorRow => Boolean(g))

  return (
    <Block label="Governor detail">
      {cards.length === 0 ? (
        <EmptyState icon="guard" ghosts title="No governor data." />
      ) : (
        <div className="dirb-cards">
          {cards.map(g => <GovGauge key={g.client_id} g={g} />)}
        </div>
      )}
    </Block>
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
  const runwayLbl = p.runway >= 999 ? INF : `${p.runway}d`
  const cohort = g == null || g.accept_rate == null ? EMD : `${g.accept_rate}%`
  // Reply rate of people who accepted AND got DM1 — the only denominator where a
  // reply was ever possible. 30d, because the 7d cohort is still being answered.
  const replyStr = p.reply == null || p.reply.rate_30d == null ? EMD : `${p.reply.rate_30d}%`
  const replySub = p.reply == null ? '' : `${p.reply.replied_30d}/${p.reply.dmd_30d}`
  return (
    <Card
      className="dirb-lift"
      title={TITLE(p.id)}
      tail={m ? <Badge tone={TONE[m.sev]}>{m.label}</Badge> : undefined}
      selected={selected && !neutral}
      onClick={onSelect}
    >
      {g ? (
        <>
          <Gauge used={g.used} cap={g.cap} sev={m!.sev} sm />
          {/* Ivan 2026-09-04: the three seats do NOT share a window. Ivan and RISE run a
              weekly governor (x/280); arch runs a daily ramp (x/40). Side by side with no
              label, arch read like a nearly-empty week when it was a half-spent day. The
              window is stated instead of normalised: multiplying arch's cap by seven would
              invent a weekly ceiling nothing actually enforces. */}
          <div className="ds-t-meta">
            <b className="ds-t-mono">{g.used}</b>/{g.cap} <span className="dirb-dim">{windowWord(g.window_label)}</span><OverPill used={g.used} cap={g.cap} />
          </div>
        </>
      ) : (
        <div className="ds-t-meta dirb-dim">no governor</div>
      )}
      {/* Ivan 2026-08-24: from the seat's numbers straight to the rules that
          produced them. The filters are what make these figures what they are,
          and having to go hunting for them is how a spec stops being read.
          stopPropagation because the whole card is a seat selector.

          WORKBENCH ONLY. This card is SHARED with #exp/stock, which has no
          Strategy tab and none of the .wb styling, so in the escape hatch this
          would be an unstyled link to a dead route. Stock must not move. */}
      {getExpVariant() !== 'stock' && (
        <a
          className="s09-link ds-t-meta" href="#exp/v2c/strategy"
          onClick={e => e.stopPropagation()}
        >
          What we filter on {ARROW}
        </a>
      )}
      <div className="s09-stats ds-t-meta">
        <div className="s09-stat"><span>Cohort accept</span><b className="ds-t-mono">{cohort}</b></div>
        <div className="s09-stat"><span>Reply 30d</span><b className="ds-t-mono">{replyStr}</b><span className="dirb-dim ds-t-mono">{replySub}</span></div>
        <div className="s09-stat"><span>Pipeline</span><b className="ds-t-mono">{p.sendable}</b><span className="dirb-dim ds-t-mono">{runwayLbl}</span></div>
        <div className="s09-stat"><span>24h vol</span><b className="ds-t-mono">{p.vol24}</b></div>
      </div>
    </Card>
  )
}

function Seats({ data, client, setClient }: {
  data: OverviewData; client: Client; setClient?: (c: Client) => void
}) {
  const people = [personSummary(data, 'ivan'), personSummary(data, 'risedtc'), personSummary(data, 'arch')]
  const neutral = client === 'all'
  return (
    <Block label="Seats" tail="both counters, one glance">
      <div className="dirb-cards">
        {people.map(p => (
          <SeatCard
            key={p.id}
            p={p}
            selected={client === p.id}
            neutral={neutral}
            onSelect={setClient && client !== p.id ? () => setClient(p.id as Client) : undefined}
          />
        ))}
      </div>
    </Block>
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
    <Block label="Pipeline" tail={overallRunway >= 999 ? `runway ${INF}` : `${overallRunway}d runway`}>
      {lanes.length === 0 ? (
        <EmptyState icon="layers" ghosts title="No pipeline data." />
      ) : (
        <Card>
          {lanes.map(([lane, e]) => {
            const laneRunway = dailyRate > 0 ? Math.floor(e.sendable / dailyRate) : 999
            const sev: Sev = laneRunway < 2 ? 'red' : laneRunway < 5 ? 'amber' : 'green'
            return (
              <div key={lane} className="s09-pl">
                <div className="dirb-spread">
                  <span className="ds-t-title dirb-truncate">{laneLabel(lane)}</span>
                  <span className="ds-t-mono">{e.sendable}</span>
                </div>
                <div className="s09-meter" aria-hidden="true">
                  <div
                    className="s09-meter-fill" data-sev={sev}
                    style={{ width: `${Math.round((e.sendable / maxSendable) * 100)}%` }}
                  />
                </div>
                <div className="ds-t-meta s09-caption">sent {MID} 7d {e.sent7} {MID} 30d {e.sent30}</div>
              </div>
            )
          })}
          {/* M4 — the pipeline's own legend + Total. The three legend entries
              are the runway thresholds the bar fills already encode (M14), so
              the footer names the encoding rather than repeating the numbers.
              These marks stay coloured: they are a SEVERITY key, not a
              category key. */}
          <div className="s09-legend ds-t-meta">
            <span className="s09-legend-item">
              <span className="s09-legend-dot" data-sev="green" />5d+
            </span>
            <span className="s09-legend-item">
              <span className="s09-legend-dot" data-sev="amber" />2-5d
            </span>
            <span className="s09-legend-item">
              <span className="s09-legend-dot" data-sev="red" />under 2d
            </span>
            <span className="s09-total">Total: <b className="ds-t-mono">{totalSendable}</b> sendable</span>
          </div>
        </Card>
      )}
    </Block>
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

  return (
    <Block label="Campaigns">
      {rows.length === 0 ? (
        <EmptyState icon="list" ghosts title="No campaigns." />
      ) : (
        <Card>
          <Table<CampaignSend>
            label="Campaigns and what they sent"
            rows={tableRows}
            rowKey={c => c.campaign_id}
            columns={[
              { id: 'name', header: 'Campaign', cell: c => <span className="dirb-truncate">{c.campaign_name}</span> },
              {
                id: 'state', header: 'State',
                cell: c => <Badge tone={c.is_active ? 'clear' : 'neutral'}>{c.is_active ? 'ACTIVE' : 'PAUSED'}</Badge>,
              },
              {
                id: 'd7', header: '7d', numeric: true,
                cell: c => (c.sent_7d != null ? <span className="ds-t-mono">7d {c.sent_7d}</span> : null),
              },
              { id: 'sent', header: 'Sent', numeric: true, cell: c => <span className="ds-t-mono">{c.sent}</span> },
            ]}
          />
          {hidden.length > 0 && (
            <Button variant="quiet" size="sm" onClick={() => setShowPaused(v => !v)}>
              {showPaused ? MINUS : '+'} {hidden.length} paused, 0 sent
            </Button>
          )}
          {/* M4 — the table's Total is the sum of the rows it is SHOWING, and
              it says so: `visible` is the scoped set, `shown` is what rendered.
              The campaign feed is a server-side aggregate, so these are full
              counts, not a page. */}
          <div className="s09-legend ds-t-meta">
            <span className="s09-legend-item">
              {shown.length} of {visible.length} campaigns shown
            </span>
            <span className="s09-total">
              Total: <b className="ds-t-mono">{shown.reduce((s, c) => s + c.sent, 0).toLocaleString()}</b> sent
            </span>
          </div>
        </Card>
      )}
    </Block>
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

  if (loading && !data) return <Surface><SkeletonRows rows={4} label={`Loading${ELL}`} /></Surface>
  if (error) return <Surface><Banner tone="urgent" icon="error" title={error} /></Surface>
  if (!data) {
    return (
      <Surface>
        <EmptyState icon="chart" ghosts title={`No data yet ${EMD} the call returned, it just had nothing in it.`} />
      </Surface>
    )
  }

  const lanes = buildLanes(data.rows, data.daily, client)

  return (
    <Surface>
      <Hero accept={data.accept} governor={data.governor} pipeline={data.pipeline} replacement={data.replacement} client={client} />
      {timeframe === 'custom' && range && <RangeSummary range={range} client={client} />}
      <DayLedger rows={data.ledger} client={client} timeframe={timeframe} />
      <Funnel accept={data.accept} scans={data.scans} outcomes={data.outcomes} client={client} />
      <div className="s09-duo">
        <KpiRow lanes={lanes} daily={data.daily} client={client} timeframe={timeframe} range={range} />
        <Pipeline rows={data.pipeline} governor={data.governor} client={client} />
      </div>
      <div className="s09-duo">
        <Governor rows={data.governor} client={client} />
        <div className="s09-col">
          <Seats data={data} client={client} setClient={setClient} />
          <Campaigns rows={data.campaigns} client={client} />
        </div>
      </div>
    </Surface>
  )
}
