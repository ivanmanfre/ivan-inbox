/* ==========================================================================
   src/wb/sends/Control.tsx — Control, Delivery and Recurring problems.

   Everything here reads the verified `cc03.v1` operator payload
   (`src/lib/campaignControl.ts`) and NOTHING else. The legacy instruments below
   it count message rows; this one counts confirmed sends, and the two are never
   added together. Three rules the code keeps rather than comments:

   1. An invitation is never summed with a DM or an InMail. Anywhere.
   2. `unknown` is an ATTENTION state and says "unverified" in words — a reading
      we could not take never renders as a lane that is fine.
   3. Acknowledging an incident flips a LOCAL flag and changes nothing else: the
      caption says "acknowledged, not recovered", and the status word above it
      is the same word it was before the click.

   The private evidence fetch is lazy on purpose: it carries locators and up to
   400 characters of the underlying observation, so it happens on a click and
   never on mount.
   ========================================================================== */
import { useEffect, useState, type ReactNode } from 'react'
import {
  fetchPayload, fetchEvidence, monitorLiveness, STATUS_TONE, STATUS_WORD,
  type CcState, type CcPayload, type CcClient, type CcChannel, type CcIncident,
  type CcRangeRow, type CcRecurrenceItem, type CcEvidenceState, type CcStatus,
} from '../../lib/campaignControl'
import { Badge, Button, type TableColumn } from '../../ds'
import { Cell, Dot, Ledger, Row, Rows, Sep, relAge, type Tone } from '../kit'
import { SkeletonRows } from '../../ds'
import { Section, BarGauge, TableOrRecords } from './parts'
import './sends.css'

type Client = 'all' | 'ivan' | 'risedtc' | 'arch'
export type CcTimeframe = '7d' | '30d' | '90d' | 'custom'
type DateRange = { from: string; to: string }

/** The window every figure in the Delivery section is measured over. */
const INTERVAL_OF: Record<CcTimeframe, string> = { '7d': '7d', '30d': '30d', '90d': '90d', custom: 'custom' }
const PREVIOUS_OF: Record<string, string> = { '7d': 'prev7d', '30d': 'prev30d' }

/** `null` is a reading we do not have, and it says so. It is never 0. */
function num(v: number | null | undefined): ReactNode {
  return v === null || v === undefined ? <span className="a-dim-2">unknown</span> : v.toLocaleString()
}

/**
 * A clock time, and how far away it is FROM THE SNAPSHOT — never from the
 * reader's wall clock. A snapshot taken at 02:00 saying a window "opens in 6h"
 * is true; the same line re-timed against a wall clock fourteen hours later
 * reads "12h ago", which is a future event printed as a past one.
 * A schedule in the snapshot's past says it was already due, never "ago".
 */
function whenLabel(iso: string | null | undefined, asOf: number): string {
  if (!iso) return 'not scheduled'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'not scheduled'
  const clock = new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const d = Math.round((t - asOf) / 1000)
  if (d <= 0) return `${clock} · already due at the snapshot`
  const m = Math.round(d / 60)
  if (m < 60) return `${clock} · in ${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${clock} · in ${h}h`
  return `${new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${clock} · in ${Math.round(h / 24)}d`
}

/** A session boundary is an instant in the payload and a CLOCK TIME to the
    operator, so it is printed in the seat's own zone, never in the reader's. */
function seatClock(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  try {
    return new Date(t).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
  } catch { return new Date(t).toISOString().slice(11, 16) }
}

function ageLabel(s: number | null | undefined): string {
  if (s === null || s === undefined) return 'age unknown'
  if (s < 90) return `data ${Math.round(s)}s old`
  const m = Math.round(s / 60)
  if (m < 90) return `data ${m}m old`
  return `data ${Math.round(m / 60)}h old`
}

function inClient(id: string, client: Client): boolean {
  return client === 'all' || id === client
}

/* The contract's "sendable-open": the shared sender reports Saturday as
   `open_now: true` with a view-only reason, so `open_now` alone is not enough to
   say a lane can send. A lane that is not sendable-open is never paced and never
   alarmed — it only says when it opens again. */
const NOT_SENDABLE = /view_only|_closed|outside_window/
export function sendableOpen(ch: CcChannel): boolean {
  if (!ch.session?.open_now) return false
  return !NOT_SENDABLE.test((ch.executable_reasons ?? []).join(' '))
}

const PACE_WORD: Record<string, string> = {
  no_target: 'no target set for this seat',
  on_track: 'on track against the target',
  behind: 'behind the target',
  not_yet: 'too early in the session to judge',
}

// ---- one channel card ----------------------------------------------------

/** Invitations, DMs and InMails each get their OWN card. There is no tile on
    this surface that adds two channels together. */
function ChannelCard({ ch, title, note }: { ch: CcChannel | null | undefined; title: string; note: string }) {
  if (!ch) return <Cell label={title} value={null} note="no reading for this channel" emptyText="unknown" />
  return (
    <Cell label={title} value={num(ch.confirmed_sent)} note={note}>
      <span className="a-cc-sub a-meta">
        cap {num(ch.capacity?.daily_used)}/{ch.capacity?.daily_cap ? ch.capacity.daily_cap : '—'} today
        {ch.capacity?.weekly_cap ? <> <Sep />{num(ch.capacity.weekly_used)}/{ch.capacity.weekly_cap} this week</> : null}
      </span>
    </Cell>
  )
}

