/* ==========================================================================
   src/lib/campaignControl.ts — the `cc03.v1` operator payload, typed and parsed.

   This is the ONLY place the app learns what a confirmed invitation is. Every
   figure the Control / Delivery / Recurring-problems sections draw comes from
   here; nothing in this file recomputes a delivery count, a cohort or a
   recurrence family — those are produced upstream (Run 01 `campaign_control`,
   Run 02 recurrence ledger) and integrated by `package/campaign_view`.

   Contract: goal-runs/campaign-control-03-operator-view-2026-09-13-out/
   02-PAYLOAD-CONTRACT.md. `parsePayload` implements the rejections that file
   names, including the privacy guard: the browser payload may never carry a
   `text` or a `source_locator` key, at any depth. A payload that fails to parse
   renders the `unknown` state with the contract error — it NEVER falls back to
   the legacy message-row counters for an invitation total.
   ========================================================================== */
import { supabase } from './supabase'
import { hasMock, mockFlag } from '../exp/v2c/mock'
import { loadScenario, SCENARIO_NAMES, type ScenarioName } from './ccScenarios'

export const PAYLOAD_VERSION = 'cc03.v1'
export const SCHEMA_VERSION = 1

export type CcStatus = 'healthy' | 'outside_window' | 'capacity_reached' | 'incident' | 'unknown'
export const CC_STATUSES: CcStatus[] = ['healthy', 'outside_window', 'capacity_reached', 'incident', 'unknown']

export type CcChannelName = 'invitation' | 'dm' | 'inmail'
export type CcPace = 'no_target' | 'on_track' | 'behind' | 'not_yet'
export type CcLiveness = 'fresh' | 'stale' | 'unknown'

export type CcFreshness = {
  data_age_s: number
  rule_version: 'frozen' | 'changed' | 'unknown'
  status: 'fresh' | 'stale' | 'degraded'
  as_of?: string | null
}

export type CcSession = {
  tz: string
  opens_at?: string | null
  closes_at?: string | null
  open_now: boolean
  weekday_rule?: string | null
  next_opening_at?: string | null
  elapsed_eligible_opportunities?: number | null
  expected_opportunities_total?: number | null
  progress_pct?: number | null
}

export type CcLaneRow = {
  source_lane: string
  confirmed_sent: number
  eligible_stock?: number | null
  executable_now?: boolean
  executable_reasons?: string[]
  evidence_ids?: string[]
}

export type CcChannel = {
  channel: CcChannelName
  confirmed_sent: number
  planned_by_now: number | null
  planned_by_now_reason?: string | null
  pace: CcPace
  executable_now?: boolean
  executable_reasons?: string[]
  eligible_stock?: number | null
  eligible_stock_scope?: string | null
  eligible_stock_by_pool?: Record<string, number> | null
  capacity?: {
    daily_cap?: number | null; daily_used?: number | null
    weekly_cap?: number | null; weekly_used?: number | null
    target?: number | null; target_status?: string | null
  } | null
  session?: CcSession | null
  freshness?: CcFreshness | null
  by_lane?: CcLaneRow[]
  evidence_ids?: string[]
}

export type CcIncident = {
  incident_key: string
  episode_id?: string | null
  channel?: string | null
  source_lane?: string | null
  failure_family?: string | null
  state: string
  severity?: string | null
  opened_at?: string | null
  last_seen_at?: string | null
  symptom?: string | null
  cause?: {
    status?: string | null
    explanation?: string | null
    underlying_restriction?: string | null
    alternatives_checked?: string[] | null
  } | null
  plain_cause?: string | null
  next_action?: { action?: string | null; owner?: string | null; earliest_safe_at?: string | null; prerequisites?: string[] } | null
  next_check_at?: string | null
  recovery_condition?: string | null
  recovery_evidence_ids?: string[]
  observed_failures?: number | null
  observed_distinct_prospects?: number | null
  evidence_ids?: string[]
  acknowledged?: boolean
  recovery_proven?: boolean
}

export type CcClient = {
  client_id: string
  label: string
  seat_id?: string | null
  status: CcStatus
  status_reason: string
  status_basis?: { evidence_ids?: string[]; rule_refs?: Array<{ fact: string; file?: string | null; line?: number | null }> } | null
  next_action?: { action?: string | null; owner?: string | null; earliest_safe_at?: string | null; prerequisites?: string[] } | null
  next_check_at?: string | null
  freshness?: CcFreshness | null
  invitation: CcChannel
  dm?: CcChannel | null
  inmail?: CcChannel | null
  incidents?: CcIncident[]
}

