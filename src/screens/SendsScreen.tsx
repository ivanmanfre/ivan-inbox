import { useEffect, useState, useCallback } from 'react'
import { buildLanes, fetchSends, fetchSendsDaily, type Lane } from '../lib/sends'

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

export function SendsScreen({ client, setClient }: {
  client: Client
  setClient: (c: Client) => void
}) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchSends>>>([])
  const [daily, setDaily] = useState<Awaited<ReturnType<typeof fetchSendsDaily>>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const lanes = buildLanes(rows, daily, client)

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

      <div className="rows sc-rows">
        {loading && rows.length === 0 ? (
          <div className="empty">Loading…</div>
        ) : error ? (
          <div className="empty">{error}</div>
        ) : (
          lanes.map(lane => (
            <div key={lane.key} className="sc">
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
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
