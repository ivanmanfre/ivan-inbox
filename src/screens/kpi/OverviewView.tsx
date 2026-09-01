import { useEffect, useState } from 'react'
import {
  buildLanes, fetchSends, fetchSendsDaily, fetchCampaignSends,
  type Lane, type DailyRow, type CampaignSend,
} from '../../lib/sends'
import { getExpVariant } from '../../exp'
import {
  fetchAccept, fetchReply, fetchPipeline, fetchGovernor, fetchScanOpens, fetchOutcomes, fetchRangeKpis,
  fetchReplacement, replacementRate, daysToEmpty, fetchDayLedger, buildLedger,
  acceptRate, runwayDays, laneLabel, governorEnforcementGap,
  type AcceptRow, type ReplyRow, type PipelineRow, type GovernorRow, type ScanOpenRow, type OutcomeRow, type RangeKpiRow,
  type ReplacementRow, type LedgerRow,
} from '../../lib/kpis'

type Client = 'all' | 'ivan' | 'risedtc' | 'arch'
type Timeframe = '7d' | '30d' | 'custom'
type DateRange = { from: string; to: string }

// Dot / accent colors mirror SendsScreen so the two views read as one system.
const STATUS = { live: '#10A37F', slowing: '#FF9F0A', stale: '#FF453A' }
type Sev = 'green' | 'amber' | 'red' | 'neutral'
const SEV_COLOR: Record<Sev, string> = {
  green: STATUS.live, amber: STATUS.slowing, red: STATUS.stale, neutral: '#8E8E93',
}
const LANE_DOT: Record<string, string> = {
  connection_note: '#0A84FF', dm: '#10A37F', inmail: '#BF5AF2', email: '#FF9F0A',
}
const MODE: Record<GovernorRow['mode'], { label: string; color: string; sev: Sev }> = {
  normal: { label: 'NORMAL', color: '#10A37F', sev: 'green' },
  warm_only: { label: 'WARM-ONLY', color: '#FF9F0A', sev: 'amber' },
  cold_paused: { label: 'COLD-PAUSED', color: '#FF453A', sev: 'red' },
}
const MODE_RANK: Record<GovernorRow['mode'], number> = { normal: 0, warm_only: 1, cold_paused: 2 }

