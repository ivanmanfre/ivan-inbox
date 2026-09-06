/* ==========================================================================
   src/wb/sends/index.tsx — S08 Lanes, S10 Log, and the frame around S09.

   The override replaces the WHOLE screen, so this file carries all three views.
   W4 finishes what the direction started: the Overview was already an
   instrument (./Overview.tsx), and now the LANES rows and the LOG are too.

   S08 — the lane rows were `.sc` boxes carrying two hardcoded status palettes
   (three hexes for outreach, three more for inbound). They are ds `Card`s now,
   in a measured grid, and the status is a `Dot` on a severity token plus the
   sentence it already had, so nothing is legible only to a viewer who sees hue.
   Both drill-ins keep every string and every fetch and are rebuilt on the
   table-to-detail move: one head that says what you drilled into, one back
   control, rows underneath.

   S10 — the interactive-logs-table move (moumensoliman), read for what it
   actually teaches: a chevron that expands the row in place, a MONO time
   column, one bold name, one plain description, and status as colour ONLY
   where the status is a live signal. The eight-hex type palette is gone: a send
   type is a category, and a category is never a colour (SYSTEM §1). FAILED is
   the one row state that is a signal, so it is the one row that is toned.

   Every fetch, every derived figure, every threshold and every user-visible
   string is the one `src/screens/SendsScreen.tsx` already had.
   ========================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildLanes, fetchLaneRecent, fetchLeadTags, fetchSendLog, fetchSendLogTotals, fetchSends, fetchSendsDaily,
  sendKind,
  type Lane, type LaneKey, type LeadTags, type RecentSend, type SendLogItem, type SendLogTotals,
} from '../../lib/sends'
import {
  buildInboundLanes, fetchInbound, fetchInboundDaily, fetchInboundDecisions,
  type InboundDecision, type InboundLane, type InboundLaneKey, type InboundStatus,
} from '../../lib/inbound'
import { clientLabel } from '../../lib/money'
import { SendsSkeleton } from '../chrome/Skeleton'
import { Linkified } from '../chrome/Linkified'
import { PullIndicator } from '../chrome/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { Badge, Button, Card, Chip, DayHeader, EmptyState, Icon, IconButton, Input, Popover, PopoverItem, Segmented } from '../../ds'
import { Bar, Body, Dot, Group, Head, Row, Rows, Screen, Sep, Spark, type Tone } from '../kit'
import { OverviewView } from './Overview'
import './sends.css'

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

// A lane that stopped sending is a LIVE signal, so it keeps the severity trio.
// The colours are the system's tokens, read through `Dot`, never a local hex.
const DOT: Record<Lane['status'], Tone> = {
  live: 'clear',
  slowing: 'attention',
  stale: 'urgent',
}

// Separate from DOT above, matching the separate status vocabulary in lib/inbound.
// `quiet` is the absence of a signal, so it is the absence of a colour: an
// inbound lane with nothing to judge is not a fault.
const IN_DOT: Record<InboundStatus, Tone | undefined> = {
  live: 'clear',
  quiet: undefined,
  off: 'attention',
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

// NOTE: `off` says NO DECISIONS RECORDED, never "never armed", and the difference is not
// pedantry. Live on 2026-08-23 the cold-DM filter is armed and running on Rise's seat and
// still reads `off`, because since the retune every inbound chat matched a known prospect
// and the filter had nobody to judge. Until a per-client lane manifest exists there is
// nothing in the data that can tell "nobody set this up" apart from "nothing came in", so
// the card states what it can prove and the drill-in names both possibilities.
function inboundStatusText(lane: InboundLane): string {
  if (lane.status === 'off') return 'No decisions recorded yet'
  if (lane.status === 'live') return `Last decision ${ago(lane.last_at!)}`
  return `Quiet for ${daysBetween(lane.last_at!)} days`
}

const TYPE_LABEL: Record<string, string> = {
  connection_note: 'CONN', dm: 'DM', inmail: 'INMAIL', email: 'EMAIL', manual_reply: 'REPLY',
  open_profile: 'OPEN PROF', connection_note_blank: 'CONN·BLANK', connection_note_bare: 'CONN·BARE',
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

/** The mono clock column the logs-table move puts first after the chevron. */
function logTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--'
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// Chronological feed of every outbound action (sends + verified failures).
// Lead-tag chip labels: the lead-page vocabulary, compressed for a phone row.
function tagChips(t: LeadTags | undefined): string[] {
  if (!t) return []
  const chips: string[] = []
  if (t.lane) chips.push(t.lane.replace(/_/g, ' ').toUpperCase())
  if (t.eu_logic === true) chips.push('EU LOGIC')
  if (t.eu_logic === false) chips.push('US-BOUND')
  if (t.source_kind === 'profile_view_warm') chips.push('PROFILE VIEW')
  else if (t.source_kind === 'client_sourced_sponsor') chips.push('FROM DAVORIN')
  else if (t.source_kind === 'youtube_sponsor_mining') chips.push('YT SPONSOR')
  else if (t.source_kind) chips.push(t.source_kind.replace(/_/g, ' ').toUpperCase())
  if (t.network_distance === 'DISTANCE_1' || t.network_distance === 'FIRST_DEGREE') chips.push('ALREADY CONNECTED')
  if (t.country) chips.push(t.country.toUpperCase())
  return chips
}