function SessionBlock({ ch, closed, asOf }: { ch: CcChannel; closed: boolean; asOf: number }) {
  const s = ch.session
  if (!s) return null
  const pct = s.progress_pct
  return (
    <div className="a-cc-block">
      <div className="a-meta">
        Sending session <b>{seatClock(s.opens_at, s.tz)}</b>–<b>{seatClock(s.closes_at, s.tz)}</b> {s.tz}
        {s.weekday_rule ? <> <Sep />{s.weekday_rule}</> : null}
      </div>
      {/* A closed window is never paced and never alarmed. It only says when it
          opens again. */}
      {closed ? (
        <div className="a-meta">Opens again {whenLabel(s.next_opening_at, asOf)}</div>
      ) : (
        <>
          <div className="a-meta">
            {num(s.elapsed_eligible_opportunities)} of {num(s.expected_opportunities_total)} sending opportunities elapsed
            {pct !== null && pct !== undefined ? <> <Sep />{pct}%</> : null}
          </div>
          {pct !== null && pct !== undefined && <BarGauge pct={pct} tone="quiet" sm />}
          <div className="a-meta">Pace: {PACE_WORD[ch.pace] ?? ch.pace}
            {ch.planned_by_now !== null && ch.planned_by_now !== undefined
              ? <> <Sep />{ch.confirmed_sent} sent against {ch.planned_by_now} planned by now</>
              : <> <Sep />{ch.planned_by_now_reason ?? 'target_unconfigured'}</>}
          </div>
        </>
      )}
    </div>
  )
}

/* The live producer nests the pool counts one level down — `{ note, by_pool: { cold: 137 } }` —
   while the snapshot fixture carried `{ reason }`. Only numeric entries are pool counts; a string
   under `note`/`reason` is shown as text, never as "[object Object]" (seen live 2026-09-13). */
function poolEntries(raw: CcChannel['eligible_stock_by_pool']): { pools: [string, number][]; note: string | null } {
  if (!raw || typeof raw !== 'object') return { pools: [], note: null }
  const r = raw as Record<string, unknown>
  const inner = r.by_pool && typeof r.by_pool === 'object' ? (r.by_pool as Record<string, unknown>) : r
  const pools = Object.entries(inner).filter((e): e is [string, number] => typeof e[1] === 'number')
  const noteRaw = r.note ?? r.reason
  return { pools, note: typeof noteRaw === 'string' ? noteRaw : null }
}

function SupplyBlock({ ch }: { ch: CcChannel }) {
  const { pools: poolList, note } = poolEntries(ch.eligible_stock_by_pool)
  const pools = poolList.length > 0 ? poolList : null
  return (
    <div className="a-cc-block">
      <div className="a-meta">
        Eligible supply <b>{num(ch.eligible_stock)}</b>
        {ch.eligible_stock_scope ? <> <Sep />scope {ch.eligible_stock_scope}</> : null}
      </div>
      {note && <div className="a-meta a-cc-pool-note">{note}</div>}
      {pools && (
        <div className="a-cc-pools">
          {pools.map(([k, v]) => (
            <span key={k} className="a-cc-pool a-meta"><span className="a-eyebrow">{k}</span> {num(v)}</span>
          ))}
        </div>
      )}
    </div>
  )
}

type LaneTableRow = { id: string; lane: string; sent: number; stock: ReactNode; exec: ReactNode }

function LaneTable({ ch }: { ch: CcChannel }) {
  const lanes = ch.by_lane ?? []
  if (lanes.length === 0) return null
  const rows: LaneTableRow[] = lanes.map(l => ({
    id: `${ch.channel}:${l.source_lane}`,
    lane: l.source_lane,
    sent: l.confirmed_sent,
    stock: num(l.eligible_stock),
    exec: l.executable_now
      ? <span className="a-sev-clear">yes</span>
      : <span className="a-dim a-cc-wrap">no — {(l.executable_reasons ?? []).join('; ') || 'no reason given'}</span>,
  }))
  const columns: Array<TableColumn<LaneTableRow>> = [
    { id: 'lane', header: 'Source lane', cell: r => r.lane },
    { id: 'sent', header: 'Confirmed today', numeric: true, cell: r => r.sent },
    { id: 'stock', header: 'Eligible', numeric: true, cell: r => r.stock },
    { id: 'exec', header: 'Can send now', cell: r => r.exec },
  ]
  return <div className="a-cc-tbl"><TableOrRecords label={`${ch.channel} by source lane`} columns={columns} rows={rows} rowKey={r => r.id} /></div>
}

