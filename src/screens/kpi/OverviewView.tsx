import { useEffect, useState } from 'react'
import {
  buildLanes, fetchSends, fetchSendsDaily, fetchCampaignSends,
  type Lane, type DailyRow, type CampaignSend,
} from '../../lib/sends'
import {
  fetchAccept, fetchPipeline, fetchGovernor, fetchScanOpens,
  acceptRate, runwayDays, laneLabel,
  type AcceptRow, type PipelineRow, type GovernorRow, type ScanOpenRow,
} from '../../lib/kpis'

type Client = 'all' | 'ivan' | 'risedtc'
type Timeframe = '7d' | '30d' | '90d' | 'all'

// Dot / accent colors mirror SendsScreen so the two views read as one system.
const STATUS = { live: '#10A37F', slowing: '#FF9F0A', stale: '#FF453A' }
type Sev = 'green' | 'amber' | 'red'
const SEV_COLOR: Record<Sev, string> = { green: STATUS.live, amber: STATUS.slowing, red: STATUS.stale }
const LANE_DOT: Record<string, string> = {
  connection_note: '#0A84FF', dm: '#10A37F', inmail: '#BF5AF2', email: '#FF9F0A',
}
const MODE: Record<GovernorRow['mode'], { label: string; color: string; sev: Sev }> = {
  normal: { label: 'NORMAL', color: '#10A37F', sev: 'green' },
  warm_only: { label: 'WARM-ONLY', color: '#FF9F0A', sev: 'amber' },
  cold_paused: { label: 'COLD-PAUSED', color: '#FF453A', sev: 'red' },
}
const MODE_RANK: Record<GovernorRow['mode'], number> = { normal: 0, warm_only: 1, cold_paused: 2 }

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

// Honest gauge geometry — NEVER clamps. When used>cap the bar's full extent is
// `used`; a solid segment fills to the cap position, a dimmer overflow segment
// continues past it, and a marker pins where the cap sits.
function gaugeGeo(used: number, cap: number): { solid: number; over: number; capPos: number; overflow: boolean } {
  if (cap <= 0) return { solid: used > 0 ? 100 : 0, over: 0, capPos: 100, overflow: false }
  if (used <= cap) return { solid: Math.round((used / cap) * 100), over: 0, capPos: 100, overflow: false }
  const capPos = Math.round((cap / used) * 100)
  return { solid: capPos, over: 100 - capPos, capPos, overflow: true }
}