// ---- S10: the log --------------------------------------------------------

function LogRow({ m, tags, open, onToggle }: {
  m: SendLogItem
  tags: LeadTags | undefined
  open: boolean
  onToggle: () => void
}) {
  const failed = m.kind === 'failed'
  const chips = open ? tagChips(tags) : []
  const text = failed ? (m.reason ?? 'send failed') : m.message_text
  return (
    <div className="a-log-r" data-open={open ? '' : undefined} data-sev={failed ? 'urgent' : undefined}>
      <button
        type="button"
        className="a-log-b"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="a-log-chev" data-on={open ? '' : undefined}>
          <Icon name="forward" size={16} />
        </span>
        {/* The type is a category, so it is a neutral chip. FAILED is a live
            state, so it is the one that carries a tone. */}
        <span className="a-log-kind">
          {failed
            ? <Chip tone="urgent">FAILED</Chip>
            : <Chip tone="quiet">{TYPE_LABEL[sendKind(m)] ?? sendKind(m).toUpperCase()}</Chip>}
        </span>
        <span className="a-log-tm a-mono">{logTime(m.event_at)}</span>
        <span className="a-log-nm">{m.prospect_name}</span>
        <span className={`a-log-d${open ? '' : ' a-nowrap'}`}>{text || '(no text stored)'}</span>
        <span className="a-log-cl a-meta">{clientLabel(m.client_id)}</span>
        <span className="a-log-ago a-mono a-dim">{ago(m.event_at)}</span>
      </button>
      {open && (
        <div className="a-log-x">
          {chips.length > 0 && (
            <div className="a-log-tags">
              {chips.map(c => <Chip key={c} tone="quiet">{c}</Chip>)}
            </div>
          )}
          <div className="a-log-full a-pre a-body-t">{text || '(no text stored)'}</div>
        </div>
      )}
    </div>
  )
}