export type CcCohort = {
  invited?: number | null
  first_messaged?: number | null
  accepted_within_72h?: number | null
  replied_within_72h?: number | null
  matured_denominator: number | null
  maturity_h?: number | null
  rate_pct: number | null
}

export type CcRangeInterval = {
  name: string
  from: string
  to: string
  complete: boolean
  partial: boolean
  days: number
  source_coverage_note?: string | null
}

export type CcRangeRow = {
  client_id: string
  channel: CcChannelName
  source_lane: string
  interval: string
  sent: number
  unique_recipients?: number | null
  attempted?: number | null
  failed?: number | null
  phantom?: number | null
  blocked?: number | null
  unreconciled?: number | null
  replies_messages?: number | null
  replies_people?: number | null
  acceptance_cohort?: CcCohort | null
  reply_cohort?: CcCohort | null
  eligibility_at_time?: string | null
  rule_changes?: string[]
}

export type CcDailyRow = {
  client_id: string; channel: CcChannelName; day: string
  sent: number; phantom?: number | null; failed?: number | null; replies_people?: number | null
}

export type CcCompareRow = {
  client_id: string; channel: CcChannelName
  current: string; previous: string
  sent_current: number; sent_previous: number; delta: number
  accept_rate_current_pct: number | null
  accept_rate_previous_pct: number | null
  delta_pp: number | null
  small_cohort?: boolean
}

export type CcRanges = {
  tz: string
  intervals: CcRangeInterval[]
  rows: CcRangeRow[]
  daily: CcDailyRow[]
  compare: CcCompareRow[]
  notes: string[]
}

export type CcReceipt = {
  receipt_id: string
  artifact_path?: string | null
  original_source?: string | null
  observed_at?: string | null
  change_at?: string | null
  client_id?: string | null
  measured_result?: string | null
  supports_scope?: string | null
  closes_defect?: boolean
  reason?: string | null
}

export type CcPastFix = {
  scope: string
  state: 'proposed' | 'applied' | 'verified' | string
  recorded_at?: string | null
  later_recurrence?: boolean
  recovery_evidence_ids?: string[]
  receipts?: CcReceipt[]
}

export type CcRecurrenceItem = {
  recurrence_id: string
  title: string
  topic?: string | null
  failure_family?: string | null
  client_ids?: string[]
  status?: string | null
  relationship?: string | null
  relationship_verified?: boolean
  relationship_label_counts?: Record<string, number> | null
  relationship_is_majority?: boolean
  relationship_note?: string | null
  ledger?: { distinct_events: number; distinct_days: number; first_seen?: string | null; last_seen?: string | null } | null
  independent?: { distinct_events: number; distinct_days: number; first_seen?: string | null; last_seen?: string | null; derived_excluded?: number; unknown_lineage?: number } | null
  cause_confidence?: { value: number | null; basis?: string | null; meaning?: string | null; supporting_independent_events?: number | null; source_event_ids?: string[] } | null
  past_fixes?: CcPastFix[]
  recommended_fix?: string | null
  owner?: string | null
  success_measure?: string | null
  withheld?: boolean
  withheld_reason?: string | null
  rank?: { score_ledger?: number; score_independent?: number; daily_pick?: boolean } | null
  evidence_ref_ids?: string[]
}

export type CcRecurrence = {
  as_of?: string | null
  ledger_generated_at?: string | null
  weekly?: { result: string; repair?: string | null; provisional?: boolean; reason?: string | null; closest_misses?: unknown[] } | null
  weekly_independent?: { result?: string; reason?: string | null; changed_from_ledger?: boolean } | null
  items: CcRecurrenceItem[]
  lineage_summary?: { independent?: number; derived?: number; unknown?: number; rules_version?: string } | null
}

export type CcEvidenceRef = {
  id: string
  source_kind?: string | null
  provenance?: string | null
  observed_at?: string | null
  event_at?: string | null
  client_id?: string | null
  lineage?: 'independent' | 'derived' | 'unknown' | null
  derived_from?: string | null
  origin_run?: string | null
}

export type CcMonitor = {
  last_tick_at: string | null
  tick_interval_s?: number | null
  stale_after_s?: number | null
  liveness?: CcLiveness | null
  host?: string | null
}

export type CcCoverage = {
  degraded: boolean
  degraded_reasons: string[]
  sources?: unknown[]
  intervals?: unknown[]
  recurrence?: { coverage_statement?: string | null; exhaustive_conversation_review?: boolean; unexamined?: unknown[] } | null
}

