import { supabase } from './supabase'

// The call transcript reader (port #2, dashboard-port-audit.md).
//
// 96 calls are on record and none of them is reachable from the inbox. The job
// this file exists for is not "display a transcript". It is the two questions
// either side of a call: before one, what did we agree with this person last
// time; after one, what did I promise.
//
// Ported from personal-site (READ ONLY reference, never built, never committed,
// never deployed from here): hooks/useMeetings.ts (the table, the order, the
// tally) and sections/rebuilt/calls/MeetingCard.tsx:87-298 (the field
// semantics, the agent-JSON shapes, the screen-context split). Four things in
// that source are deliberately NOT carried across; each is named at its site
// below.
//
// READ ONLY, absolutely. No write, no RPC, no migration, no n8n. The source has
// four write paths on this surface (reclassify a meeting type, edit the sales
// script, mint an intake link, fire an n8n proposal build off a transcript) and
// none of them travels. `follow_up_draft` is text on a row and it is rendered
// as text: never sent, never queued, never approvable from here.

export type ActionItemRaw = string | Record<string, unknown>

export type CallRow = {
  id: string
  title: string
  date: string
  duration_minutes: number | null
  participants: string[] | null
  summary: string | null
  action_items: ActionItemRaw[] | null
  topics: ActionItemRaw[] | null
  follow_up_draft: string | null
  follow_up_sent: boolean | null
  source: string | null
  meeting_type: string | null
  brief: CallBrief | null
}

export type CallBrief = {
  pain?: string[] | null
  stack?: string[] | null
  decision_maker?: string | null
  budget_signal?: string | null
  timeline?: string | null
  triggers?: string[] | null
  objections?: string[] | null
  fit_score?: number | null
  proposal_hook?: string | null
  next_step?: string | null
  industry?: string | null
  automation_maturity?: string | null
  team_size?: string | null
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

// The list NEVER selects the body. Measured against the live table on
// 2026-08-22: the source's own `select('*')` at limit 200 returns 16,038,082
// bytes in 2.9s, because every row carries its full `transcript_text` plus a
// vector `embedding` plus the raw provider payload. The column list below
// returns 117,952 bytes in 0.45s for the same 96 rows. That is 136x, and it is
// why the raw body is a second, per-row read (fetchCallBody) rather than
// something the list drags along and then hides behind a disclosure.
const LIST_COLS = 'id, title, date, duration_minutes, participants, summary, action_items, '
  + 'topics, follow_up_draft, follow_up_sent, source, meeting_type, brief'

export async function fetchCalls(): Promise<CallRow[]> {
  const { data, error } = await supabase
    .from('transcripts')
    .select(LIST_COLS)
    .order('date', { ascending: false })
    .limit(200)
  if (error) throw error
  // `transcripts` carries no generated schema type in this client, same as
  // `calendar_events` in nextCall.ts: PostgREST-js cannot infer the select
  // shape and falls back to its safety-net error type, so this casts through
  // unknown exactly as every other ad-hoc read in this codebase does.
  return (data ?? []) as unknown as CallRow[]
}

export async function fetchCallBody(id: string): Promise<string> {
  const { data, error } = await supabase
    .from('transcripts')
    .select('transcript_text')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return ((data ?? {}) as unknown as { transcript_text?: string | null }).transcript_text ?? ''
}

// ---------------------------------------------------------------------------
// The agent-written shapes
// ---------------------------------------------------------------------------

/**
 * `action_items` and `topics` are jsonb arrays whose elements are JSON
 * STRINGS, not objects: the extractor stringifies each item before pushing it.
 * Measured on all 96 rows, every element of every populated array is a string
 * that parses to an object. The source handles this and so does this, but the
 * source's fallback for an unparseable string is `{ text: item }`, which then
 * falls through five different key guesses at render time. Here the parse is
 * done once, in one place, and the result is a typed record.
 */
export function parseAgentItem(item: ActionItemRaw): Record<string, unknown> {
  if (typeof item === 'string') {
    const s = item.trim()
    if (s.startsWith('{')) {
      try {
        const p = JSON.parse(s) as unknown
        if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>
      } catch { /* not JSON after all, fall through to the plain-text shape */ }
    }
    return { action: item }
  }
  return item && typeof item === 'object' ? item : {}
}

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim()
    return s === '' ? null : s
  }
  if (typeof v === 'number') return String(v)
  return null
}

function firstStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const s = str(o[k])
    if (s !== null) return s
  }
  return null
}

export type ActionItem = {
  action: string
  owner: string | null
  /** True when the owner string names Ivan. See ownerIsMine. */
  mine: boolean
  due: string | null
  why: string | null
}

