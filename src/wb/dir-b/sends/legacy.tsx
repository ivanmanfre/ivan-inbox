/* =========================================================================
   S09 (Direction B) — the parts of `src/screens/SendsScreen.tsx` that are NOT
   being rebuilt in this pass.

   The brief for this screen is Overview only: "S08 (Lanes) and S10 (Log) stay
   as they are for now: keep rendering the EXISTING components for those two
   sub-views (import them, do not rebuild them)". `LogView`, `LaneDetail`,
   `InboundDetail` and the lanes body are NOT exported from `src/screens/
   SendsScreen.tsx`, and a builder may not edit `src/screens/**` to export
   them, so they are copied here byte for byte instead. Only two things
   changed: the import paths (this file sits three levels deeper) and the
   lanes body, which was inline JSX in `SendsScreen` and is now `LanesView`
   with the same markup and the same class names.

   Nothing in this file is redesigned. Its inline palette, its class names and
   its copy are the shipped ones, on purpose — see NOTES.md, seam request 1.
   ========================================================================= */
import { useEffect, useState, type RefObject } from 'react'
import {
  fetchLaneRecent, fetchLeadTags, fetchSendLog, fetchSendLogTotals,
  sendKind,
  type Lane, type LaneKey, type LeadTags, type RecentSend, type SendLogItem, type SendLogTotals,
} from '../../../lib/sends'
import {
  fetchInboundDecisions,
  type InboundDecision, type InboundLane, type InboundLaneKey, type InboundStatus,
} from '../../../lib/inbound'
import { Linkified } from '../../../components/Linkified'
import { PullIndicator } from '../../../components/PullIndicator'

export type Client = 'all' | 'ivan' | 'risedtc' | 'arch'
export type Timeframe = '7d' | '30d' | 'custom'
export type { InboundLaneKey, LaneKey }

const MID = '\u00B7'
const CHEV_L = '\u2039'
const CHEV_R = '\u203A'
const WARN = '\u26A0'

export const DOT: Record<Lane['status'], string> = {
  live: '#10A37F',
  slowing: '#FF9F0A',
  stale: '#FF453A',
}

// Separate from DOT above, matching the separate status vocabulary in lib/inbound.
export const IN_DOT: Record<InboundStatus, string> = {
  live: '#10A37F',
  quiet: '#8E8E93',
  off: '#FF9F0A',
}

