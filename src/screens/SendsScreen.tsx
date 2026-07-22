import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildLanes, fetchLaneRecent, fetchSendLog, fetchSends, fetchSendsDaily,
  type Lane, type LaneKey, type RecentSend, type SendLogItem,
} from '../lib/sends'
import { SendsSkeleton } from '../components/Skeleton'
import { Linkified } from '../components/Linkified'
import { PullIndicator } from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'

type Client = 'all' | 'ivan' | 'risedtc'

const CHIPS: { key: Client; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
]

const DOT: Record<Lane['status'], string> = {
  live: '#10A37F',
  slowing: '#FF9F0A',
  stale: '#FF453A',
}

function daysBetween(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function statusText(lane: Lane): string {
  if (!lane.last_sent) return 'No sends yet'
  if (lane.status === 'live') return `Sent ${ago(lane.last_sent)}`
  if (lane.status === 'slowing') return `Slowing, last ${ago(lane.last_sent)}`
  return `No sends in ${daysBetween(lane.last_sent)} days`
}

const TYPE_LABEL: Record<string, string> = {
  connection_note: 'CONN', dm: 'DM', inmail: 'INMAIL', email: 'EMAIL', manual_reply: 'REPLY',
}
const TYPE_COLOR: Record<string, string> = {
  connection_note: '#0A84FF', dm: '#10A37F', inmail: '#BF5AF2', email: '#FF9F0A', manual_reply: '#10A37F',
}

function logDay(iso: string): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return 'TODAY'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}

// Chronological feed of every outbound action (sends + verified failures).
function LogView({ client }: { client: Client }) {
  const [items, setItems] = useState<SendLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    fetchSendLog(client)
      .then(r => { if (live) setItems(r) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Failed to load') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [client])

  if (loading) return <div className="rows sc-rows"><div className="empty">Loading…</div></div>
  if (error) return <div className="rows sc-rows"><div className="empty">{error}</div></div>
  if (items.length === 0) return <div className="rows sc-rows"><div className="empty">No send activity yet.</div></div>

  let lastDay = ''
  return (
    <div className="rows sc-rows">
      {items.map(m => {
        const day = logDay(m.event_at)
        const showDay = day !== lastDay
        lastDay = day
        return (
          <div key={m.id} style={{ display: 'contents' }}>
            {showDay && <div className="log-day">{day}</div>}
            <div className="log-r">
              <span
                className="log-chip"
                style={m.kind === 'failed'
                  ? { background: 'rgba(255,69,58,.16)', color: '#FF453A' }
                  : { background: `${TYPE_COLOR[m.message_type] ?? '#10A37F'}22`, color: TYPE_COLOR[m.message_type] ?? '#10A37F' }}
              >
                {m.kind === 'failed' ? 'FAILED' : (TYPE_LABEL[m.message_type] ?? m.message_type.toUpperCase())}
              </span>
              <div className="log-mid">
                <div className="log-top">
                  <span className="log-nm">{m.prospect_name}</span>
                  <span className={`client ${m.client_id === 'risedtc' ? 'rise' : ''}`}>
                    {m.client_id === 'risedtc' ? 'RISE' : m.client_id.toUpperCase()}
                  </span>
                </div>
                <div className="log-snip">
                  {m.kind === 'failed' ? (m.reason ?? 'send failed') : m.message_text}
                </div>
              </div>
              <span className="log-tm">{ago(m.event_at)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
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

// Drill-in: recent sent messages for one lane. Read-only.
function LaneDetail({ lane, client, onBack }: {
  lane: Lane; client: Client; onBack: () => void
}) {
  const [rows, setRows] = useState<RecentSend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    fetchLaneRecent(lane.key as LaneKey, client)
      .then(r => { if (live) setRows(r) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Failed to load') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [lane.key, client])

  return (
    <>
      <div className="t-nav">
        <span className="back" onClick={onBack}>‹</span>
        <div className="who">
          <div className="n">{lane.label}</div>
          <div className="m"><b>{lane.sent_7d}</b> in 7d · {statusText(lane)}</div>
        </div>
        <span className="sc-dot" style={{ background: DOT[lane.status], width: 12, height: 12 }} />
      </div>
      <div className="rows sc-rows">
        {loading ? (
          <div className="empty">Loading…</div>
        ) : error ? (
          <div className="empty">{error}</div>
        ) : rows.length === 0 ? (
          <div className="empty">No sends in this lane yet.</div>
        ) : (
          rows.map(m => (
            <div key={m.id} className="ld">
              <div className="ld-h">
                <span className="ld-nm">{m.prospect_name}</span>
                <span className="ld-tm">{ago(m.sent_at)}</span>
              </div>
              <div className="ld-b"><Linkified text={m.message_text} /></div>
            </div>
          ))
        )}
      </div>
    </>
  )
}

export function SendsScreen({ client, setClient }: {
  client: Client
  setClient: (c: Client) => void
}) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchSends>>>([])
  const [daily, setDaily] = useState<Awaited<ReturnType<typeof fetchSendsDaily>>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openLane, setOpenLane] = useState<LaneKey | null>(null)
  const [view, setView] = useState<'lanes' | 'log'>('lanes')
  const rowsRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, d] = await Promise.all([fetchSends(), fetchSendsDaily()])
      setRows(r)
      setDaily(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  const ptr = usePullToRefresh(rowsRef, load)

  const lanes = buildLanes(rows, daily, client)
  const detailLane = openLane ? lanes.find(l => l.key === openLane) ?? null : null

  if (detailLane) {
    return <LaneDetail lane={detailLane} client={client} onBack={() => setOpenLane(null)} />
  }

  return (
    <>
      <div className="nav">
        <div className="row-top">
          <h2>Sends</h2>
          <div className="sc-refresh" onClick={load} title="Refresh">↻</div>
        </div>
        <div className="sc-sub">Pipeline health</div>
        <div className="chips">
          {CHIPS.map(c => (
            <span
              key={c.key}
              className={`chip ${client === c.key ? 'on' : ''}`}
              onClick={() => setClient(c.key)}
            >
              {c.label}
            </span>
          ))}
        </div>
      </div>

      <div className="seg" style={{ margin: '10px 16px 0' }}>
        <div className={`sg ${view === 'lanes' ? 'on' : ''}`} onClick={() => setView('lanes')}>Lanes</div>
        <div className={`sg ${view === 'log' ? 'on' : ''}`} onClick={() => setView('log')}>Log</div>
      </div>

      {view === 'log' ? (
        <LogView client={client} />
      ) : loading && rows.length === 0 ? (
        <SendsSkeleton />
      ) : error ? (
        <div className="rows sc-rows"><div className="empty">{error}</div></div>
      ) : (
        <div className="rows sc-rows" ref={rowsRef}>
          <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
          {lanes.map(lane => (
            <div key={lane.key} className="sc" onClick={() => setOpenLane(lane.key)}>
              <div className="sc-l">
                <div className="sc-head">
                  <span className="sc-dot" style={{ background: DOT[lane.status] }} />
                  <span className="sc-name">{lane.label}</span>
                </div>
                <div className={`sc-status s-${lane.status}`}>{statusText(lane)}</div>
                {lane.blocked > 0 && (
                  <div className="sc-blocked">{lane.blocked} blocked</div>
                )}
                <Spark values={lane.daily} />
              </div>
              <div className="sc-r">
                <div className="sc-big">{lane.sent_7d}</div>
                <div className="sc-cap">in 7d</div>
                <div className="sc-24">24h: {lane.sent_24h}</div>
                <div className="sc-chev">›</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