// The only two owner values the extractor writes are "Ivan" and "Client"
// (measured across all 12 populated rows). The test is exact, case-folded, on a
// short closed set: an owner this file does not recognise is rendered verbatim
// and counted as not-mine rather than guessed at. Splitting "what I owe" out of
// "what they owe" is the whole point of reading this surface after a call, so
// it must never over-claim.
const MINE = new Set(['ivan', 'ivan manfredi', 'me', 'im'])

export function ownerIsMine(owner: string | null): boolean {
  return owner !== null && MINE.has(owner.trim().toLowerCase())
}

export function actionItems(row: Pick<CallRow, 'action_items'>): ActionItem[] {
  const raw = Array.isArray(row.action_items) ? row.action_items : []
  const out: ActionItem[] = []
  for (const el of raw) {
    const p = parseAgentItem(el)
    const action = firstStr(p, ['action', 'description', 'task', 'text'])
    if (action === null) continue
    const owner = firstStr(p, ['owner', 'assignee'])
    out.push({
      action,
      owner,
      mine: ownerIsMine(owner),
      due: firstStr(p, ['deadline', 'due', 'due_date']),
      why: firstStr(p, ['context', 'why']),
    })
  }
  return out
}

export type CallTopic = {
  title: string
  format: string | null
  status: string | null
  angle: string | null
}