function IncidentBlock({ inc, asOf }: { inc: CcIncident; asOf: number }) {
  const [ack, setAck] = useState(Boolean(inc.acknowledged))
  return (
    <div className="a-cc-inc">
      <div className="a-wrapline">
        <Badge tone="urgent" label={`Incident ${inc.state}`}>{inc.state.toUpperCase()}</Badge>
        <span className="a-meta">{inc.failure_family ?? 'incident'}{inc.source_lane ? ` · ${inc.source_lane}` : ''}</span>
      </div>
      <div className="a-body-t">
        Cause <b>{inc.cause?.status ?? 'unknown'}</b>: {inc.plain_cause ?? inc.cause?.explanation ?? 'no plain cause recorded'}
      </div>
      {inc.cause?.underlying_restriction && (
        <div className="a-meta">Underlying restriction: {inc.cause.underlying_restriction}</div>
      )}
      {(inc.cause?.alternatives_checked ?? []).length > 0 && (
        <div className="a-meta">Alternatives checked: {(inc.cause!.alternatives_checked ?? []).join(' · ')}</div>
      )}
      <div className="a-meta">
        {num(inc.observed_failures)} failures over {num(inc.observed_distinct_prospects)} people
        <Sep />{(inc.evidence_ids ?? []).length} evidence records
      </div>
      <div className="a-body-t">Next action: {inc.next_action?.action ?? 'none recorded'}
        {inc.next_action?.owner ? <> <Sep />owner {inc.next_action.owner}</> : null}
      </div>
      <div className="a-meta">
        Earliest safe at {inc.next_action?.earliest_safe_at ? whenLabel(inc.next_action.earliest_safe_at, asOf) : 'not set'}
        <Sep />Next check {whenLabel(inc.next_check_at, asOf)}
      </div>
      <div className="a-meta">Recovers when: {inc.recovery_condition ?? 'no recovery condition recorded'}</div>
      <div className="a-wrapline">
        <Button variant="quiet" size="sm" onClick={() => setAck(true)} disabled={ack}>
          {ack ? 'Acknowledged' : 'Acknowledge'}
        </Button>
        {ack && <span className="a-meta a-sev-attention">acknowledged, not recovered</span>}
      </div>
    </div>
  )
}

function EvidenceFold({ payload, ids }: { payload: CcPayload; ids: string[] }) {
  const refs = payload.evidence.filter(e => ids.includes(e.id))
  const [priv, setPriv] = useState<CcEvidenceState | 'loading' | null>(null)
  return (
    <>
      <details className="a-cc-fold">
        <summary>Evidence ({refs.length})</summary>
        <Rows>
          {refs.length === 0 && <div className="a-sends-empty">No evidence references on this row.</div>}
          {refs.map(e => (
            <Row
              key={e.id}
              title={<span className="a-mono">{e.id}</span>}
              sub={`${e.source_kind ?? 'unknown kind'} · ${e.lineage ?? 'unknown lineage'}`}
              tail={<span className="a-mono a-dim">{e.observed_at ?? e.event_at ?? '—'}</span>}
            />
          ))}
        </Rows>
      </details>
      {/* Lazy by contract: the private records carry locators and text, so they
          are fetched on this click and never on mount. */}
      <details
        className="a-cc-fold"
        onToggle={e => {
          if ((e.currentTarget as HTMLDetailsElement).open && priv === null) {
            setPriv('loading')
            fetchEvidence().then(setPriv).catch(() => setPriv({ state: 'unavailable', reason: 'private evidence read failed' }))
          }
        }}
      >
        <summary>Private detail</summary>
        {priv === null && <div className="a-sends-empty">Not fetched yet.</div>}
        {priv === 'loading' && <SkeletonRows rows={2} label="Loading private evidence" />}
        {priv && priv !== 'loading' && priv.state === 'unavailable' && (
          <div className="a-sends-empty">Private detail not available: {priv.reason}</div>
        )}
        {priv && priv !== 'loading' && priv.state === 'ok' && (
          <Rows>
            {priv.records.filter(r => ids.includes(r.id)).map(r => (
              <Row key={r.id} title={<span className="a-mono">{r.id}</span>} sub={r.source_locator ?? ''} subWrap>
                {r.text && <span className="a-body-t a-pre">{r.text}</span>}
              </Row>
            ))}
          </Rows>
        )}
      </details>
    </>
  )
}

// ---- one client row ------------------------------------------------------

