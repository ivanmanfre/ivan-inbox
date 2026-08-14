import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildLanes, fetchLaneRecent, fetchSendLog, fetchSendLogTotals, fetchSends, fetchSendsDaily,
  sendKind,
  type Lane, type LaneKey, type RecentSend, type SendLogItem, type SendLogTotals,
} from '../lib/sends'
import { SendsSkeleton } from '../components/Skeleton'
import { Linkified } from '../components/Linkified'
import { PullIndicator } from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { OverviewView } from './kpi/OverviewView'

type Client = 'all' | 'ivan' | 'risedtc' | 'arch'
type Timeframe = '7d' | '30d' | 'custom'

const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'custom', label: 'Custom' },
]

const CHIPS: { key: Client; label: string }[] = [
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
  { key: 'arch', label: 'Arch' },
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
  open_profile: 'OPEN PROF', connection_note_blank: 'CONN·BLANK', connection_note_bare: 'CONN·BARE',
}
const TYPE_COLOR: Record<string, string> = {
  connection_note: '#0A84FF', dm: '#10A37F', inmail: '#BF5AF2', email: '#FF9F0A', manual_reply: '#10A37F',
  open_profile: '#FFD60A', connection_note_blank: '#8E8E93', connection_note_bare: '#FF9F0A',
}

