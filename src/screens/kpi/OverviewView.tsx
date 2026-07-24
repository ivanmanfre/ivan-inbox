import { useEffect, useState } from 'react'
import {
  buildLanes, fetchSends, fetchSendsDaily, fetchCampaignSends,
  type Lane, type DailyRow, type CampaignSend,
} from '../../lib/sends'
import {
  fetchAccept, fetchPipeline, fetchGovernor, fetchScanOpens,
  acceptRate, runwayDays, laneLabel, governorEnforcementGap,
  type AcceptRow, type PipelineRow, type GovernorRow, type ScanOpenRow,
} from '../../lib/kpis'

type Client = 'all' | 'ivan' | 'risedtc'
type Timeframe = '7d' | '30d' | '90d' | 'all'

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
  return (
    <div className="sc-spark">
      {values.map((v, i) => (
        <div
          key={i}
          className={`sc-bar ${v === 0 ? 'zero' : ''}`}
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

// ---- HERO: three decision tiles (Is it converting? Am I throttled? Runway?) ----
function Hero({ accept, governor, pipeline, client }: {
  accept: AcceptRow[]; governor: GovernorRow[]; pipeline: PipelineRow[]; client: Client
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
  const gMode = worst ? MODE[worst.mode] : MODE.normal
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
      </div>
    </section>
  )
}

// ---- FUNNEL: Sent → Accepted → Scan opens (7d) ----
// Only the Sent→Accepted step is a real subset conversion, so only it carries a
// % arrow. Scan opens count ALL scan-report views (not just accepted prospects),
// so the third step is a neutral separator, never a >100% "conversion".
function Funnel({ accept, scans, client }: {
  accept: AcceptRow[]; scans: ScanOpenRow[]; client: Client
}) {
  const aRows = accept.filter(r => inClient(r.client_id, client))
  const sent7 = sum(aRows, 'sent_7d'), acc7 = sum(aRows, 'accepted_7d')
  const sent30 = sum(aRows, 'sent_30d'), acc30 = sum(aRows, 'accepted_30d')

  const sRows = scans.filter(r => inClient(r.client_id, client))
  const opens7 = sum(sRows, 'opens_7d'), opens30 = sum(sRows, 'opens_30d')
  const distinct = sum(sRows, 'distinct_prospects')
  const lastOpen = latestIso(sRows.map(r => r.last_open))

  const acceptStep = sent7 > 0 ? `${Math.round((acc7 / sent7) * 100)}%` : '—'

  if (aRows.length === 0 && sRows.length === 0) {
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
          <div className="ov-fl">Sent</div>
        </div>
        <div className="ov-farrow">
          <span className="ov-fpct">{acceptStep}</span>
          <span className="ov-fchev">→</span>
        </div>
        <div className="ov-fstep">
          <div className="ov-fn">{acc7}</div>
          <div className="ov-fl">Accepted</div>
        </div>
        {/* neutral separator — scan opens are NOT a subset of accepts */}
        <div className="ov-farrow ov-fsep"><span className="ov-fdot">·</span></div>
        <div className="ov-fstep">
          <div className="ov-fn">{opens7}</div>
          <div className="ov-fl">Scan opens</div>
        </div>
      </div>
      <div className="ov-fcap">
        7d — opens include all scan-report views, not only accepted prospects.
      </div>
      <div className="ov-fcap">
        30d · accepted {acc30}/{sent30} · opens {opens30} · {distinct} prospects{lastOpen ? ` · last ${ago(lastOpen)}` : ''}
      </div>
      <div className="ov-note">Share of notes sent in each window that got accepted. Recent sends are still maturing — this rate only rises.</div>
    </section>
  )
}

// ---- Volume (per-channel) ----
function laneCount(lane: Lane, daily: DailyRow[], client: Client, tf: Timeframe): number {
  if (tf === '7d') return lane.sent_7d
  if (tf === '30d') return lane.sent_30d
  if (tf === 'all') return lane.sent_total
  const cutoff = Date.now() - 90 * 86_400_000
  return daily
    .filter(d => d.message_type === lane.key && inClient(d.client_id, client)
      && new Date(d.day).getTime() >= cutoff)
    .reduce((s, d) => s + d.sent, 0)
}

function KpiRow({ lanes, daily, client, timeframe }: {
  lanes: Lane[]; daily: DailyRow[]; client: Client; timeframe: Timeframe
}) {
  return (
    <section className="ov-sec">
      <div className="ov-h">Volume<span className="ov-h-sub">{timeframe === 'all' ? 'all time' : timeframe}</span></div>
      <div className="ov-kpis">
        {lanes.map(lane => (
          <div key={lane.key} className="ov-kpi">
            <div className="ov-kpi-top">
              <span className="sc-dot" style={{ background: LANE_DOT[lane.key] }} />
              <span className="ov-kpi-nm">{lane.label}</span>
            </div>
            <div className="ov-kpi-big">{laneCount(lane, daily, client, timeframe)}</div>
            <div className="ov-kpi-24">24h: {lane.sent_24h}</div>
            <Spark values={lane.daily} />
          </div>
        ))}
      </div>
    </section>
  )
}

// ---- Governor detail (weekly gauge + daily brake + mode + monthly) ----
function GovGauge({ g }: { g: GovernorRow }) {
  const m = MODE[g.mode]
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
        <b>{g.used}</b>/{g.cap} <span className="ov-cap">this {g.window_label}</span>
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
      <div className="ov-cap">{g.headroom_week} left this {g.window_label} · {g.headroom_day} left today</div>
      {g.monthly_cap != null && (
        <div className="ov-cap">{g.monthly_used}/{g.monthly_cap} this month</div>
      )}
    </div>
  )
}

function Governor({ rows, client }: { rows: GovernorRow[]; client: Client }) {
  const targets: string[] = client === 'all' ? ['ivan', 'risedtc'] : [client]
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
}

function personSummary(data: OverviewData, id: string): PersonSummary {
  const gov = data.governor.find(g => g.client_id === id) ?? null
  const pRows = data.pipeline.filter(r => r.client_id === id)
  const sendable = pRows.reduce((s, r) => s + r.sendable, 0)
  const avg7 = pRows.reduce((s, r) => s + r.sent_7d, 0) / 7
  const dailyRate = Math.max(avg7, gov ? gov.daily_used : 0)
  const runway = runwayDays(sendable, dailyRate)
  const vol24 = data.rows.filter(r => r.client_id === id).reduce((s, r) => s + r.sent_24h, 0)
  return { id, gov, sendable, runway, vol24 }
}

function SeatCard({ p, selected, neutral, onSelect }: {
  p: PersonSummary; selected: boolean; neutral: boolean; onSelect?: () => void
}) {
  const g = p.gov
  const m = g ? MODE[g.mode] : null
  const runwayLbl = p.runway >= 999 ? '∞' : `${p.runway}d`
  const cohort = g == null || g.accept_rate == null ? '—' : `${g.accept_rate}%`
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
      <div className="ov-rc-stats">
        <div className="ov-rc-stat"><span>Cohort accept</span><b>{cohort}</b></div>
        <div className="ov-rc-stat"><span>Pipeline</span><b>{p.sendable}</b><i>{runwayLbl}</i></div>
        <div className="ov-rc-stat"><span>24h vol</span><b>{p.vol24}</b></div>
      </div>
    </div>
  )
}

function Seats({ data, client, setClient }: {
  data: OverviewData; client: Client; setClient?: (c: Client) => void
}) {
  const people = [personSummary(data, 'ivan'), personSummary(data, 'risedtc')]
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

function Campaigns({ rows }: { rows: CampaignSend[] }) {
  const [showPaused, setShowPaused] = useState(false)
  const shown = rows.filter(c => c.is_active || c.sent > 0)
  const hidden = rows.filter(c => !c.is_active && c.sent === 0)

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
  campaigns: CampaignSend[]
}

export function OverviewView({ client, timeframe, setClient }: {
  client: Client; timeframe: Timeframe; setClient?: (c: Client) => void
}) {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    Promise.all([
      fetchSends(), fetchSendsDaily(), fetchAccept(), fetchPipeline(),
      fetchGovernor(), fetchScanOpens(), fetchCampaignSends(client),
    ])
      .then(([rows, daily, accept, pipeline, governor, scans, campaigns]) => {
        if (live) setData({ rows, daily, accept, pipeline, governor, scans, campaigns })
      })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Failed to load') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [client])

  if (loading && !data) return <div className="rows ov"><div className="empty">Loading…</div></div>
  if (error) return <div className="rows ov"><div className="empty">{error}</div></div>
  if (!data) return <div className="rows ov"><div className="empty">No data yet.</div></div>

  const lanes = buildLanes(data.rows, data.daily, client)

  return (
    <div className="rows ov">
      <Hero accept={data.accept} governor={data.governor} pipeline={data.pipeline} client={client} />
      <Funnel accept={data.accept} scans={data.scans} client={client} />
      <div className="ov-duo">
        <KpiRow lanes={lanes} daily={data.daily} client={client} timeframe={timeframe} />
        <Pipeline rows={data.pipeline} governor={data.governor} client={client} />
      </div>
      <div className="ov-duo">
        <Governor rows={data.governor} client={client} />
        <div className="ov-rcol">
          <Seats data={data} client={client} setClient={setClient} />
          <Campaigns rows={data.campaigns} />
        </div>
      </div>
    </div>
  )
}