function ControlSummary({ c, liveness, asOf, staleMinutes, selected, onOpen }: {
  c: CcClient; liveness: string; asOf: number
  /** Set when the monitor has gone quiet: status rule 1 then applies here, in
      the browser, exactly as it applies in the builder. A green word beside a
      dead monitor is the one reading this surface must never show. */
  staleMinutes: number | null
  /** The chip's seat. It marks and opens this row; it never hides another. */
  selected?: boolean
  onOpen: () => void
}) {
  const shown: CcStatus = staleMinutes === null ? c.status : 'unknown'
  const tone = STATUS_TONE[shown]
  const inv = c.invitation
  const closed = c.status === 'outside_window' || !sendableOpen(inv)
  const fresh = c.freshness

  return (
      <Row
        className="a-cc-row"
        lead={<Dot tone={tone as Tone} off={tone === undefined} />}
        title={
          <>
            {c.label} <span className="a-cc-status" data-tone={tone ?? 'none'}>{STATUS_WORD[shown]}</span>
            {/* Never green, and never silent about why it is not green. The
                space is real, not a margin: a screen reader reads the text, and
                "Unknownunverified" is not a word. */}
            {shown === 'unknown' && <>{' '}<span className="a-cc-unverified">unverified</span></>}
          </>
        }
        sub={staleMinutes === null
          ? c.status_reason
          : `The monitor has not reported in for ${staleMinutes} minutes; these figures may be out of date. Payload said: ${STATUS_WORD[c.status].toLowerCase()} — ${c.status_reason}`}
        subWrap
        tail={
          <span className="a-cc-tail">
            <b className="a-figure-t">{num(inv.confirmed_sent)}</b>
            <span className="a-meta a-dim">invitations today</span>
          </span>
        }
        selected={selected}
        onClick={onOpen}
      >
        <span className="a-row-meta a-cc-meta">
          <span className="a-cc-next">Next: {c.next_action?.action ?? 'nothing recorded'}</span>
          <Sep />
          <span className="a-sends-nb">
            {closed ? 'Opens' : 'Next check'} {whenLabel(c.next_check_at, asOf)}
          </span>
          <Sep />
          <span className="a-sends-nb">{ageLabel(fresh?.data_age_s)} · rules {fresh?.rule_version ?? 'unknown'}</span>
          <Sep />
          <span className="a-sends-nb">monitor {liveness}</span>
        </span>
      </Row>
  )
}

/* The three summary rows sit together, then ONE detail panel below them. With
   the panel inline, opening a seat pushed the other two below the fold — three
   rows on the page and one seat on the screen, which is the thing this surface
   exists to stop. */
function ControlPanel({ c, payload, asOf }: { c: CcClient; payload: CcPayload; asOf: number }) {
  const inv = c.invitation
  const closed = c.status === 'outside_window' || !sendableOpen(inv)
  const incidents = c.incidents ?? []
  return (
        <div className="a-cc-panel">
          <div className="a-eyebrow a-cc-sublabel">{c.label} — detail</div>
          <Ledger>
            <ChannelCard ch={inv} title="Invitations today" note="invitations only" />
            <ChannelCard ch={c.dm} title="DMs today" note="messages after an accept — never added to invitations" />
            <ChannelCard ch={c.inmail} title="InMail today" note="paid/open-profile knocks — never added to invitations" />
          </Ledger>
          <SupplyBlock ch={inv} />
          <SessionBlock ch={inv} closed={closed} asOf={asOf} />
          {!inv.executable_now && (inv.executable_reasons ?? []).length > 0 && (
            <div className="a-meta a-sev-attention a-cc-wrap">
              Cannot send right now: {(inv.executable_reasons ?? []).join('; ')}
            </div>
          )}
          {incidents.length === 0
            ? <div className="a-meta">No open incident on this seat.</div>
            : incidents.map(i => <IncidentBlock key={i.incident_key} inc={i} asOf={asOf} />)}
          <LaneTable ch={inv} />
          <EvidenceFold
            payload={payload}
            ids={[...(c.status_basis?.evidence_ids ?? []), ...(inv.evidence_ids ?? []), ...incidents.flatMap(i => i.evidence_ids ?? [])]}
          />
        </div>
  )
}

// ---- Control -------------------------------------------------------------