// Open-profile sends land as message_type='dm' with channel='linkedin_inmail', so the raw type
// cannot tell them apart from a normal DM or from a paid InMail. ai_model is the only honest
// discriminator: 'template/rise_openprofile_v1' = free open-profile message (no connection, no
// credit); 'template/rise_inmail_*' = paid InMail. connection_note_blank/connection_note_bare
// (deliberate blank-arm vs degraded/quota bare fallback) live in ../lib/sends so they're covered
// by the same pure-function test suite as buildSendLog/buildLanes.

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
  // The denominator, from a count=exact HEAD probe — never rows.length of a
  // truncated fetch. This log is a WINDOW on 1,700+ sends and 200+ blocks; a
  // count taken off the window would understate failures by ~76%.
  const [totals, setTotals] = useState<SendLogTotals | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    fetchSendLog(client)
      .then(r => { if (live) setItems(r) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Failed to load') })
      .finally(() => { if (live) setLoading(false) })
    // A failed probe must never take the log down with it: no denominator is a
    // smaller lie than a wrong one.
    fetchSendLogTotals(client)
      .then(t => { if (live) setTotals(t) })
      .catch(() => { if (live) setTotals(null) })
    return () => { live = false }
  }, [client])

  if (loading) return <div className="rows sc-rows"><div className="empty">Loading…</div></div>
  if (error) return <div className="rows sc-rows"><div className="empty">{error}</div></div>
  if (items.length === 0) return <div className="rows sc-rows"><div className="empty">No send activity yet — a verified zero, not a failed load.</div></div>

  let lastDay = ''
  return (
    <div className="rows sc-rows">
      {/* The log is a window, and it now says so. Both figures are count=exact
          probes; the two shown counts are of this render. */}
      <div className="log-denom">
        <span className="log-denom-l">Newest</span>
        <b>{items.filter(m => m.kind !== 'failed').length}</b>
        <span className="log-denom-l">of {totals ? totals.sent.toLocaleString() : '—'} sent</span>
        <span className="log-denom-s">·</span>
        <b>{items.filter(m => m.kind === 'failed').length}</b>
        <span className="log-denom-l">of {totals ? totals.blocked.toLocaleString() : '—'} blocked</span>
      </div>
      <div className="log-note">CONN = note attached and accepted by the API · CONN·BLANK = deliberate no-note A/B arm · CONN·BARE = note rejected, sent bare as a fallback.</div>
      {items.map(m => {
        const day = logDay(m.event_at)
        const showDay = day !== lastDay
        lastDay = day
        return (
          <div key={m.id} style={{ display: 'contents' }}>
            {showDay && <div className="log-day">{day}</div>}
            <div className="log-r">
              {/* data-failed is a hook, not a colour. The kind palette here is
                  eight inline hexes, two of which ARE the severity tokens; a
                  treatment that wants to retone it needs one selector that can
                  tell a severity apart from a category. The default app reads
                  neither the attribute nor any rule keyed on it, so its own
                  colours are untouched. */}
              <span
                className="log-chip"
                data-failed={m.kind === 'failed' ? '' : undefined}
                style={m.kind === 'failed'
                  ? { background: 'rgba(255,69,58,.16)', color: '#FF453A' }
                  : { background: `${TYPE_COLOR[sendKind(m)] ?? '#10A37F'}22`, color: TYPE_COLOR[sendKind(m)] ?? '#10A37F' }}
              >
                {m.kind === 'failed' ? 'FAILED' : (TYPE_LABEL[sendKind(m)] ?? sendKind(m).toUpperCase())}
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
          <div className="empty">No sends in this lane yet — a verified zero, not a failed load.</div>
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
  const [view, setView] = useState<'overview' | 'lanes' | 'log'>('overview')
  const [timeframe, setTimeframe] = useState<Timeframe>('7d')
  // The Range pill's dropdown (ask 8b). Open/closed only — the VALUE lives in
  // `timeframe`, so closing the menu never changes what is shown.
  const [range, setRange] = useState(false)
  const [rangeFrom, setRangeFrom] = useState('2026-07-11')
  const [rangeTo, setRangeTo] = useState(() => new Date().toISOString().slice(0, 10))
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
          {/* GRAFT (phase 6 ask 8b, from candidate `split`): the range control
              was a SECOND full-width segmented row stacked under the view
              switcher — two identical-looking 44px bars, one of which is a view
              and one of which is a filter, which is the "second segmented row"
              spine §11.3 forbids (one filter vocabulary, not two chromes). It
              is one `Range: 7d ⌄` pill now, right-set beside the display title
              in the §11.1 anatomy: the label is never omitted, the VALUE is the
              active state (§11.4), never a coloured fill. */}
          <div className="wb-fbar">
            {view === 'overview' && (
              <div className="wb-fpop">
                <button
                  className={`wb-fpill${range ? ' on' : ''}`}
                  onClick={() => setRange(v => !v)}
                  title="The window every figure below is computed over"
                >
                  Range: <b>{TIMEFRAMES.find(t => t.key === timeframe)?.label}</b><i>⌄</i>
                </button>
                {range && (
                  <div className="wb-fmenu">
                    {TIMEFRAMES.map(t => (
                      <button
                        key={t.key}
                        className={`wb-fopt${timeframe === t.key ? ' on' : ''}`}
                        onClick={() => { setTimeframe(t.key); setRange(false) }}
                      >
                        {t.label}{timeframe === t.key && <span className="wb-fopt-t">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="sc-refresh" onClick={load} title="Refresh">↻</div>
          </div>
        </div>
        <div className="sc-sub">Pipeline health</div>
        <div className="chips">
          {CHIPS.map(c => (
            <button
              type="button"
              key={c.key}
              className={`chip ${client === c.key ? 'on' : ''}`}
              onClick={() => setClient(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="seg" style={{ margin: '10px 16px 0' }}>
        <button type="button" className={`sg ${view === 'overview' ? 'on' : ''}`} onClick={() => setView('overview')}>Overview</button>
        <button type="button" className={`sg ${view === 'lanes' ? 'on' : ''}`} onClick={() => setView('lanes')}>Lanes</button>
        <button type="button" className={`sg ${view === 'log' ? 'on' : ''}`} onClick={() => setView('log')}>Log</button>
      </div>

      {view === 'overview' && (
        <>
          {/* the second segmented row used to be here — it is the Range pill in
              the nav now (ask 8b). The custom date pair stays: it is a value
              editor, not a second filter chrome, and only appears once the pill
              has already chosen `Custom`. */}
          {timeframe === 'custom' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 16px 0' }}>
              <input
                type="date" value={rangeFrom} max={rangeTo}
                onChange={e => setRangeFrom(e.target.value)}
                style={{ flex: 1, background: 'rgba(120,120,128,.12)', border: 'none', borderRadius: 8, padding: '8px 10px', color: 'inherit', font: 'inherit', colorScheme: 'dark' }}
              />
              <span style={{ opacity: .5 }}>→</span>
              <input
                type="date" value={rangeTo} min={rangeFrom}
                onChange={e => setRangeTo(e.target.value)}
                style={{ flex: 1, background: 'rgba(120,120,128,.12)', border: 'none', borderRadius: 8, padding: '8px 10px', color: 'inherit', font: 'inherit', colorScheme: 'dark' }}
              />
            </div>
          )}
        </>
      )}

      {view === 'overview' ? (
        <OverviewView
          client={client} timeframe={timeframe} setClient={setClient}
          range={timeframe === 'custom' ? { from: rangeFrom, to: rangeTo } : null}
        />
      ) : view === 'log' ? (
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