export function callTopics(row: Pick<CallRow, 'topics'>): CallTopic[] {
  const raw = Array.isArray(row.topics) ? row.topics : []
  const out: CallTopic[] = []
  for (const el of raw) {
    const p = parseAgentItem(el)
    const title = firstStr(p, ['title', 'topic', 'name', 'text'])
    if (title === null) continue
    out.push({
      title,
      format: firstStr(p, ['post_format', 'format']),
      status: firstStr(p, ['status']),
      angle: firstStr(p, ['post_angle', 'angle']),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Who was on the call
// ---------------------------------------------------------------------------

/**
 * `participants` mixes two kinds of token: real addresses, bare display names,
 * and one kind of thing that is neither. Google Calendar books meeting rooms as
 * attendees, so rows carry addresses like
 * `c_1886b651hfvjsh7fi4o0fbvbe8baq@resource.calendar.google.com`. Those are
 * furniture, not people, and the source prints them straight into the attendee
 * line. Dropped here, by exact host, which is a rule and not a guess.
 */
export function people(participants: string[] | null | undefined): string[] {
  return (participants ?? [])
    .map(p => String(p).trim())
    .filter(p => p !== '')
    .filter(p => !p.toLowerCase().endsWith('@resource.calendar.google.com'))
}

// ---------------------------------------------------------------------------
// The body, and the thing hiding inside it
// ---------------------------------------------------------------------------

const SCREEN_MARK = '--- SCREEN CONTEXT'

/**
 * Some recordings append a screen-capture narration to the end of the spoken
 * transcript behind a marker line. Split so the reader can label the two, the
 * way the source does.
 */
export function splitBody(text: string): { spoken: string; screen: string | null } {
  const at = text.indexOf(SCREEN_MARK)
  if (at < 0) return { spoken: text.trim(), screen: null }
  const spoken = text.slice(0, at).trim()
  const rest = text.slice(at + SCREEN_MARK.length)
  // The marker line finishes with its own trailing dashes; drop to the end of
  // that line rather than assuming a fixed number of them.
  const nl = rest.indexOf('\n')
  const screen = (nl < 0 ? '' : rest.slice(nl + 1)).trim()
  return { spoken, screen: screen === '' ? null : screen }
}

// ---------------------------------------------------------------------------
// The tally
// ---------------------------------------------------------------------------

export type CallStats = {
  total: number
  week: number
  withActions: number
  meanMinutes: number
}

export function callStats(rows: CallRow[], now: Date = new Date()): CallStats {
  const weekAgo = now.getTime() - 7 * 86_400_000
  let week = 0
  let withActions = 0
  let minutes = 0
  for (const r of rows) {
    if (new Date(r.date).getTime() >= weekAgo) week++
    if (actionItems(r).length > 0) withActions++
    minutes += r.duration_minutes ?? 0
  }
  return {
    total: rows.length,
    week,
    withActions,
    meanMinutes: rows.length === 0 ? 0 : Math.round(minutes / rows.length),
  }
}

// ---------------------------------------------------------------------------
// The ranking, which is the actual feature
// ---------------------------------------------------------------------------

// 96 rows sorted by date buries the 12 that still carry unfinished business,
// and those 12 are the only ones with anything left to do in them. So the list
// is not one list. It is two, in this order, and each is newest first inside
// itself:
//
//   1. calls carrying action items       (12 measured)
//   2. everything else                   (84 measured)
//
// A weighted score was the alternative and it was rejected: a score mixes
// "has open business" with "is recent" into one number nobody can read back
// off the screen, and the answer to "which of these still needs me" has to be
// legible, not inferred. Two groups with a printed heading each is legible.
export type CallSegment = 'open' | 'recent' | 'all'

export const SEGMENT_LABEL: Record<CallSegment, string> = {
  open: 'With action items',
  recent: 'Last 7 days',
  all: 'All calls',
}

export function hasOpenBusiness(row: CallRow): boolean {
  return actionItems(row).length > 0
}

function timeOf(row: CallRow): number {
  const t = new Date(row.date).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * Unfinished business first, newest first inside each group. Stable for rows
 * that tie on both, because Array.prototype.sort is stable and the input order
 * is the database's own date ordering.
 */
export function rankCalls(rows: CallRow[]): CallRow[] {
  return [...rows].sort((a, b) => {
    const ab = hasOpenBusiness(a) ? 0 : 1
    const bb = hasOpenBusiness(b) ? 0 : 1
    if (ab !== bb) return ab - bb
    return timeOf(b) - timeOf(a)
  })
}

export function segmentCalls(
  rows: CallRow[], seg: CallSegment, now: Date = new Date(),
): CallRow[] {
  if (seg === 'open') return rankCalls(rows.filter(hasOpenBusiness))
  if (seg === 'recent') {
    const weekAgo = now.getTime() - 7 * 86_400_000
    return rankCalls(rows.filter(r => timeOf(r) >= weekAgo))
  }
  return rankCalls(rows)
}

// ---------------------------------------------------------------------------
// What a row says at rest
// ---------------------------------------------------------------------------

// The row in the list gets ONE line of substance, and it is chosen by what
// would change what he does next, not by which column happens to be longest.
// Next step beats an objection, an objection beats an action item, an action
// item beats the summary, and the summary beats nothing. The source leads with
// the summary unconditionally, which on a sales call is the least actionable
// sentence on the row.
export type LeadLine = { kind: 'next' | 'objection' | 'action' | 'summary'; text: string }

export const LEAD_LABEL: Record<LeadLine['kind'], string> = {
  next: 'Next step',
  objection: 'They pushed back on',
  action: 'You owe',
  summary: 'Summary',
}

export function leadLine(row: CallRow): LeadLine | null {
  const b = row.brief
  const next = str(b?.next_step)
  if (next) return { kind: 'next', text: next }
  const objection = (b?.objections ?? []).map(str).find((s): s is string => s !== null)
  if (objection) return { kind: 'objection', text: objection }
  const items = actionItems(row)
  const owed = items.find(i => i.mine) ?? items[0]
  if (owed) return { kind: 'action', text: owed.action }
  const summary = str(row.summary)
  if (summary) return { kind: 'summary', text: summary }
  return null
}

/** How many of the row's action items are Ivan's own. */
export function owedByMe(row: CallRow): number {
  return actionItems(row).filter(i => i.mine).length
}

// ---------------------------------------------------------------------------
// Linking a call to a prospect: measured, and refused
// ---------------------------------------------------------------------------
//
// The brief asked for a link between a call and the people the inbox already
// knows, on the condition that it is cheap and reliable, and for a refusal
// with a reason if it is only fuzzy name matching. It is only fuzzy name
// matching. Measured against the live database on 2026-08-22:
//
//   - `transcripts.calendar_event_id` is NULL on all 96 rows, so the
//     structural join that would have been exact does not exist in the data.
//   - `participants` holds 215 tokens across the 96 rows. 46 are addresses,
//     169 are bare display names.
//   - Of the 27 distinct addresses, ZERO match `outreach_prospects.email` and
//     ZERO match `prospect_email` on the inbox view. Most of them are
//     @arch.agency staff, who are a client's team and not prospects.
//   - Exact string equality on the 47 distinct display names hits 7 names,
//     and 2 of those 7 ("Jacky Zeigen", "Chas Waters") each resolve to TWO
//     different prospect rows. So even case-exact full-name equality is
//     ambiguous 29% of the time it fires at all.
//
// A wrong link between a call and a prospect is worse than no link: it would
// put words in a stranger's mouth on the one surface whose job is to tell him
// what was agreed. So no link ships, and this comment is the evidence rather
// than an opinion. What ships instead is the attendee list rendered as plain
// text, which is what the row actually knows.