export function ControlSection({ cc, client, now = Date.now() }: {
  cc: CcState | null; client: Client; now?: number
}) {
  /* Which seat's detail is open. The chip's seat opens by default, and so does
     a seat with an open incident: a red row that hides its own cause behind a
     click is a row that gets skipped, and the cause is the whole point of it. */
  const [openId, setOpenId] = useState<string | null>(null)
  if (cc === null) {
    return <Section label="Control" tail="reading" wrapTail><SkeletonRows rows={3} label="Reading the control payload" /></Section>
  }
  if (cc.state === 'unavailable') {
    return (
      <Section label="Control" tail="no reading" wrapTail>
        <Rows>
          <Row
            lead={<Dot tone="attention" />}
            title="Control data not available"
            sub={cc.reason}
            subWrap
            meta="No confirmed figures are shown for this state, and nothing below it is a substitute for them."
          />
        </Rows>
      </Section>
    )
  }
  if (cc.state === 'error') {
    return (
      <Section label="Control" tail="unverified" wrapTail>
        <Rows>
          <Row
            lead={<Dot tone="attention" />}
            title={<>Unverified <span className="a-cc-unverified">contract error</span></>}
            sub={cc.error}
            subWrap
            meta="The payload did not match cc03.v1, so no figure from it is shown. The legacy counters below are NOT used as a stand-in."
          />
        </Rows>
      </Section>
    )
  }

  const p = cc.payload
  const live = monitorLiveness(p, now)
  const asOf = Number.isFinite(Date.parse(p.as_of)) ? Date.parse(p.as_of) : now
  const asOfClock = new Date(asOf).toLocaleTimeString('en-GB', { timeZone: p.ranges.tz || 'UTC', hour: '2-digit', minute: '2-digit' })
  const tzShort = (p.ranges.tz || 'UTC').split('/').pop()
  /* Status rule 1: a stale monitor makes EVERY client unknown, whatever the
     payload's own word was when it was built. `unknown` liveness (a snapshot
     with no tick at all) does not trigger it — that is a missing heartbeat, not
     a dead one. */
  const staleMinutes = live === 'stale' && p.monitor.last_tick_at
    ? Math.max(1, Math.round((now - new Date(p.monitor.last_tick_at).getTime()) / 60000))
    : null
  /* RULED: Control shows EVERY seat, always. The screen exists so one look
     answers "is each client on track" without opening three screens, and a chip
     filter that hides two of the three seats is the opposite of that. The chip
     still means something here — it marks and opens the seat you picked — but it
     never removes a seat from the answer. Delivery and Recurring problems keep
     honouring the filter, because those are windows onto one seat's numbers. */
  const rows = p.clients
  const fallbackOpen = rows.find(c => client !== 'all' && c.client_id === client)
    ?? rows.find(c => c.status === 'incident')
    ?? null
  const detail = (openId ? rows.find(c => c.client_id === openId) : null) ?? (openId ? null : fallbackOpen)
  return (
    <Section
      label="Control"
      wrapTail
      tail={
        <span className="a-mono">
          {p.source_mode ?? 'snapshot'} <Sep />as of {asOfClock} {tzShort} ({relAge(p.as_of, now)})
          <Sep />monitor {live}
          {p.monitor.last_tick_at ? <> <Sep />tick {relAge(p.monitor.last_tick_at, now)}</> : null}
          {p.coverage.degraded && <> <Sep /><span className="a-sev-attention">coverage degraded</span></>}
        </span>
      }
    >
      {staleMinutes !== null && (
        <div className="a-sends-cap a-sev-attention">
          The monitor last reported {staleMinutes} minutes ago, past its own staleness budget, so every seat below reads unverified regardless of the word the payload carried.
        </div>
      )}
      {p.coverage.degraded && p.coverage.degraded_reasons.length > 0 && (
        <div className="a-sends-cap">Degraded sources: {p.coverage.degraded_reasons.join(' · ')}</div>
      )}
      <Rows>
        {rows.length === 0
          ? <Row title="No seat in this payload carries a control reading." />
          : rows.map(c => (
              <ControlSummary
                key={c.client_id}
                c={c}
                liveness={live}
                asOf={asOf}
                staleMinutes={staleMinutes}
                selected={client !== 'all' && c.client_id === client}
                onOpen={() => setOpenId(v => (v === c.client_id ? null : c.client_id))}
              />
            ))}
      </Rows>
      {detail && <ControlPanel c={detail} payload={p} asOf={asOf} />}
      <div className="a-sends-cap">
        Confirmed sends from the frozen Run 01 rules. Invitations, DMs and InMail are three separate figures and are never added together.
      </div>
    </Section>
  )
}

// ---- Delivery ------------------------------------------------------------

function rowFor(rows: CcRangeRow[], cid: string, ch: string, interval: string, lane = '__all__'): CcRangeRow | null {
  return rows.find(r => r.client_id === cid && r.channel === ch && r.interval === interval && r.source_lane === lane) ?? null
}

/**
 * A cohort figure always names the denominator it is actually over. A null
 * `matured_denominator` does not mean "no denominator": it means maturity is
 * not tracked for that cohort, and the count it IS over (`invited` /
 * `first_messaged`) is right there. The rate stays "—", because a rate with no
 * matured denominator would be a number nobody measured.
 */
function cohortText(c: CcRangeRow['acceptance_cohort'] | CcRangeRow['reply_cohort'], hitKey: 'accepted_within_72h' | 'replied_within_72h'): ReactNode {
  if (!c) return <span className="a-dim-2">no cohort</span>
  const hit = (c as Record<string, unknown>)[hitKey] as number | null | undefined
  const den = c.matured_denominator
  if (den === null || den === undefined) {
    const base = hitKey === 'accepted_within_72h' ? c.invited : c.first_messaged
    const word = hitKey === 'accepted_within_72h' ? 'invited' : 'first messaged'
    if (base !== null && base !== undefined) {
      return <>{num(hit)} of {num(base)} {word}</>
    }
    return <>{num(hit)} <span className="a-dim">· no denominator recorded</span></>
  }
  // An empty denominator renders an em dash. It is NEVER 0%.
  const rate = c.rate_pct === null || c.rate_pct === undefined ? '—' : `${c.rate_pct}%`
  return <>{num(hit)} / {num(den)} matured <span className="a-dim">({rate})</span></>
}

type DeliveryRow = {
  id: string; label: string
  inv: ReactNode; dm: ReactNode; inmail: ReactNode
  accept: ReactNode; reply: ReactNode
}