export type CcPayload = {
  schema_version: number
  payload_version: string
  generated_at: string
  as_of: string
  source_mode?: string | null
  inputs?: Record<string, unknown> | null
  coverage: CcCoverage
  monitor: CcMonitor
  clients: CcClient[]
  ranges: CcRanges
  /** Explicitly `null` when this snapshot carries no recurrence ledger — the
      key must still be present, and the section then says so (the partial
      state). A payload MISSING the key is a contract error. */
  recurrence: CcRecurrence | null
  evidence: CcEvidenceRef[]
  privacy?: { contains_private_bodies?: boolean } | null
}

export type CcContractError = { contract_error: string }

export function isContractError(v: unknown): v is CcContractError {
  return typeof v === 'object' && v !== null && typeof (v as CcContractError).contract_error === 'string'
}

const err = (m: string): CcContractError => ({ contract_error: m })

/** Depth-first key scan. The browser payload must never carry a private body
    or a private path — one leaked key is the whole privacy gate (G1). */
function findPrivateKey(v: unknown, path = '$'): string | null {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const hit = findPrivateKey(v[i], `${path}[${i}]`)
      if (hit) return hit
    }
    return null
  }
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'text' || k === 'source_locator') return `${path}.${k}`
      const hit = findPrivateKey(val, `${path}.${k}`)
      if (hit) return hit
    }
  }
  return null
}

function cohortBad(c: CcCohort | null | undefined, where: string): string | null {
  if (!c) return null
  const den = c.matured_denominator
  if (c.rate_pct !== null && c.rate_pct !== undefined && (den === 0 || den === null || den === undefined)) {
    return `${where}: rate_pct ${c.rate_pct} with a matured_denominator of ${den === null || den === undefined ? 'none' : 0}`
  }
  return null
}

const DAY_MS = 86_400_000
const nextDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)

/** The first hole in `ranges.daily`, as a sentence, or null when it is whole. */
function findDailyGap(ranges: CcRanges): string | null {
  if (!Array.isArray(ranges.daily) || ranges.daily.length === 0) return null
  const series = new Map<string, Set<string>>()
  for (const d of ranges.daily) {
    if (!d || typeof d.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.day)) {
      return `ranges.daily carries a row with no usable day (${String(d?.day)})`
    }
    const key = `${d.client_id}/${d.channel}`
    const set = series.get(key) ?? new Set<string>()
    set.add(d.day)
    series.set(key, set)
  }
  const todayIv = (ranges.intervals ?? []).find(i => i.name === 'today')
  const expectedLast = todayIv
    ? new Intl.DateTimeFormat('en-CA', { timeZone: ranges.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(todayIv.to))
    : null
  for (const [key, set] of series) {
    const days = [...set].sort()
    const first = days[0], last = days[days.length - 1]
    for (let d = first; d !== last; d = nextDay(d)) {
      if (!set.has(d)) return `ranges.daily is missing ${d} for ${key} — a missing day is a hole in the read, not a zero`
    }
    if (expectedLast && last !== expectedLast) {
      return `ranges.daily for ${key} ends at ${last} but the "today" interval ends at ${expectedLast}`
    }
  }
  return null
}

/**
 * Parse and validate a `cc03.v1` browser payload.
 * Returns the payload, or a `{ contract_error }` the UI prints verbatim.
 */