// A seat sitting AT its cap is not "NORMAL", whatever its adaptive mode says: the
// sender is refusing every pick until the window rolls. Badge says so (Ivan
// 2026-09-01, Arch read "NORMAL · 35/35 · 0 left today").
const CAP_HIT = { label: 'CAP REACHED', color: '#FF9F0A' }
function modeBadge(g: GovernorRow | null, used: number, cap: number): { label: string; color: string } {
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

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  // The peak mark: the max-value bar carries a `peak` class hook. The default
  // app has no rule for it (zero visual change here); the workbench paints it
  // with the card's own category colour — the reference never shows an
  // all-white bar run (phase-2 review, licensed taste move).
  const peakAt = values.some(v => v > 0) ? values.indexOf(max) : -1
  return (
    <div className="sc-spark">
      {values.map((v, i) => (
        <div
          key={i}
          className={`sc-bar ${v === 0 ? 'zero' : ''}${i === peakAt ? ' peak' : ''}`}
          style={{ height: `${Math.round((v / max) * 100)}%` }}
        />
      ))}
    </div>
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

function Gauge({ used, cap, color, sm }: { used: number; cap: number; color: string; sm?: boolean }) {
  const g = gaugeGeom(used, cap)
  return (
    <div className={`ov-gauge ${sm ? 'sm' : ''} ${g.overflow ? 'over' : ''}`}>
      <div className="ov-gauge-fill" style={{ width: `${g.fillPct}%`, background: color }} />
      {g.overflow && (
        <>
          <div className="ov-gauge-over" style={{ left: `${g.capPct}%` }} />
          <div className="ov-gauge-tick" style={{ left: `${g.capPct}%` }} />
        </>
      )}
    </div>
  )
}

// A plain percentage gauge (no overflow logic) for the acceptance / runway tiles.
function BarGauge({ pct, color, sm }: { pct: number; color: string; sm?: boolean }) {
  return (
    <div className={`ov-gauge ${sm ? 'sm' : ''}`}>
      <div className="ov-gauge-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  )
}

function OverPill({ used, cap }: { used: number; cap: number }) {
  if (cap <= 0 || used <= cap) return null
  return <span className="ov-over-lbl">{Math.round((used / cap) * 100)}% of cap</span>
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

  const trendArrow = trend > 0 ? '▲' : trend < 0 ? '▼' : '±'
  const trendSev: Sev = trend >= 0 ? 'green' : trend >= -Math.max(3, r30 * 0.35) ? 'amber' : 'red'

  return (
    <section className="ov-sec">
      <div className="ov-h">Decision<span className="ov-h-sub">where do I stand right now</span></div>
      <div className="ov-hero">
        {/* Acceptance */}
        <div className="ov-tile">
          <div className="ov-tile-h">
            <span className="ov-tile-lbl">Accept</span>
            <span className="sc-dot" style={{ background: SEV_COLOR[aSev] }} />
          </div>
          {aRows.length === 0 ? (
            <div className="ov-tile-empty">No data</div>
          ) : (
            <>
              <div className="ov-tile-big">{r7}<span className="ov-tile-unit">%</span></div>
              <BarGauge pct={r7} color={SEV_COLOR[aSev === 'neutral' ? 'green' : aSev]} sm />
              <div className="ov-tile-sub">
                {acc7}/{sent7} · 7d
                <span className="ov-tile-trend" style={{ color: SEV_COLOR[trendSev] }}> {trendArrow}{Math.abs(trend)} · 30d</span>
              </div>
            </>
          )}
        </div>
        {/* Governor */}
        <div className="ov-tile">
          <div className="ov-tile-h">
            <span className="ov-tile-lbl">Governor</span>
            <span className="sc-dot" style={{ background: SEV_COLOR[gSev] }} />
          </div>
          {gRows.length === 0 ? (
            <div className="ov-tile-empty">No data</div>
          ) : (
            <>
              <div className="ov-tile-big">{gUsed}<span className="ov-tile-unit">/{gCap}</span></div>
              <Gauge used={gUsed} cap={gCap} color={gMode.color} sm />
              <div className="ov-tile-sub">
                <span className="ov-tile-trend" style={{ color: gMode.color }}>{gMode.label}</span>
                {' · '}{gHeadDay} left today
                <OverPill used={gUsed} cap={gCap} />
              </div>
            </>
          )}
        </div>
        {/* Runway */}
        <div className="ov-tile">
          <div className="ov-tile-h">
            <span className="ov-tile-lbl">Runway</span>
            <span className="sc-dot" style={{ background: SEV_COLOR[rSev] }} />
          </div>
          {pRows.length === 0 ? (
            <div className="ov-tile-empty">No data</div>
          ) : (
            <>
              <div className="ov-tile-big">{runway >= 999 ? '∞' : runway}<span className="ov-tile-unit">{runway >= 999 ? '' : 'd'}</span></div>
              <BarGauge pct={runway >= 999 ? 100 : (runway / 14) * 100} color={SEV_COLOR[rSev === 'neutral' ? 'green' : rSev]} sm />
              <div className="ov-tile-sub">{totalSendable} sendable</div>
            </>
          )}
        </div>
        {/* Refill — the flow tile. Runway says how long the tank lasts; this says
            whether the tap is on. */}
        <div className="ov-tile">
          <div className="ov-tile-h">
            <span className="ov-tile-lbl">Refill</span>
            <span className="sc-dot" style={{ background: SEV_COLOR[repSev] }} />
          </div>
          {repRows.length === 0 || rate == null ? (
            <div className="ov-tile-empty">No data</div>
          ) : (
            <>
              <div className="ov-tile-big">{rate.toFixed(2)}<span className="ov-tile-unit">x</span></div>
              {/* 1.0x sits at the half mark, so "is the bar past halfway" reads as
                  "is the pool growing" without needing the number. */}
              <BarGauge pct={Math.min(100, (rate / 2) * 100)} color={SEV_COLOR[repSev === 'neutral' ? 'green' : repSev]} sm />
              <div className="ov-tile-sub">
                {qIn} in / {qOut} out · 7d
                {empty != null && (
                  <span className="ov-tile-trend" style={{ color: SEV_COLOR.red }}> · empty in {empty}d</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
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

  const acceptStep = sent7 > 0 ? `${Math.round((acc7 / sent7) * 100)}%` : '—'

  if (aRows.length === 0 && sRows.length === 0 && oRows.length === 0) {
    return (
      <section className="ov-sec">
        <div className="ov-h">Funnel<span className="ov-h-sub">7d</span></div>
        <div className="ov-empty">No funnel data yet.</div>
      </section>
    )
  }

  return (
    <section className="ov-sec">
      <div className="ov-h">Funnel<span className="ov-h-sub">last 7d</span></div>
      <div className="ov-funnel">
        <div className="ov-fstep">
          <div className="ov-fn">{sent7}</div>
          <div className="ov-fl">Invites</div>
        </div>
        <div className="ov-farrow">
          <span className="ov-fpct">{acceptStep}</span>
          <span className="ov-fchev">→</span>
        </div>
        <div className="ov-fstep">
          <div className="ov-fn">{acc7}</div>
          <div className="ov-fl">Accepted</div>
        </div>
        {/* neutral separator — conversations are NOT a subset of accepts */}
        <div className="ov-farrow ov-fsep"><span className="ov-fdot">·</span></div>
        <div className="ov-fstep">
          <div className="ov-fn">{convos7}</div>
          <div className="ov-fl">Convos</div>
        </div>
        <div className="ov-farrow ov-fsep"><span className="ov-fdot">·</span></div>
        <div className="ov-fstep">
          <div className="ov-fn">{calls7}</div>
          <div className="ov-fl">Calls</div>
        </div>
      </div>
      <div className="ov-fcap">
        Era totals · convos {convosTotal} · calls {callsTotal} · convos = replied at least once, optouts excluded.
      </div>
      <div className="ov-fcap">
        30d · accepted {acc30}/{sent30} · scan opens 7d {opens7} / 30d {opens30} · {distinct} prospects{lastOpen ? ` · last ${ago(lastOpen)}` : ''}
      </div>
      <div className="ov-note">Ivan scope counts the warm-lane era only (since 07-11); Rise counts full history. Recent sends are still maturing — accept rate only rises.</div>
    </section>
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
  const n = (v: number) => <span className={`ov-lg-n${v === 0 ? ' zero' : ''}`}>{v}</span>
  const pct = (acc: number, inv: number) => (inv > 0 ? ` ${Math.round((acc / inv) * 100)}%` : '')
  return (
    <section className="ov-sec">
      <div className="ov-h">Daily<span className="ov-h-sub">last {days} days · UTC</span></div>
      <div className="ov-ledger">
        <div className="ov-lg-r ov-lg-h">
          <span>Day</span><span>Invites</span><span>Accepted</span><span>DMs</span><span>InMail</span><span>Cap</span>
        </div>
        {led.map(d => (
          <div key={d.day} className={`ov-lg-r${d.day === todayIso ? ' today' : ''}`}>
            <span className="ov-lg-d">{ledgerDayLabel(d.day, todayIso)}</span>
            {n(d.invites)}
            <span className={`ov-lg-n${d.accepted === 0 ? ' zero' : ''}`}>{d.accepted}<i>{pct(d.accepted, d.invites)}</i></span>
            {n(d.dms)}
            {n(d.inmails)}
            <span className={`ov-lg-n ov-lg-cap${d.burned > 0 ? ' burn' : ''}`}>
              {d.cap_used == null ? '—' : `${d.cap_used}/${d.cap_limit ?? '?'}`}
              {d.burned > 0 && <i>−{d.burned} burned</i>}
            </span>
          </div>
        ))}
        <div className="ov-lg-r ov-lg-t">
          <span className="ov-lg-d">{days}d</span>
          {n(tot.invites)}
          <span className="ov-lg-n">{tot.accepted}<i>{pct(tot.accepted, tot.invites)}</i></span>
          {n(tot.dms)}
          {n(tot.inmails)}
          <span className={`ov-lg-n ov-lg-cap${tot.burned > 0 ? ' burn' : ''}`}>
            {tot.burned > 0 ? <i>−{tot.burned} burned</i> : '—'}
          </span>
        </div>
      </div>
      <div className="ov-fcap">
        Invites = notes that left the seat. Cap = the seat's counter, spent before the provider answers; when it runs ahead of Invites those slots went to refused sends. Accepted is of that day's invites and only rises.
      </div>
    </section>
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
    <section className="ov-sec">
      <div className="ov-h">Range<span className="ov-h-sub">{shortDate(range.from)} → {shortDate(range.to)}</span></div>
      {error ? (
        <div className="ov-empty">{error}</div>
      ) : rows === null ? (
        <div className="ov-empty">Loading…</div>
      ) : (
        <>
          <div className="ov-funnel">
            <div className="ov-fstep"><div className="ov-fn">{sent}</div><div className="ov-fl">Invites</div></div>
            <div className="ov-farrow"><span className="ov-fpct">{pct}</span><span className="ov-fchev">→</span></div>
            <div className="ov-fstep"><div className="ov-fn">{accepted}</div><div className="ov-fl">Accepted</div></div>
            <div className="ov-farrow ov-fsep"><span className="ov-fdot">·</span></div>
            <div className="ov-fstep"><div className="ov-fn">{convos}</div><div className="ov-fl">Convos</div></div>
            <div className="ov-farrow ov-fsep"><span className="ov-fdot">·</span></div>
            <div className="ov-fstep"><div className="ov-fn">{calls}</div><div className="ov-fl">Calls</div></div>
          </div>
          <div className="ov-fcap">Exact range, no era cutoff — accepts counted on the notes sent inside it.</div>
        </>
      )}
    </section>
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
    <section className="ov-sec">
      <div className="ov-h">Volume<span className="ov-h-sub">{timeframe === 'custom' && range ? `${shortDate(range.from)}→${shortDate(range.to)}` : timeframe}</span></div>
      <div className="ov-kpis">
        {lanes.map((lane, i) => (
          <div key={lane.key} className="ov-kpi" data-cat={String((i % 4) + 1)}>
            <div className="ov-kpi-top">
              <span className="sc-dot" style={{ background: LANE_DOT[lane.key] }} />
              <span className="ov-kpi-nm">{lane.label}</span>
            </div>
            <div className="ov-kpi-big">{laneCount(lane, daily, client, timeframe, range)}</div>
            <div className="ov-kpi-24">24h: {lane.sent_24h}</div>
            <Spark values={lane.daily} />
          </div>
        ))}
      </div>
      {/* M4 — legend + right-aligned Total. Every figure is a sum over the SAME
          already-fetched aggregate rows the cards above are drawn from
          (inbox_sends_daily_v / the sends view), so the footer and the plot can
          never disagree, and nothing here is a rows.length of a capped page. */}
      <div className="wb-cardf">
        {lanes.map((lane, i) => (
          <span className="wb-legend" key={lane.key}>
            <span className="wb-legend-d" data-cat={String((i % 4) + 1)} />
            <span className="wb-legend-l">{lane.label}</span>
          </span>
        ))}
        <span className="wb-total">
          Total: <b>{lanes.reduce((s, l) => s + laneCount(l, daily, client, timeframe, range), 0)}</b>
        </span>
      </div>
    </section>
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
    <div className="ov-gov">
      <div className="ov-gov-h">
        <span className="sc-dot" style={{ background: SEV_COLOR[sev] }} />
        <span className="ov-gov-nm">{TITLE(g.client_id)}</span>
        <span className="ov-badge" style={{ background: `${m.color}22`, color: m.color }}>{m.label}</span>
      </div>
      <Gauge used={g.used} cap={g.cap} color={m.color} />
      <div className="ov-gauge-lbl">
        <b>{g.used}</b>/{g.cap} <span className="ov-cap">{windowWord(g.window_label)}</span>
        <OverPill used={g.used} cap={g.cap} />
      </div>
      <div className="ov-cap">cap {g.cap} · {cohortStr}</div>
      {gated && (
        <div className="ov-note">governor counter {g.gov_used}/{g.gov_cap} (shared) — cold sends gated</div>
      )}
      {g.daily_cap > 0 && (
        <div className="ov-brake">
          <Gauge used={g.daily_used} cap={g.daily_cap} color={m.color} sm />
          <div className="ov-cap"><b>{g.daily_used}</b>/{g.daily_cap} today</div>
        </div>
      )}
      <div className="ov-cap">
        {g.window_label === 'day'
          ? `${g.headroom_day} left today`
          : `${g.headroom_week} left this ${g.window_label} · ${g.headroom_day} left today`}
      </div>
      {g.monthly_cap != null && (
        <div className="ov-cap">{g.monthly_used}/{g.monthly_cap} this month</div>
      )}
    </div>
  )
}

function Governor({ rows, client }: { rows: GovernorRow[]; client: Client }) {
  const targets: string[] = client === 'all' ? ['ivan', 'risedtc', 'arch'] : [client]
  const cards = targets
    .map(t => rows.find(r => r.client_id === t))
    .filter((g): g is GovernorRow => Boolean(g))

  return (
    <section className="ov-sec">
      <div className="ov-h">Governor detail</div>
      {cards.length === 0 ? (
        <div className="ov-empty">No governor data.</div>
      ) : (
        <div className="ov-govs">
          {cards.map(g => <GovGauge key={g.client_id} g={g} />)}
        </div>
      )}
    </section>
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
    <div
      className={`ov-rc ${selected && !neutral ? 'on' : ''} ${onSelect ? 'tap' : ''}`}
      onClick={onSelect}
    >
      <div className="ov-rc-h">
        <span className="ov-rc-nm">{TITLE(p.id)}</span>
        {m && <span className="ov-rc-badge" style={{ background: `${m.color}22`, color: m.color }}>{m.label}</span>}
      </div>
      {g ? (
        <>
          <Gauge used={g.used} cap={g.cap} color={m!.color} sm />
          <div className="ov-rc-gov">
            <b>{g.used}</b>/{g.cap}<OverPill used={g.used} cap={g.cap} />
          </div>
        </>
      ) : (
        <div className="ov-rc-gov ov-rc-dim">no governor</div>
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
          className="ov-rc-filters" href="#exp/v2c/strategy"
          onClick={e => e.stopPropagation()}
        >
          What we filter on →
        </a>
      )}
      <div className="ov-rc-stats">
        <div className="ov-rc-stat"><span>Cohort accept</span><b>{cohort}</b></div>
        <div className="ov-rc-stat"><span>Reply 30d</span><b>{replyStr}</b><i>{replySub}</i></div>
        <div className="ov-rc-stat"><span>Pipeline</span><b>{p.sendable}</b><i>{runwayLbl}</i></div>
        <div className="ov-rc-stat"><span>24h vol</span><b>{p.vol24}</b></div>
      </div>
    </div>
  )
}

function Seats({ data, client, setClient }: {
  data: OverviewData; client: Client; setClient?: (c: Client) => void
}) {
  const people = [personSummary(data, 'ivan'), personSummary(data, 'risedtc'), personSummary(data, 'arch')]
  const neutral = client === 'all'
  return (
    <section className="ov-sec">
      <div className="ov-h">Seats<span className="ov-h-sub">both counters, one glance</span></div>
      <div className="ov-seats">
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
    </section>
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
    <section className="ov-sec">
      <div className="ov-h">Pipeline<span className="ov-h-sub">{overallRunway >= 999 ? 'runway ∞' : `${overallRunway}d runway`}</span></div>
      {lanes.length === 0 ? (
        <div className="ov-empty">No pipeline data.</div>
      ) : (
        <div className="ov-pipe">
          {lanes.map(([lane, e]) => {
            const laneRunway = dailyRate > 0 ? Math.floor(e.sendable / dailyRate) : 999
            const color = laneRunway < 2 ? STATUS.stale : laneRunway < 5 ? STATUS.slowing : STATUS.live
            return (
              <div key={lane} className="ov-pl">
                <div className="ov-pl-top">
                  <span className="sc-dot" style={{ background: color }} />
                  <span className="ov-pl-nm">{laneLabel(lane)}</span>
                  <span className="ov-pl-n">{e.sendable}</span>
                </div>
                <div className="ov-bar"><div className="ov-bar-fill" style={{ width: `${Math.round((e.sendable / maxSendable) * 100)}%`, background: color }} /></div>
                <div className="ov-cap">sent · 7d {e.sent7} · 30d {e.sent30}</div>
              </div>
            )
          })}
          {/* M4 — the pipeline's own legend + Total. The three legend entries
              are the runway thresholds the bar fills already encode (M14), so
              the footer names the encoding rather than repeating the numbers. */}
          <div className="wb-cardf">
            <span className="wb-legend">
              <span className="wb-legend-d" style={{ background: STATUS.live }} />
              <span className="wb-legend-l">5d+</span>
            </span>
            <span className="wb-legend">
              <span className="wb-legend-d" style={{ background: STATUS.slowing }} />
              <span className="wb-legend-l">2-5d</span>
            </span>
            <span className="wb-legend">
              <span className="wb-legend-d" style={{ background: STATUS.stale }} />
              <span className="wb-legend-l">under 2d</span>
            </span>
            <span className="wb-total">Total: <b>{totalSendable}</b> sendable</span>
          </div>
        </div>
      )}
    </section>
  )
}

// ---- Campaigns ----
// Zero-send PAUSED campaigns are collapsed behind an expander by default so the
// active / sending campaigns aren't buried under a wall of "PAUSED 0" rows.
function CampaignRow({ c }: { c: CampaignSend }) {
  return (
    <div className="ov-tr">
      <span className="ov-td-nm">{c.campaign_name}</span>
      <span
        className="ov-badge"
        style={c.is_active
          ? { background: '#10A37F22', color: '#10A37F' }
          : { background: 'rgba(142,142,147,.18)', color: '#8E8E93' }}
      >
        {c.is_active ? 'ACTIVE' : 'PAUSED'}
      </span>
      {c.sent_7d != null && <span className="ov-td-sub">7d {c.sent_7d}</span>}
      <span className="ov-td-n">{c.sent}</span>
    </div>
  )
}

function Campaigns({ rows, client }: { rows: CampaignSend[]; client: Client }) {
  const [showPaused, setShowPaused] = useState(false)
  // Ivan ruling 2026-07-25: paused campaigns are retired history on the Ivan
  // scope — hide them outright (no expander). Rise keeps the expander.
  const visible = client === 'ivan' ? rows.filter(c => c.is_active) : rows
  const shown = visible.filter(c => c.is_active || c.sent > 0)
  const hidden = client === 'ivan' ? [] : visible.filter(c => !c.is_active && c.sent === 0)

  return (
    <section className="ov-sec">
      <div className="ov-h">Campaigns</div>
      {rows.length === 0 ? (
        <div className="ov-empty">No campaigns.</div>
      ) : (
        <div className="ov-tbl">
          {shown.map(c => <CampaignRow key={c.campaign_id} c={c} />)}
          {hidden.length > 0 && (
            <>
              <div className="ov-tr ov-tr-more" onClick={() => setShowPaused(v => !v)}>
                <span className="ov-td-nm">{showPaused ? '−' : '+'} {hidden.length} paused, 0 sent</span>
              </div>
              {showPaused && hidden.map(c => <CampaignRow key={c.campaign_id} c={c} />)}
            </>
          )}
          {/* M4 — the table's Total is the sum of the rows it is SHOWING, and
              it says so: `visible` is the scoped set, `shown` is what rendered.
              inbox_campaign_sends_v is a server-side aggregate, so these are
              full counts, not a page. */}
          <div className="wb-cardf">
            <span className="wb-legend-l">
              {shown.length} of {visible.length} campaigns shown
            </span>
            <span className="wb-total">
              Total: <b>{shown.reduce((s, c) => s + c.sent, 0).toLocaleString()}</b> sent
            </span>
          </div>
        </div>
      )}
    </section>
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

  if (loading && !data) return <div className="rows ov"><div className="empty">Loading…</div></div>
  if (error) return <div className="rows ov"><div className="empty">{error}</div></div>
  if (!data) return <div className="rows ov"><div className="empty">No data yet — the call returned, it just had nothing in it.</div></div>

  const lanes = buildLanes(data.rows, data.daily, client)

  return (
    <div className="rows ov">
      <Hero accept={data.accept} governor={data.governor} pipeline={data.pipeline} replacement={data.replacement} client={client} />
      {timeframe === 'custom' && range && <RangeSummary range={range} client={client} />}
      <DayLedger rows={data.ledger} client={client} timeframe={timeframe} />
      <Funnel accept={data.accept} scans={data.scans} outcomes={data.outcomes} client={client} />
      <div className="ov-duo">
        <KpiRow lanes={lanes} daily={data.daily} client={client} timeframe={timeframe} range={range} />
        <Pipeline rows={data.pipeline} governor={data.governor} client={client} />
      </div>
      <div className="ov-duo">
        <Governor rows={data.governor} client={client} />
        <div className="ov-rcol">
          <Seats data={data} client={client} setClient={setClient} />
          <Campaigns rows={data.campaigns} client={client} />
        </div>
      </div>
    </div>
  )
}