export function DeliverySection({ cc, timeframe, range, client }: {
  cc: CcState | null; timeframe: CcTimeframe; range: DateRange | null; client: Client
}) {
  if (cc === null) return <Section label="Delivery" tail="reading" wrapTail><SkeletonRows rows={3} label="Reading delivery" /></Section>
  if (cc.state !== 'ok') return null

  const p = cc.payload
  const want = INTERVAL_OF[timeframe]
  const iv = p.ranges.intervals.find(i => i.name === want) ?? null
  const customMatches = timeframe !== 'custom' || (iv !== null && range !== null && iv.from.slice(0, 10) === range.from && iv.to.slice(0, 10) === range.to)

  if (!iv || !customMatches) {
    return (
      <Section label="Delivery" tail={timeframe} wrapTail>
        <div className="a-sends-empty">
          {timeframe === 'custom'
            ? 'custom range not in this snapshot — run build --custom'
            : `no ${timeframe} interval in this snapshot`}
        </div>
      </Section>
    )
  }

  const clients = p.clients.filter(c => inClient(c.client_id, client))
  const rows: DeliveryRow[] = clients.map(c => {
    const i = rowFor(p.ranges.rows, c.client_id, 'invitation', want)
    const d = rowFor(p.ranges.rows, c.client_id, 'dm', want)
    const m = rowFor(p.ranges.rows, c.client_id, 'inmail', want)
    return {
      id: c.client_id,
      label: c.label,
      inv: i ? <>{num(i.sent)} <span className="a-dim">· {num(i.unique_recipients)} people</span></> : <span className="a-dim-2">no row</span>,
      dm: d ? <>{num(d.sent)} <span className="a-dim">· {num(d.unique_recipients)} people</span></> : <span className="a-dim-2">no row</span>,
      inmail: m ? <>{num(m.sent)} <span className="a-dim">· {num(m.unique_recipients)} people</span></> : <span className="a-dim-2">no row</span>,
      accept: cohortText(i?.acceptance_cohort, 'accepted_within_72h'),
      reply: d ? <>{cohortText(d.reply_cohort, 'replied_within_72h')} <span className="a-dim">· {num(d.replies_people)} repliers</span></> : <span className="a-dim-2">no row</span>,
    }
  })

  const columns: Array<TableColumn<DeliveryRow>> = [
    { id: 'who', header: 'Seat', width: '10%', cell: r => r.label },
    { id: 'inv', header: 'Invitations', numeric: true, width: '15%', cell: r => r.inv },
    { id: 'dm', header: 'DMs', numeric: true, width: '14%', cell: r => r.dm },
    { id: 'inmail', header: 'InMail', numeric: true, width: '13%', cell: r => r.inmail },
    { id: 'accept', header: 'Accepted ≤72h', numeric: true, width: '22%', cell: r => r.accept },
    { id: 'reply', header: 'Replied ≤72h', numeric: true, width: '26%', cell: r => r.reply },
  ]

  // Lane breakdown: separate rows, never folded into the __all__ figure.
  const laneRows = p.ranges.rows
    .filter(r => r.interval === want && r.source_lane !== '__all__' && inClient(r.client_id, client))
  type LaneRow = { id: string; who: string; lane: string; ch: string; sent: number }
  const lanes: LaneRow[] = laneRows.map(r => ({
    id: `${r.client_id}:${r.channel}:${r.source_lane}`,
    who: p.clients.find(c => c.client_id === r.client_id)?.label ?? r.client_id,
    lane: r.source_lane, ch: r.channel, sent: r.sent,
  }))
  const laneCols: Array<TableColumn<LaneRow>> = [
    { id: 'lane', header: 'Source lane', cell: r => r.lane },
    { id: 'who', header: 'Seat', cell: r => r.who },
    { id: 'ch', header: 'Channel', cell: r => r.ch },
    { id: 'sent', header: 'Sent', numeric: true, cell: r => r.sent },
  ]

  // A comparison needs two COMPLETE windows of the same length. `today` is a
  // partial day and is never compared with one.
  const prev = PREVIOUS_OF[want]
  const prevIv = prev ? p.ranges.intervals.find(i => i.name === prev) : undefined
  const comparable = Boolean(prev && prevIv && prevIv.complete && iv.complete && prevIv.days === iv.days)
  const compare = comparable
    ? p.ranges.compare.filter(r => r.current === want && r.previous === prev && inClient(r.client_id, client))
    : []

  const todayIv = p.ranges.intervals.find(i => i.name === 'today')
  const todayRows = todayIv
    ? p.ranges.rows.filter(r => r.interval === 'today' && r.source_lane === '__all__' && inClient(r.client_id, client))
    : []

  const disclosure = p.ranges.rows
    .filter(r => r.interval === want && r.source_lane === '__all__' && r.channel === 'invitation' && inClient(r.client_id, client))
    .reduce((a, r) => ({
      attempted: a.attempted + (r.attempted ?? 0), failed: a.failed + (r.failed ?? 0), phantom: a.phantom + (r.phantom ?? 0),
    }), { attempted: 0, failed: 0, phantom: 0 })

  return (
    <Section wrapTail label="Delivery" tail={<span className="a-mono">{iv.from.slice(0, 10)} → {iv.to.slice(0, 10)} · {iv.days}d · {p.ranges.tz}</span>}>
      <div className="a-cc-tbl">
        <TableOrRecords label="Delivery by seat" columns={columns} rows={rows} rowKey={r => r.id} />
      </div>
      <div className="a-sends-cap">
        Confirmed sends only. Invitations attempted {disclosure.attempted}, of which {disclosure.failed} failed and {disclosure.phantom} were phantom rows that never left the seat. Invitations, DMs and InMail are never combined into one total.
        {' '}A cohort shown as "n of m first messaged" or "n of m invited" has no matured denominator in this snapshot — maturity is not tracked for it, so no rate is shown.
      </div>

      {lanes.length > 0 && (
        <>
          <div className="a-eyebrow a-cc-sublabel">By source lane</div>
          <div className="a-cc-tbl">
            <TableOrRecords label="Delivery by source lane" columns={laneCols} rows={lanes} rowKey={r => r.id} />
          </div>
        </>
      )}

      {compare.length > 0 ? (
        <div className="a-cc-block">
          <div className="a-eyebrow a-cc-sublabel">Against the previous {iv.days} days</div>
          <Rows>
            {compare.map(r => (
              <Row
                key={`${r.client_id}:${r.channel}`}
                title={`${p.clients.find(c => c.client_id === r.client_id)?.label ?? r.client_id} · ${r.channel}`}
                sub={`${r.sent_current} against ${r.sent_previous} · ${r.delta >= 0 ? '+' : ''}${r.delta}`}
                meta={
                  r.delta_pp === null || r.delta_pp === undefined
                    ? 'no matured cohort on both sides'
                    : `accept ${r.accept_rate_current_pct}% against ${r.accept_rate_previous_pct}% · ${r.delta_pp >= 0 ? '+' : ''}${r.delta_pp}pp${r.small_cohort ? ' · small cohort' : ''}`
                }
              />
            ))}
          </Rows>
        </div>
      ) : (
        <div className="a-sends-cap">No comparison for this window: a comparison needs two complete windows of equal length.</div>
      )}

      {todayRows.length > 0 && (
        <div className="a-cc-block">
          <div className="a-eyebrow a-cc-sublabel">Today, a partial day — never compared</div>
          <span className="a-meta a-cc-wrap">
            {todayRows.map(r => (
              <span key={`${r.client_id}:${r.channel}`}>
                {p.clients.find(c => c.client_id === r.client_id)?.label ?? r.client_id} {r.channel} {r.sent}<Sep />
              </span>
            ))}
          </span>
        </div>
      )}

      {p.ranges.notes.length > 0 && (
        <div className="a-sends-cap">{p.ranges.notes.join(' · ')}</div>
      )}
    </Section>
  )
}