export function parsePayload(json: unknown): CcPayload | CcContractError {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return err('payload is not an object')
  const p = json as Record<string, unknown>

  if (p.schema_version !== SCHEMA_VERSION) return err(`schema_version ${String(p.schema_version)} is not ${SCHEMA_VERSION}`)
  if (p.payload_version !== PAYLOAD_VERSION) return err(`payload_version ${String(p.payload_version)} is not ${PAYLOAD_VERSION}`)

  const priv = findPrivateKey(p)
  if (priv) return err(`private key in the browser payload at ${priv} — refusing to render`)

  for (const section of ['clients', 'ranges', 'recurrence'] as const) {
    if (!(section in p)) return err(`missing section: ${section}`)
  }
  if (!Array.isArray(p.clients)) return err('clients is not an array')
  if (!p.ranges || typeof p.ranges !== 'object') return err('ranges is not an object')
  if (p.recurrence !== null && (typeof p.recurrence !== 'object' || Array.isArray(p.recurrence))) {
    return err('recurrence is neither an object nor an explicit null')
  }

  const clients = p.clients as CcClient[]
  for (const c of clients) {
    if (!c || typeof c !== 'object') return err('a client is not an object')
    if (!CC_STATUSES.includes(c.status)) return err(`client ${String(c.client_id)}: status "${String(c.status)}" is not one of ${CC_STATUSES.join('|')}`)
    if (!c.invitation || typeof c.invitation !== 'object') return err(`client ${String(c.client_id)}: no invitation channel`)
    if (typeof c.invitation.confirmed_sent !== 'number' || !Number.isFinite(c.invitation.confirmed_sent)) {
      return err(`client ${String(c.client_id)}: invitation confirmed_sent is not a number`)
    }
  }

  const ranges = p.ranges as CcRanges
  if (!Array.isArray(ranges.rows)) return err('ranges.rows is not an array')
  if (!Array.isArray(ranges.intervals)) return err('ranges.intervals is not an array')
  for (const r of ranges.rows) {
    const bad = cohortBad(r.acceptance_cohort, `ranges.rows ${r.client_id}/${r.channel}/${r.interval} acceptance`)
      ?? cohortBad(r.reply_cohort, `ranges.rows ${r.client_id}/${r.channel}/${r.interval} reply`)
    if (bad) return err(bad)
  }

  /* A day missing from the daily series is a contract error, never a zero.
     A day with no sends is present carrying 0 and the coverage says the source
     was complete; a day that is simply ABSENT is a hole in the read, and
     rendering it as a gap (or summing around it) would understate the window
     without saying so. */
  const dailyGap = findDailyGap(ranges)
  if (dailyGap) return err(dailyGap)

  if (!p.monitor || typeof p.monitor !== 'object') return err('missing section: monitor')
  if (!p.coverage || typeof p.coverage !== 'object') return err('missing section: coverage')

  return {
    ...(p as unknown as CcPayload),
    ranges: {
      ...ranges,
      daily: Array.isArray(ranges.daily) ? ranges.daily : [],
      compare: Array.isArray(ranges.compare) ? ranges.compare : [],
      notes: Array.isArray(ranges.notes) ? ranges.notes : [],
    },
    evidence: Array.isArray(p.evidence) ? (p.evidence as CcEvidenceRef[]) : [],
  }
}

/**
 * Stale when the monitor's last tick is older than its own staleness budget.
 *
 * A SNAPSHOT is judged at its own instant, not at the reader's. A payload built
 * at 00:00:34Z whose monitor ticked at 00:00:00Z was fresh when it was taken and
 * is still a record of a fresh read seventeen hours later; measuring it against
 * wall clock turned every frozen scenario into "monitor stale" and forced every
 * seat to unverified. Only a `live` payload is judged against wall clock.
 */
export function monitorLiveness(
  payload: Pick<CcPayload, 'monitor'> & Partial<Pick<CcPayload, 'as_of' | 'source_mode'>>,
  now: number = Date.now(),
): CcLiveness {
  const m = payload.monitor
  if (!m || !m.last_tick_at) return 'unknown'
  const t = new Date(m.last_tick_at).getTime()
  if (!Number.isFinite(t)) return 'unknown'
  const budget = m.stale_after_s
  if (!budget || budget <= 0) return 'unknown'
  const asOf = payload.as_of ? Date.parse(payload.as_of) : NaN
  const at = payload.source_mode === 'snapshot' && Number.isFinite(asOf) ? asOf : now
  return (at - t) / 1000 > budget ? 'stale' : 'fresh'
}

/* `unknown` is an ATTENTION state, never a clear one: a reading we could not
   take must never render as a lane that is fine. `outside_window` carries no
   tone at all — a closed window is the absence of a signal, not a fault. */
export type CcTone = 'clear' | 'attention' | 'urgent' | 'quiet' | undefined
export const STATUS_TONE: Record<CcStatus, CcTone> = {
  healthy: 'clear',
  capacity_reached: 'attention',
  outside_window: undefined,
  incident: 'urgent',
  unknown: 'attention',
}
export const STATUS_WORD: Record<CcStatus, string> = {
  healthy: 'Healthy',
  capacity_reached: 'Capacity reached',
  outside_window: 'Outside window',
  incident: 'Incident',
  // The contract's word for the state, not the chip's word for what it means:
  // "UNVERIFIED unverified" said the same thing twice.
  unknown: 'Unknown',
}

// ---- adapters ------------------------------------------------------------

export type CcState =
  | { state: 'ok'; payload: CcPayload; source: 'local' | 'supabase' | 'scenario' }
  | { state: 'unavailable'; reason: string }
  | { state: 'error'; error: string }

export type CcEvidenceRecord = CcEvidenceRef & { source_locator?: string | null; text?: string | null }
export type CcEvidenceState =
  | { state: 'ok'; records: CcEvidenceRecord[] }
  | { state: 'unavailable'; reason: string }