function daysBetween(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export function ago(iso: string): string {
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

// 🔴 `off` says NO DECISIONS RECORDED, never "never armed", and the difference is not
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
  open_profile: 'OPEN PROF', connection_note_blank: 'CONN\u00B7BLANK', connection_note_bare: 'CONN\u00B7BARE',
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

export function LogView({ client }: { client: Client }) {
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

  if (loading) return <div className="rows sc-rows"><div className="empty">Loading{'\u2026'}</div></div>
  if (error) return <div className="rows sc-rows"><div className="empty">{error}</div></div>
  if (items.length === 0) return <div className="rows sc-rows"><div className="empty">No send activity yet {'\u2014'} a verified zero, not a failed load.</div></div>

  let lastDay = ''
  return (
    <div className="rows sc-rows">
      {/* The log is a window, and it now says so. Both figures are count=exact
          probes; the two shown counts are of this render. */}
      <div className="log-denom">
        <span className="log-denom-l">Newest</span>
        <b>{items.filter(m => m.kind !== 'failed').length}</b>
        <span className="log-denom-l">of {totals ? totals.sent.toLocaleString() : '\u2014'} sent</span>
        <span className="log-denom-s">{MID}</span>
        <b>{items.filter(m => m.kind === 'failed').length}</b>
        <span className="log-denom-l">of {totals ? totals.blocked.toLocaleString() : '\u2014'} blocked</span>
      </div>
      <div className="log-note">CONN = note attached and accepted by the API {MID} CONN{MID}BLANK = deliberate no-note A/B arm {MID} CONN{MID}BARE = note rejected, sent bare as a fallback.</div>
      {items.map(m => {
        const day = logDay(m.event_at)
        const showDay = day !== lastDay
        lastDay = day
        return (
          <div key={m.id} style={{ display: 'contents' }}>
            {showDay && <div className="log-day">{day}</div>}
            <div
              className={`log-r${openId === m.id ? ' log-open' : ''}`}
              onClick={() => setOpenId(v => (v === m.id ? null : m.id))}
            >
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
                {openId === m.id ? (
                  <>
                    {tagChips(tags.get(m.prospect_id)).length > 0 && (
                      <div className="log-tags">
                        {tagChips(tags.get(m.prospect_id)).map(c => <span key={c} className="log-tag">{c}</span>)}
                      </div>
                    )}
                    <div className="log-full">
                      {m.kind === 'failed' ? (m.reason ?? 'send failed') : (m.message_text || '(no text stored)')}
                    </div>
                  </>
                ) : (
                  <div className="log-snip">
                    {m.kind === 'failed' ? (m.reason ?? 'send failed') : m.message_text}
                  </div>
                )}
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
export function LaneDetail({ lane, client, onBack }: {
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
        <span className="back" onClick={onBack}>{CHEV_L}</span>
        <div className="who">
          <div className="n">{lane.label}</div>
          <div className="m"><b>{lane.sent_7d}</b> in 7d {MID} {statusText(lane)}</div>
        </div>
        <span className="sc-dot" style={{ background: DOT[lane.status], width: 12, height: 12 }} />
      </div>
      <div className="rows sc-rows">
        {loading ? (
          <div className="empty">Loading{'\u2026'}</div>
        ) : error ? (
          <div className="empty">{error}</div>
        ) : rows.length === 0 ? (
          <div className="empty">No sends in this lane yet {'\u2014'} a verified zero, not a failed load.</div>
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

// Drill-in for an inbound lane: every decision the automation made on its own, newest
// first, with the reason it gave. Read-only for now — the override that re-admits a
// dropped person is the next slice, and shipping the record first is what tells us
// whether the record gets read.
export function InboundDetail({ lane, client, onBack }: {
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
    <>
      <div className="t-nav">
        <span className="back" onClick={onBack}>{CHEV_L}</span>
        <div className="who">
          <div className="n">{lane.label}</div>
          <div className="m">
            <b>{lane.passed}</b> through {MID} <b>{lane.dropped}</b> stopped here
          </div>
        </div>
        <span className="sc-dot" style={{ background: IN_DOT[lane.status], width: 12, height: 12 }} />
      </div>
      <div className="rows sc-rows">
        <div className="log-note">{lane.blurb}. Nothing here was seen by a human first.</div>
        {loading ? (
          <div className="empty">Loading{'\u2026'}</div>
        ) : error ? (
          <div className="empty">{error}</div>
        ) : rows.length === 0 ? (
          <div className="empty">
            {lane.status === 'off'
              ? 'Nothing recorded for this client. Either nothing has come in, or the lane was never armed here \u2014 the data cannot tell those apart yet.'
              : 'No decisions in this lane yet, a verified zero rather than a failed load.'}
          </div>
        ) : (
          rows.map(d => (
            <div key={d.id} className="ld">
              <div className="ld-h">
                <span className={`ld-v ${d.outcome}`}>{d.outcome === 'passed' ? 'THROUGH' : 'STOPPED'}</span>
                <span className="ld-nm">{d.who}</span>
                <span className="ld-tm">{ago(d.decided_at)}</span>
              </div>
              {d.detail && <div className="ld-meta">{d.detail}</div>}
              {d.reason && <div className="ld-why">{d.reason}</div>}
              {d.quote && <div className="ld-q"><Linkified text={d.quote} /></div>}
              <div className="ld-meta">
                {d.score !== null && <>Score {d.score} {MID} </>}
                {d.judged_blind && <>{WARN} judged without a profile {MID} </>}
                {d.surfaced && <>re-admitted by hand {MID} </>}
                {d.link ? <a href={d.link} target="_blank" rel="noreferrer">Open profile</a> : 'no profile link'}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}

/** The Lanes sub-view body, lifted out of `SendsScreen` unchanged. */
export function LanesView({ lanes, inbound, rowsRef, ptr, onOpenLane, onOpenInbound }: {
  lanes: Lane[]
  inbound: InboundLane[]
  rowsRef: RefObject<HTMLDivElement | null>
  ptr: { pull: number; refreshing: boolean; trigger: number }
  onOpenLane: (k: LaneKey) => void
  onOpenInbound: (k: InboundLaneKey) => void
}) {
  return (
    <div className="rows sc-rows" ref={rowsRef}>
      <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
      <div className="sc-group">
        <span className="sc-group-t">OUTREACH</span>
        <span className="sc-group-c">what we sent</span>
      </div>
      {lanes.map(lane => (
        <div key={lane.key} className="sc" onClick={() => onOpenLane(lane.key)}>
          <div className="sc-l">
            <div className="sc-head">
              <span className="sc-dot" style={{ background: DOT[lane.status] }} />
              <span className="sc-name">{lane.label}</span>
            </div>
            <div className="sc-blurb">{lane.blurb}</div>
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
            <div className="sc-chev">{CHEV_R}</div>
          </div>
        </div>
      ))}

      <div className="sc-group">
        <span className="sc-group-t">INBOUND</span>
        <span className="sc-group-c">decided without you</span>
      </div>
      {inbound.map(lane => (
        <div key={lane.key} className="sc" onClick={() => onOpenInbound(lane.key)}>
          <div className="sc-l">
            <div className="sc-head">
              <span className="sc-dot" style={{ background: IN_DOT[lane.status] }} />
              <span className="sc-name">{lane.label}</span>
            </div>
            <div className="sc-blurb">{lane.blurb}</div>
            {/* Status and the pass/stop split share ONE row: the inbound cards carried
                two more lines than the outbound ones and were 122px against 87px. The
                count that matters is what it STOPPED, so it is stated even at zero. A
                silent filter reporting nothing is what this surface exists to prevent. */}
            <div className={`sc-status s-${lane.status}`}>
              {inboundStatusText(lane)}
              <span className="sc-split"> {MID} <b>{lane.passed}</b> through {MID} <b>{lane.dropped}</b> stopped</span>
            </div>
            <Spark values={lane.daily} />
          </div>
          <div className="sc-r">
            {/* 30d, not 7d: a healthy inbound lane decides 0-3 things a fortnight, so a
                7-day headline would read 0 on a working lane most weeks. */}
            <div className="sc-big">{lane.d30}</div>
            <div className="sc-cap">in 30d</div>
            <div className="sc-24">7d: {lane.d7}</div>
            <div className="sc-chev">{CHEV_R}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