function LogView({ client }: { client: Client }) {
  const [items, setItems] = useState<SendLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Tap a row to see the FULL sent message + the lead's tags. Tags fail soft:
  // a failed tag fetch must never take the log down (same rule as the totals).
  const [tags, setTags] = useState<Map<string, LeadTags>>(new Map())
  const [openId, setOpenId] = useState<string | null>(null)
  // The denominator, from a count=exact HEAD probe — never rows.length of a
  // truncated fetch. This log is a WINDOW on 1,700+ sends and 200+ blocks; a
  // count taken off the window would understate failures by ~76%.
  const [totals, setTotals] = useState<SendLogTotals | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    fetchSendLog(client)
      .then(r => {
        if (!live) return
        setItems(r)
        fetchLeadTags(r.map(i => i.prospect_id))
          .then(t => { if (live) setTags(t) })
          .catch(() => { if (live) setTags(new Map()) })
      })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Failed to load') })
      .finally(() => { if (live) setLoading(false) })
    // A failed probe must never take the log down with it: no denominator is a
    // smaller lie than a wrong one.
    fetchSendLogTotals(client)
      .then(t => { if (live) setTotals(t) })
      .catch(() => { if (live) setTotals(null) })
    return () => { live = false }
  }, [client])

  if (loading) return <Body><SendsSkeleton /></Body>
  if (error) return <Body><EmptyState icon="error" title={error} /></Body>
  if (items.length === 0) {
    return (
      <Body>
        <EmptyState icon="sends" title="No send activity yet, a verified zero, not a failed load." />
      </Body>
    )
  }

  const sentShown = items.filter(m => m.kind !== 'failed').length
  const failedShown = items.filter(m => m.kind === 'failed').length

  // The log is a window, and the head says so on both counts.
  const days: Array<{ day: string; rows: SendLogItem[] }> = []
  for (const m of items) {
    const day = logDay(m.event_at)
    if (days.length === 0 || days[days.length - 1].day !== day) days.push({ day, rows: [] })
    days[days.length - 1].rows.push(m)
  }

  return (
    <Body>
      <Group
        className="a-log-g"
        label="Log"
        tail={
          <span className="a-mono">
            Newest <b>{sentShown}</b> of {totals ? totals.sent.toLocaleString() : '—'} sent
            <Sep /><b>{failedShown}</b> of {totals ? totals.blocked.toLocaleString() : '—'} blocked
          </span>
        }
      >
        <div className="a-log-note a-meta">
          CONN = note attached and accepted by the API · CONN·BLANK = deliberate no-note A/B arm · CONN·BARE = note rejected, sent bare as a fallback.
        </div>
        <div className="a-scroll-x">
          <div className="a-log">
            {days.map(d => (
              <div key={d.day}>
                <DayHeader label={d.day} tail={`${d.rows.length}`} />
                {d.rows.map(m => (
                  <LogRow
                    key={m.id}
                    m={m}
                    tags={tags.get(m.prospect_id)}
                    open={openId === m.id}
                    onToggle={() => setOpenId(v => (v === m.id ? null : m.id))}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </Group>
    </Body>
  )
}

// ---- S08: the drill-ins --------------------------------------------------

/** The head both drill-ins share: back, what you drilled into, its state. */
function DetailHead({ title, sub, tone, onBack }: {
  title: string; sub: React.ReactNode; tone: Tone | undefined; onBack: () => void
}) {
  return (
    <Head
      lead={<IconButton icon="back" label="Back" onClick={onBack} />}
      title={title}
      sub={sub}
      tail={<Dot tone={tone} off={!tone} />}
    />
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
    <Screen className="a-sends">
      <DetailHead
        title={lane.label}
        sub={<><b>{lane.sent_7d}</b> in 7d <Sep />{statusText(lane)}</>}
        tone={DOT[lane.status]}
        onBack={onBack}
      />
      <Body>
        {loading ? (
          <SendsSkeleton />
        ) : error ? (
          <EmptyState icon="error" title={error} />
        ) : rows.length === 0 ? (
          <EmptyState icon="sends" title="No sends in this lane yet, a verified zero, not a failed load." />
        ) : (
          <Group label="Recent sends" tail={`${rows.length}`}>
            <Rows>
              {rows.map(m => (
                <Row
                  key={m.id}
                  title={m.prospect_name}
                  tail={<span className="a-mono a-dim">{ago(m.sent_at)}</span>}
                >
                  <span className="a-body-t a-pre a-log-msg"><Linkified text={m.message_text} /></span>
                </Row>
              ))}
            </Rows>
          </Group>
        )}
      </Body>
    </Screen>
  )
}

// Drill-in for an inbound lane: every decision the automation made on its own, newest
// first, with the reason it gave. Read-only for now — the override that re-admits a
// dropped person is the next slice, and shipping the record first is what tells us
// whether the record gets read.
function InboundDetail({ lane, client, onBack }: {
  lane: InboundLane; client: Client; onBack: () => void
}) {
  const [rows, setRows] = useState<InboundDecision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    fetchInboundDecisions(lane.key, client)
      .then(r => { if (live) setRows(r) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Failed to load') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [lane.key, client])

  return (
    <Screen className="a-sends">
      <DetailHead
        title={lane.label}
        sub={<><b>{lane.passed}</b> through <Sep /><b>{lane.dropped}</b> stopped here</>}
        tone={IN_DOT[lane.status]}
        onBack={onBack}
      />
      <Body>
        <div className="a-log-note a-meta">{lane.blurb}. Nothing here was seen by a human first.</div>
        {loading ? (
          <SendsSkeleton />
        ) : error ? (
          <EmptyState icon="error" title={error} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="sends"
            title={lane.status === 'off'
              ? 'Nothing recorded for this client. Either nothing has come in, or the lane was never armed here, the data cannot tell those apart yet.'
              : 'No decisions in this lane yet, a verified zero rather than a failed load.'}
          />
        ) : (
          <Group label="Decisions" tail={`${rows.length}`}>
            <Rows>
              {rows.map(d => (
                <Row
                  key={d.id}
                  lead={<Chip tone={d.outcome === 'passed' ? 'clear' : 'quiet'}>{d.outcome === 'passed' ? 'THROUGH' : 'STOPPED'}</Chip>}
                  title={d.who}
                  tail={<span className="a-mono a-dim">{ago(d.decided_at)}</span>}
                >
                  {d.detail && <span className="a-meta">{d.detail}</span>}
                  {d.reason && <span className="a-body-t">{d.reason}</span>}
                  {d.quote && <span className="a-quote"><Linkified text={d.quote} /></span>}
                  <span className="a-wrapline a-meta">
                    {d.score !== null && <span className="a-mono">Score {d.score}</span>}
                    {d.judged_blind && (
                      <span className="a-wrapline a-sev-attention">
                        <Icon name="alert" size={16} /> judged without a profile
                      </span>
                    )}
                    {d.surfaced && <span>re-admitted by hand</span>}
                    {d.link
                      ? <a className="a-link" href={d.link} target="_blank" rel="noreferrer">Open profile</a>
                      : <span className="a-dim-2">no profile link</span>}
                  </span>
                </Row>
              ))}
            </Rows>
          </Group>
        )}
      </Body>
    </Screen>
  )
}

// ---- S08: the lane cards -------------------------------------------------

/** One lane, as a card: what it is, whether it is running, how much it did. */
function LaneCard({ tone, name, blurb, status, statusTone, blocked, daily, big, bigCap, small, onOpen }: {
  tone: Tone | undefined
  name: string
  blurb: string
  status: React.ReactNode
  statusTone: Tone | undefined
  blocked?: number
  daily: number[]
  big: number
  bigCap: string
  small: React.ReactNode
  onOpen: () => void
}) {
  return (
    <Card
      className="a-lane"
      onClick={onOpen}
      lead={<Dot tone={tone} off={!tone} />}
      title={name}
      sub={blurb}
      tail={<Icon name="forward" size={20} />}
    >
      <div className="a-lane-b">
        <div className="a-lane-l">
          <div className={`a-lane-st a-meta${statusTone ? ` a-sev-${statusTone}` : ''}`}>{status}</div>
          <Spark values={daily} highlightLast />
        </div>
        <div className="a-lane-r">
          <div className="a-figure-t">{big}</div>
          <div className="a-meta a-dim">{bigCap}</div>
          <div className="a-meta a-mono a-dim">{small}</div>
        </div>
      </div>
      {blocked !== undefined && blocked > 0 && (
        <div className="a-lane-blk">
          <Badge tone="attention" label={`${blocked} blocked`}>{blocked}</Badge>
          <span className="a-meta">blocked</span>
        </div>
      )}
    </Card>
  )
}

export function SendsScreen({ client, setClient }: {
  client: Client
  setClient: (c: Client) => void
}) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchSends>>>([])
  const [daily, setDaily] = useState<Awaited<ReturnType<typeof fetchSendsDaily>>>([])
  const [inRows, setInRows] = useState<Awaited<ReturnType<typeof fetchInbound>>>([])
  const [inDaily, setInDaily] = useState<Awaited<ReturnType<typeof fetchInboundDaily>>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openLane, setOpenLane] = useState<LaneKey | null>(null)
  const [openInbound, setOpenInbound] = useState<InboundLaneKey | null>(null)
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
    // Deliberately NOT in the Promise.all above and deliberately not throwing. The inbound
    // views are new (db/040); if they fail to read, the outbound lanes that have worked
    // for weeks must still render. An empty Inbound group is a smaller lie than a blank
    // screen, and buildInboundLanes turns [] into two honest `off` rows.
    try {
      const [ir, id] = await Promise.all([fetchInbound(), fetchInboundDaily()])
      setInRows(ir)
      setInDaily(id)
    } catch { /* leaves the inbound group reading `off` */ }
  }, [])

  useEffect(() => { load() }, [load])
  const ptr = usePullToRefresh(rowsRef, load)

  const lanes = buildLanes(rows, daily, client)
  const inbound = buildInboundLanes(inRows, inDaily, client)
  const detailLane = openLane ? lanes.find(l => l.key === openLane) ?? null : null
  const detailInbound = openInbound ? inbound.find(l => l.key === openInbound) ?? null : null

  if (detailLane) {
    return <LaneDetail lane={detailLane} client={client} onBack={() => setOpenLane(null)} />
  }
  if (detailInbound) {
    return <InboundDetail lane={detailInbound} client={client} onBack={() => setOpenInbound(null)} />
  }

  return (
    <Screen className="a-sends">
      {/* Renamed from "Sends" 2026-08-23: the screen carries inbound automations now,
          and a tab called Sends would hide exactly the half Ivan could not see. */}
      <Head
        title="Lanes"
        sub="Outreach and inbound, per client"
        tail={<IconButton icon="refresh" label="Refresh" onClick={load} />}
      />

      {/* GRAFT (phase 6 ask 8b, from candidate `split`): the range control was a
          SECOND full-width segmented row stacked under the view switcher — two
          identical-looking 44px bars, one of which is a view and one of which is
          a filter, which is the "second segmented row" spine §11.3 forbids (one
          filter vocabulary, not two chromes). It is one `Range: 7d` pill now,
          right-set in the same bar as the view switch and the client switch: the
          label is never omitted, the VALUE is the active state (§11.4), never a
          coloured fill. */}
      <Bar>
        <Segmented
          label="View"
          markerId="a-sends-view"
          value={view}
          onChange={v => setView(v as 'overview' | 'lanes' | 'log')}
          options={[
            { id: 'overview', label: 'Overview' },
            { id: 'lanes', label: 'Lanes' },
            { id: 'log', label: 'Log' },
          ]}
        />
        <span className="a-bar-spacer" />
        {/* The three chips and the pill are ONE control group, so the bar wraps
            between the view switch and the group rather than through it: at 390
            the third client used to drop to a line of its own, which reads as a
            chip that got left behind rather than as a filter. */}
        <span className="a-sends-filters">
          {CHIPS.map(c => (
            <Chip key={c.key} selected={client === c.key} onClick={() => setClient(c.key)}>{c.label}</Chip>
          ))}
          {view === 'overview' && (
            <span className="a-sends-pop">
              <Button
                variant="quiet"
                size="sm"
                iconEnd="disclose"
                onClick={() => setRange(v => !v)}
                title="The window every figure below is computed over"
              >
                Range: <b>{TIMEFRAMES.find(t => t.key === timeframe)?.label}</b>
              </Button>
              <Popover open={range} label="Range" className="a-sends-menu">
                {TIMEFRAMES.map(t => (
                  <PopoverItem
                    key={t.key}
                    onClick={() => { setTimeframe(t.key); setRange(false) }}
                    tail={timeframe === t.key ? <Icon name="check" size={16} /> : undefined}
                  >
                    {t.label}
                  </PopoverItem>
                ))}
              </Popover>
            </span>
          )}
        </span>
      </Bar>

      {/* The custom date pair stays a value editor, not a second filter chrome,
          and only appears once the pill has already chosen `Custom`. */}
      {view === 'overview' && timeframe === 'custom' && (
        <Bar>
          <span className="a-sends-dates">
            <Input
              label="From" labelHidden mono
              type="date" value={rangeFrom} max={rangeTo}
              onChange={e => setRangeFrom(e.target.value)}
            />
            <span className="a-sends-arrow"><Icon name="next" size={16} /></span>
            <Input
              label="To" labelHidden mono
              type="date" value={rangeTo} min={rangeFrom}
              onChange={e => setRangeTo(e.target.value)}
            />
          </span>
        </Bar>
      )}

      {view === 'overview' ? (
        <OverviewView
          client={client} timeframe={timeframe} setClient={setClient}
          range={timeframe === 'custom' ? { from: rangeFrom, to: rangeTo } : null}
        />
      ) : view === 'log' ? (
        <LogView client={client} />
      ) : loading && rows.length === 0 ? (
        <Body><SendsSkeleton /></Body>
      ) : error ? (
        <Body><EmptyState icon="error" title={error} /></Body>
      ) : (
        <Body innerRef={rowsRef}>
          <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
          <Group label="Outreach" tail="what we sent" quiet>
            <div className="a-lanes">
              {lanes.map(lane => (
                <LaneCard
                  key={lane.key}
                  tone={DOT[lane.status]}
                  name={lane.label}
                  blurb={lane.blurb}
                  status={statusText(lane)}
                  statusTone={DOT[lane.status]}
                  blocked={lane.blocked}
                  daily={lane.daily}
                  big={lane.sent_7d}
                  bigCap="in 7d"
                  small={`24h: ${lane.sent_24h}`}
                  onOpen={() => setOpenLane(lane.key)}
                />
              ))}
            </div>
          </Group>

          <Group label="Inbound" tail="decided without you" quiet>
            <div className="a-lanes">
              {inbound.map(lane => (
                <LaneCard
                  key={lane.key}
                  tone={IN_DOT[lane.status]}
                  name={lane.label}
                  blurb={lane.blurb}
                  /* Status and the pass/stop split share ONE line: the count that
                     matters is what it STOPPED, so it is stated even at zero. A
                     silent filter reporting nothing is what this surface exists
                     to prevent. */
                  status={
                    <>
                      {inboundStatusText(lane)}
                      <Sep /><b>{lane.passed}</b> through <Sep /><b>{lane.dropped}</b> stopped
                    </>
                  }
                  statusTone={IN_DOT[lane.status]}
                  daily={lane.daily}
                  /* 30d, not 7d: a healthy inbound lane decides 0-3 things a
                     fortnight, so a 7-day headline would read 0 on a working
                     lane most weeks. */
                  big={lane.d30}
                  bigCap="in 30d"
                  small={`7d: ${lane.d7}`}
                  onOpen={() => setOpenInbound(lane.key)}
                />
              ))}
            </div>
          </Group>
        </Body>
      )}
    </Screen>
  )
}