// ---- Recurring problems --------------------------------------------------

function fixCounts(item: CcRecurrenceItem) {
  const fixes = item.past_fixes ?? []
  return {
    n: fixes.length,
    proposed: fixes.filter(f => f.state === 'proposed').length,
    applied: fixes.filter(f => f.state === 'applied').length,
    verified: fixes.filter(f => f.state === 'verified').length,
    later: fixes.filter(f => f.later_recurrence).length,
  }
}

function RecurrenceRow({ item, payload }: { item: CcRecurrenceItem; payload: CcPayload }) {
  const f = fixCounts(item)
  const cc = item.cause_confidence
  const refs = payload.evidence.filter(e => (item.evidence_ref_ids ?? []).includes(e.id))
  return (
    <div className="a-cc-rec">
      <div className="a-row-title">{item.title}</div>
      <div className="a-meta">
        Independent <b>{num(item.independent?.distinct_events)}</b> events over <b>{num(item.independent?.distinct_days)}</b> days
        <Sep />ledger {num(item.ledger?.distinct_events)} over {num(item.ledger?.distinct_days)} days
      </div>
      <div className="a-meta">
        Relationship: {item.relationship ?? 'unknown'}
        {item.relationship_is_majority === false && (
          <> <Sep /><span className="a-sev-attention">not a majority</span></>
        )}
      </div>
      {item.relationship_is_majority === false && item.relationship_note && (
        <div className="a-body-t">{item.relationship_note}</div>
      )}
      <div className="a-meta">
        Cause confidence {cc?.value === null || cc?.value === undefined ? 'unknown' : cc.value}
        {cc?.meaning ? <> — {cc.meaning}</> : null}
        <Sep />{num(cc?.supporting_independent_events)} supporting independent events
      </div>
      <div className="a-meta">
        Previous attempts: <b>{f.n}</b> ({f.proposed} proposed · {f.applied} applied · {f.verified} verified)
        <Sep />{f.later} recurred later
      </div>
      <div className="a-body-t">
        {item.withheld
          ? <>Repair withheld — {item.withheld_reason ?? 'no reason recorded'}</>
          : <>Recommended repair: {item.recommended_fix ?? 'none recorded'}</>}
      </div>
      <div className="a-meta">
        Owner {item.owner ?? 'unassigned'}<Sep />Success measure: {item.success_measure ?? 'none recorded'}
      </div>
      <details className="a-cc-fold">
        <summary>Past attempts and evidence</summary>
        <Rows>
          {(item.past_fixes ?? []).length === 0 && <div className="a-sends-empty">No previous attempt recorded.</div>}
          {(item.past_fixes ?? []).map((fx, i) => (
            <Row
              key={`${item.recurrence_id}-fix-${i}`}
              title={fx.scope}
              titleWrap
              sub={`${fx.state}${fx.recorded_at ? ` · ${fx.recorded_at.slice(0, 10)}` : ''}${fx.later_recurrence ? ' · recurred later' : ''}`}
              subWrap
            >
              {(fx.receipts ?? []).map(r => (
                <span key={r.receipt_id} className="a-meta a-cc-receipt">
                  {r.receipt_id}: supports <b>{r.supports_scope ?? 'nothing named'}</b>
                  <Sep />closes the defect: {r.closes_defect ? 'yes' : 'no'}
                  <Sep />{r.reason ?? 'no reason'}
                </span>
              ))}
            </Row>
          ))}
          {refs.map(e => (
            <Row
              key={e.id}
              title={<span className="a-mono">{e.id}</span>}
              sub={`${e.source_kind ?? 'unknown kind'} · ${e.lineage ?? 'unknown lineage'}${e.derived_from ? ` · derived from ${e.derived_from}` : ''}`}
              tail={<span className="a-mono a-dim">{e.observed_at ?? '—'}</span>}
            />
          ))}
        </Rows>
      </details>
    </div>
  )
}