const LOCAL_URL = (): string | undefined => {
  const env = import.meta.env as Record<string, string | boolean | undefined>
  return env.DEV && typeof env.VITE_CC_LOCAL_URL === 'string' && env.VITE_CC_LOCAL_URL
    ? env.VITE_CC_LOCAL_URL
    : undefined
}
const LOCAL_TOKEN = (): string => {
  const env = import.meta.env as Record<string, string | undefined>
  return typeof env.VITE_CC_LOCAL_TOKEN === 'string' ? env.VITE_CC_LOCAL_TOKEN : ''
}

async function getLocal(path: string): Promise<unknown> {
  const url = LOCAL_URL()
  if (!url) throw new Error('no local url')
  const r = await fetch(`${url.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${LOCAL_TOKEN()}` },
  })
  if (!r.ok) throw new Error(`local service answered ${r.status}`)
  return await r.json()
}

async function getSnapshot(kind: 'operator' | 'evidence'): Promise<unknown> {
  if (kind === 'operator') {
    // The view holds one row PER KIND (evidence, liveness, operator — that order). Without the
    // kind filter the first row is the private evidence payload, which the parser rightly
    // refuses (seen live 2026-09-13 after Run 04's first ticks). Ask for the operator row only.
    const v = await supabase
      .from('campaign_control_latest_v')
      .select('payload')
      .eq('kind', 'operator')
      .limit(1)
    if (!v.error && v.data && v.data.length > 0) return (v.data[0] as { payload: unknown }).payload
  }
  const t = await supabase
    .from('campaign_control_snapshots')
    .select('payload,generated_at')
    .eq('kind', kind)
    .order('generated_at', { ascending: false })
    .limit(1)
  if (t.error) throw new Error(t.error.message)
  if (!t.data || t.data.length === 0) throw new Error('no snapshot row')
  return (t.data[0] as { payload: unknown }).payload
}

function scenarioLever(): ScenarioName | null {
  const f = mockFlag('cc')
  if (f && (SCENARIO_NAMES as readonly string[]).includes(f)) return f as ScenarioName
  return null
}

/**
 * The operator payload. Picks, in order: a `?wbmock=cc:<scenario>` fixture, the
 * DEV local private service, then the authenticated Supabase snapshot. Every
 * failure is SOFT — it returns `unavailable` with the reason so the rest of the
 * Overview still renders its own instruments.
 */
export async function fetchPayload(): Promise<CcState> {
  const scenario = scenarioLever()
  if (scenario) {
    if (scenario === 'empty') return { state: 'unavailable', reason: 'no snapshot has been published yet' }
    try {
      const parsed = parsePayload(await loadScenario(scenario))
      if (isContractError(parsed)) return { state: 'error', error: parsed.contract_error }
      return { state: 'ok', payload: parsed, source: 'scenario' }
    } catch (e) {
      return { state: 'unavailable', reason: e instanceof Error ? e.message : 'scenario failed to load' }
    }
  }
  if (hasMock('fetch-error')) return { state: 'unavailable', reason: 'control payload read failed' }

  try {
    const raw = LOCAL_URL() ? await getLocal('/payload') : await getSnapshot('operator')
    const parsed = parsePayload(raw)
    if (isContractError(parsed)) return { state: 'error', error: parsed.contract_error }
    return { state: 'ok', payload: parsed, source: LOCAL_URL() ? 'local' : 'supabase' }
  } catch (e) {
    return { state: 'unavailable', reason: e instanceof Error ? e.message : 'control payload read failed' }
  }
}

/**
 * The private drill-down. Called ONLY from a user action (the "Private detail"
 * fold), never on mount: these records carry the locator and up to 400 chars of
 * the observation, and nothing fetches them speculatively.
 */
export async function fetchEvidence(): Promise<CcEvidenceState> {
  if (scenarioLever() || hasMock('fetch-error')) {
    return { state: 'unavailable', reason: 'private evidence is not served to a mock scenario' }
  }
  try {
    const raw = LOCAL_URL() ? await getLocal('/evidence') : await getSnapshot('evidence')
    const records = Array.isArray(raw)
      ? raw
      : (raw as { evidence?: unknown } | null)?.evidence
    if (!Array.isArray(records)) return { state: 'unavailable', reason: 'the private service returned no evidence list' }
    return { state: 'ok', records: records as CcEvidenceRecord[] }
  } catch (e) {
    return { state: 'unavailable', reason: e instanceof Error ? e.message : 'private evidence read failed' }
  }
}
