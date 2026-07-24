import { useEffect, useState } from 'react'
import {
  buildLanes, fetchSends, fetchSendsDaily, fetchCampaignSends,
  type Lane, type DailyRow, type CampaignSend,
} from '../../lib/sends'
import {
  fetchAccept, fetchPipeline, fetchGovernor, fetchScanOpens,
  acceptRate, runwayDays, governorHeadroomPct, laneLabel,
  type AcceptRow, type PipelineRow, type GovernorRow, type ScanOpenRow,
} from '../../lib/kpis'

type Client = 'all' | 'ivan' | 'risedtc'
type Timeframe = '7d' | '30d' | '90d' | 'all'

// Dot / accent colors mirror SendsScreen so the two views read as one system.
const STATUS = { live: '#10A37F', slowing: '#FF9F0A', stale: '#FF453A' }
const LANE_DOT: Record<string, string> = {
  connection_note: '#0A84FF', dm: '#10A37F', inmail: '#BF5AF2', email: '#FF9F0A',
}
const MODE: Record<GovernorRow['mode'], { label: string; color: string }> = {
  normal: { label: 'NORMAL', color: '#10A37F' },
  warm_only: { label: 'WARM-ONLY', color: '#FF9F0A' },
  cold_paused: { label: 'COLD-PAUSED', color: '#FF453A' },
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

// ---- Block 1: KPI row (per-channel volume for the selected timeframe) ----
function laneCount(lane: Lane, daily: DailyRow[], client: Client, tf: Timeframe): number {
  if (tf === '7d') return lane.sent_7d
  if (tf === '30d') return lane.sent_30d
  if (tf === 'all') return lane.sent_total
  // 90d: sum the raw daily series over the trailing 90-day window.
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

// ---- Block 2: Engagement (acceptance + scan opens) ----
function Engagement({ accept, scans, client }: {
  accept: AcceptRow[]; scans: ScanOpenRow[]; client: Client
}) {
  const aRows = accept.filter(r => inClient(r.client_id, client))
  const sent7 = sum(aRows, 'sent_7d'), acc7 = sum(aRows, 'accepted_7d')
  const sent30 = sum(aRows, 'sent_30d'), acc30 = sum(aRows, 'accepted_30d')

  const sRows = scans.filter(r => inClient(r.client_id, client))
  const opens7 = sum(sRows, 'opens_7d'), opens30 = sum(sRows, 'opens_30d')
  const distinct = sum(sRows, 'distinct_prospects')
  const lastOpen = latestIso(sRows.map(r => r.last_open))

  return (
    <section className="ov-sec">
      <div className="ov-h">Engagement</div>
      <div className="ov-cards">
        <div className="ov-card">
          <div className="ov-card-t">Acceptance</div>
          {aRows.length === 0 ? (
            <div className="ov-empty">No acceptance data yet.</div>
          ) : (
            <>
              <div className="ov-dual">
                <div>
                  <div className="ov-kpi-big">{acceptRate(sent7, acc7)}%</div>
                  <div className="ov-cap">7d · {acc7}/{sent7}</div>
                </div>
                <div>
                  <div className="ov-kpi-big">{acceptRate(sent30, acc30)}%</div>
                  <div className="ov-cap">30d · {acc30}/{sent30}</div>
                </div>
              </div>
              <div className="ov-note">Connections sent recently haven't had time to accept.</div>
            </>
          )}
        </div>
        <div className="ov-card">
          <div className="ov-card-t">Scan opens</div>
          {sRows.length === 0 ? (
            <div className="ov-empty">No scan opens yet.</div>
          ) : (
            <>
              <div className="ov-dual">
                <div>
                  <div className="ov-kpi-big">{opens7}</div>
                  <div className="ov-cap">7d opens</div>
                </div>
                <div>
                  <div className="ov-kpi-big">{opens30}</div>
                  <div className="ov-cap">30d opens</div>
                </div>
              </div>
              <div className="ov-cap">{distinct} prospects · {lastOpen ? `last ${ago(lastOpen)}` : 'no opens'}</div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

// ---- Block 3: Governor (weekly gauge + daily brake + mode) ----
function GovGauge({ g }: { g: GovernorRow }) {
  const m = MODE[g.mode]
  const weekPct = governorHeadroomPct(g.used, g.cap)
  return (
    <div className="ov-gov">
      <div className="ov-gov-h">
        <span className="ov-gov-nm">{TITLE(g.client_id)}</span>
        <span className="ov-badge" style={{ background: `${m.color}22`, color: m.color }}>{m.label}</span>
      </div>
      <div className="ov-gauge"><div className="ov-gauge-fill" style={{ width: `${weekPct}%`, background: m.color }} /></div>
      <div className="ov-gauge-lbl"><b>{g.used}</b>/{g.cap} <span className="ov-cap">this {g.window_label}</span></div>
      <div className="ov-cap">cap {g.cap} · accept {g.accept_rate}%</div>
      {g.daily_cap > 0 && (
        <div className="ov-brake">
          <div className="ov-gauge sm"><div className="ov-gauge-fill" style={{ width: `${governorHeadroomPct(g.daily_used, g.daily_cap)}%`, background: m.color }} /></div>
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
  // No 'all' governor row exists — render both people stacked for the All view.
  const targets: string[] = client === 'all' ? ['ivan', 'risedtc'] : [client]
  const cards = targets
    .map(t => rows.find(r => r.client_id === t))
    .filter((g): g is GovernorRow => Boolean(g))

  return (
    <section className="ov-sec">
      <div className="ov-h">Governor</div>
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

// ---- Block 4: Pipeline (sendable per lane + runway) ----
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

  // Daily send rate: prefer governor daily_used, fall back to sent_7d / 7.
  const govDaily = governor.filter(g => inClient(g.client_id, client)).reduce((s, g) => s + g.daily_used, 0)
  const fallback = pRows.reduce((s, r) => s + r.sent_7d, 0) / 7
  const dailyRate = govDaily > 0 ? govDaily : fallback

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

// ---- Block 5: Campaigns ----
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
      <KpiRow lanes={lanes} daily={data.daily} client={client} timeframe={timeframe} />
      <Engagement accept={data.accept} scans={data.scans} client={client} />
      <Governor rows={data.governor} client={client} />
      <Pipeline rows={data.pipeline} governor={data.governor} client={client} />
      <Campaigns rows={data.campaigns} />
    </div>
  )
}