export function RecurrenceSection({ cc }: { cc: CcState | null }) {
  if (cc === null) return null
  if (cc.state !== 'ok') return null
  const p = cc.payload
  if (p.recurrence === null) {
    return (
      <Section label="Recurring problems" tail="partial" wrapTail>
        <div className="a-sends-empty">
          This snapshot carries no recurrence ledger, so nothing recurring is shown. That is an absent section, not an empty one.
        </div>
      </Section>
    )
  }
  const r = p.recurrence
  const items = (r.items ?? []).filter(i => i.rank?.daily_pick).slice(0, 3)
  return (
    <Section wrapTail label="Recurring problems" tail={<span className="a-mono">as of {r.as_of ?? '—'}</span>}>
      <div className="a-sends-cap">
        Weekly result: <b>{r.weekly?.result ?? 'unknown'}</b>
        {r.weekly?.reason ? ` — ${r.weekly.reason}` : ''}
        {r.weekly?.provisional ? ' (provisional)' : ''}
      </div>
      {items.length === 0
        ? <div className="a-sends-empty">No family was picked for today.</div>
        : items.map(i => <RecurrenceRow key={i.recurrence_id} item={i} payload={p} />)}
      <div className="a-sends-cap">
        Splitting a mixed family into separate defects is NOT implemented: a family marked "not a majority" is still one row here, and one repair cannot close it.
        {r.lineage_summary ? ` Lineage ${r.lineage_summary.rules_version ?? 'lineage.v1'}: ${r.lineage_summary.independent ?? 0} independent, ${r.lineage_summary.derived ?? 0} derived, ${r.lineage_summary.unknown ?? 0} unknown.` : ''}
      </div>
    </Section>
  )
}

// ---- the hook the Overview mounts ---------------------------------------

/** One read per mount. `null` while it is in flight. */
export function useCampaignControl(): CcState | null {
  const [cc, setCc] = useState<CcState | null>(null)
  useEffect(() => {
    let live = true
    fetchPayload()
      .then(s => { if (live) setCc(s) })
      .catch(e => { if (live) setCc({ state: 'unavailable', reason: e instanceof Error ? e.message : 'control payload read failed' }) })
    return () => { live = false }
  }, [])
  return cc
}

/** The confirmed invitation figures the legacy instruments below borrow. */
export function ccPayload(cc: CcState | null): CcPayload | null {
  return cc && cc.state === 'ok' ? cc.payload : null
}

export function ccInvitationsForDay(p: CcPayload, client: Client, day: string): number | null {
  const rows = p.ranges.daily.filter(d => d.channel === 'invitation' && d.day === day && inClient(d.client_id, client))
  if (rows.length === 0) return null
  return rows.reduce((s, d) => s + d.sent, 0)
}

/** The invitation acceptance cohort for one window: accepted within 72h over
    the MATURED denominator. Returned together so a caller can never pair a
    confirmed numerator with a legacy denominator. */
export function ccAcceptCohort(p: CcPayload, client: Client, interval: string): { accepted: number; matured: number; rate: number | null } | null {
  const rows = p.ranges.rows.filter(r =>
    r.interval === interval && r.channel === 'invitation' && r.source_lane === '__all__'
    && inClient(r.client_id, client) && r.acceptance_cohort)
  if (rows.length === 0) return null
  let accepted = 0, matured = 0
  for (const r of rows) {
    accepted += r.acceptance_cohort?.accepted_within_72h ?? 0
    matured += r.acceptance_cohort?.matured_denominator ?? 0
  }
  // An empty denominator has no rate. It is never 0%.
  return { accepted, matured, rate: matured > 0 ? Math.round((100 * accepted) / matured) : null }
}

export function ccInvitationsInWindow(p: CcPayload, client: Client, timeframe: CcTimeframe, range: DateRange | null): number | null {
  const want = INTERVAL_OF[timeframe]
  const iv = p.ranges.intervals.find(i => i.name === want)
  if (!iv) return null
  if (timeframe === 'custom' && (!range || iv.from.slice(0, 10) !== range.from || iv.to.slice(0, 10) !== range.to)) return null
  const rows = p.ranges.rows.filter(r => r.interval === want && r.channel === 'invitation' && r.source_lane === '__all__' && inClient(r.client_id, client))
  if (rows.length === 0) return null
  return rows.reduce((s, r) => s + r.sent, 0)
}