function Gauge({ used, cap, color, sm }: { used: number; cap: number; color: string; sm?: boolean }) {
  const g = gaugeGeo(used, cap)
  return (
    <div className={`ov-gauge ${sm ? 'sm' : ''} ${g.overflow ? 'over' : ''}`}>
      <div className="ov-gauge-fill" style={{ width: `${g.solid}%`, background: color }} />
      {g.overflow && <div className="ov-gauge-ov" style={{ left: `${g.capPos}%`, width: `${g.over}%`, background: color }} />}
      {g.overflow && <div className="ov-gauge-cap" style={{ left: `${g.capPos}%` }} />}
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

// ---- HERO: three decision tiles (Is it converting? Am I throttled? Runway?) ----
function Hero({ accept, governor, pipeline, client }: {
  accept: AcceptRow[]; governor: GovernorRow[]; pipeline: PipelineRow[]; client: Client
}) {
  // Q1 — Is outreach converting? Acceptance 7d vs 30d baseline.
  const aRows = accept.filter(r => inClient(r.client_id, client))
  const sent7 = sum(aRows, 'sent_7d'), acc7 = sum(aRows, 'accepted_7d')
  const sent30 = sum(aRows, 'sent_30d'), acc30 = sum(aRows, 'accepted_30d')
  const r7 = acceptRate(sent7, acc7), r30 = acceptRate(sent30, acc30)
  const trend = r7 - r30
  let aSev: Sev
  if (aRows.length === 0 || sent7 === 0) aSev = 'amber'
  else if (r30 === 0) aSev = r7 > 0 ? 'green' : 'amber'
  else if (r7 >= r30) aSev = 'green'
  else if (r7 >= r30 * 0.65) aSev = 'amber'
  else aSev = 'red'

  // Q2 — Am I throttled? Governor used/cap + mode + headroom today.
  const gRows = governor.filter(g => inClient(g.client_id, client))
  const gUsed = sum(gRows, 'used'), gCap = sum(gRows, 'cap')
  const gHeadDay = sum(gRows, 'headroom_day')
  const worst = gRows.reduce<GovernorRow | null>(
    (w, g) => (!w || MODE_RANK[g.mode] > MODE_RANK[w.mode] ? g : w), null)
  const gMode = worst ? MODE[worst.mode] : MODE.normal
  const gSev: Sev = worst ? gMode.sev : 'amber'

  // Q3 — Do I have runway? Total sendable ÷ daily send rate. Mirrors the
  // Pipeline block: 7d trailing average, floored by today's governor count.
  const pRows = pipeline.filter(r => inClient(r.client_id, client))
  const totalSendable = sum(pRows, 'sendable')
  const avg7 = pRows.reduce((s, r) => s + r.sent_7d, 0) / 7
  const govDaily = gRows.reduce((s, g) => s + g.daily_used, 0)
  const dailyRate = Math.max(avg7, govDaily)
  const runway = runwayDays(totalSendable, dailyRate)
  const rSev: Sev = pRows.length === 0 ? 'amber' : runway < 2 ? 'red' : runway < 5 ? 'amber' : 'green'

  const trendArrow = trend > 0 ? '▲' : trend < 0 ? '▼' : '±'
  const trendSev: Sev = trend >= 0 ? 'green' : trend >= -Math.max(3, r30 * 0.35) ? 'amber' : 'red'

  return (
    <section className="ov-sec">
      <div className="ov-h">Decision<span className="ov-h-sub">where do I stand right now</span></div>
      <div className="ov-hero">
        {/* Acceptance */}
        <div className="ov-tile">
          <div className="ov-tile-h">
            <span className="ov-tile-lbl">Acceptance</span>
            <span className="sc-dot" style={{ background: SEV_COLOR[aSev] }} />
          </div>
          {aRows.length === 0 ? (
            <div className="ov-tile-empty">No data</div>
          ) : (
            <>
              <div className="ov-tile-big">{r7}<span className="ov-tile-unit">%</span></div>
              <BarGauge pct={r7} color={SEV_COLOR[aSev]} sm />
              <div className="ov-tile-sub">
                {acc7}/{sent7} · 7d
                <span className="ov-tile-trend" style={{ color: SEV_COLOR[trendSev] }}> {trendArrow}{Math.abs(trend)} vs 30d</span>
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
              <BarGauge pct={runway >= 999 ? 100 : (runway / 14) * 100} color={SEV_COLOR[rSev]} sm />
              <div className="ov-tile-sub">{totalSendable} sendable</div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

// ---- FUNNEL: Sent 7d → Accepted 7d → Scan opens 7d (new composition) ----
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

  const step = (a: number, b: number) => (a > 0 ? `${Math.round((b / a) * 100)}%` : '—')

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
          <span className="ov-fpct">{step(sent7, acc7)}</span>
          <span className="ov-fchev">→</span>
        </div>
        <div className="ov-fstep">
          <div className="ov-fn">{acc7}</div>
          <div className="ov-fl">Accepted</div>
        </div>
        <div className="ov-farrow">
          <span className="ov-fpct">{step(acc7, opens7)}</span>
          <span className="ov-fchev">→</span>
        </div>
        <div className="ov-fstep">
          <div className="ov-fn">{opens7}</div>
          <div className="ov-fl">Scan opens</div>
        </div>
      </div>
      <div className="ov-fcap">
        30d · accepted {acc30}/{sent30} · opens {opens30} · {distinct} prospects{lastOpen ? ` · last ${ago(lastOpen)}` : ''}
      </div>
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
  return (
    <div className="ov-gov">
      <div className="ov-gov-h">
        <span className="ov-gov-nm">{TITLE(g.client_id)}</span>
        <span className="ov-badge" style={{ background: `${m.color}22`, color: m.color }}>{m.label}</span>
      </div>
      <Gauge used={g.used} cap={g.cap} color={m.color} />
      <div className="ov-gauge-lbl"><b>{g.used}</b>/{g.cap} <span className="ov-cap">this {g.window_label}</span></div>
      <div className="ov-cap">cap {g.cap} · accept {g.accept_rate}%</div>
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
function Campaigns({ rows }: { rows: CampaignSend[] }) {
  return (
    <section className="ov-sec">
      <div className="ov-h">Campaigns</div>
      {rows.length === 0 ? (
        <div className="ov-empty">No campaigns.</div>
      ) : (
        <div className="ov-tbl">
          {rows.map(c => (
            <div key={c.campaign_id} className="ov-tr">
              <span className="ov-td-nm">{c.campaign_name}</span>
              <span
                className="ov-badge"
                style={c.is_active
                  ? { background: '#10A37F22', color: '#10A37F' }
                  : { background: 'rgba(142,142,147,.18)', color: '#8E8E93' }}
              >
                {c.is_active ? 'ACTIVE' : 'PAUSED'}
              </span>
              <span className="ov-td-n">{c.sent}</span>
            </div>
          ))}
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

export function OverviewView({ client, timeframe }: { client: Client; timeframe: Timeframe }) {
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
        <Campaigns rows={data.campaigns} />
      </div>
    </div>
  )
}
