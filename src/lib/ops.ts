import { supabase } from './supabase'

// `task` is the one kind with no engine behind it at all: it is Ivan's own to-do,
// dictated to the WhatsApp assistant or written down by a Claude session. Done
// double-stamps (nothing is sent), Remove discards. It is deliberately absent from
// the Slack dispatcher's pick list (kind IN escalation/update/booking), so a task
// can never reach a channel — least of all the client-facing one `update` writes to.
// `leads_ballot` is the ARCH lead batch waiting on Davorin's eyes. It is raised only
// when the sendable queue has run down AND enough companies have piled up on the review
// page, and approving it posts ONE message to the ARCH channel FROM IVAN'S OWN ACCOUNT
// (user token), never from the app bot. Before 2026-09-07 a Monday cron posted this
// straight at the client with nothing in between; see the memory of that morning.
// `audn_recommendation` is the audience writer's weekly proposal (Run 06). It
// shares this table and NOTHING else with the kinds above: the Slack dispatcher
// picks `kind IN (escalation, update, booking, weekly_report)` so it can never
// reach a channel, and it is not an Ops card either — it is decided in Strategy,
// under the audience block, where the evidence it cites is on the same screen.
// See `isAudnKind` below for the one place that exclusion is written.
export type OpsKind = 'escalation' | 'update' | 'newsjack' | 'weekly_report' | 'comment_reply' | 'comment_outbound' | 'booking' | 'precall_email' | 'manual_invite' | 'task' | 'leads_ballot' | 'audn_recommendation' | 'conversation_takeover'

// One thing the ARCH drafter read before it answered. `public` is load-bearing:
// a public source may be quoted back at a commenter, a private one (a call note,
// an internal doc) may only inform the read, which is why the card prints the
// distinction rather than a flat list of titles.
export type ArchSource = {
  id: string
  source_type: string
  title: string
  public: boolean
}

// The row shape varies by kind (escalation carries a prospect, update carries
// receipts, newsjack carries the idea it will generate from), so context stays a
// loose bag rather than a fixed type.
export type OpsContext = {
  prospect_name?: string
  company?: string
  receipts?: string[]
  replay?: boolean
  // newsjack
  engine?: string
  idea_id?: string
  headline?: string
  source_url?: string
  expires_at?: string
  slot?: string
  incumbent_moved_to?: string
  // Stamped by the claim workflow when it stops at the draft (the default): the
  // post is in the board's review buffer and nothing was scheduled.
  buffered?: boolean
  // weekly_report
  week?: string
  report_url?: string
  invites?: number
  accepted?: number
  replied?: number
  calls_booked?: number
  impressions?: number
  engagers?: number
  moved?: number
  // Set only on a weekly_report card that a dedicated sender dispatches (ARCH):
  // the earliest it may post, ISO-8601 — 09:00 Monday Warsaw. Its presence is
  // what tells the card it dispatches at all; see weeklyReportDispatches.
  send_after?: string
  slack_bot_text?: string
  slack_ivan_text?: string
  // comment_reply
  comment_id?: string
  post_url?: string
  author_name?: string
  author_headline?: string
  comment_text?: string
  category?: string
  action?: string
  posted_at?: string
  // Stamped by rise-comment-draft: this body came from the button, not from the
  // pipeline, so the card says so before Ivan posts it.
  drafted_on_demand?: boolean
  // comment_reply · ARCH — stamped by `arch-comment-draft`. That drafter answers
  // ONLY with what Davorin has already said in public, so it returns a verdict
  // rather than a draft-or-nothing: `arch_outcome` is which of the four exits
  // this comment took, `arch_reason` the sentence that justifies it, `arch_basis`
  // (DRAFT only) the published line the reply rests on, and `arch_sources` what it
  // read — each marked public (quotable) or private (context only, never quoted).
  arch_outcome?: string
  arch_reason?: string
  arch_basis?: string
  // set when a flagged card (escalate / needs Davor) still carries a starter draft
  arch_starter?: boolean
  arch_caution?: string | null
  arch_sources?: ArchSource[]
  drafted_at?: string
  draft_version?: number
  draft_rounds?: number
  // Stamped by the card's own "Needs Davor" button: the operator read it and it
  // wants Davorin himself. Nothing is sent and the card stays open.
  needs_davor?: boolean
  needs_davor_at?: string
  // booking — someone booked off the client's own LinkedIn link. Slack-bound, same
  // dispatcher contract as escalation/update: approve here, it posts to the client
  // channel ~2 minutes later. `matched_prospect` false means the booker is not in our
  // outreach tables, so the brief has no lane history and the claim "from outbound"
  // is not ours to make.
  meeting_id?: string
  when_iso?: string
  when_str?: string
  brief_url?: string
  scan_url?: string
  booked_note?: string
  hubspot_url?: string
  matched_prospect?: boolean
  stamped?: boolean
  // manual_invite — Mattan hand-sent a calendar invite to a matched prospect
  // (BIDIRECTIONAL_SYNC in HubSpot, invisible to the attribution tracker by
  // design). The card is a to-do: stamp the attribution by hand, mark handled.
  prospect_id?: string
  meeting_title?: string
  matched_via?: string
  matched_value?: string
  // precall_email — 24h reminder drafted by the Precall Reminder → Ops Inbox
  // workflow off calendar_events. Approve here, the same workflow's sender lane
  // emails it from im@ivanmanfredi.com within ~5 minutes and stamps sent_at.
  google_event_id?: string
  invitee_email?: string
  invitee_name?: string
  first_name?: string
  subject?: string
  call_time?: string
  meeting_url?: string
  // comment_outbound (a draft comment on someone ELSE's post)
  feed_id?: string
  target_name?: string
  target_headline?: string
  post_excerpt?: string
  hook?: string
  approve_url?: string
  skip_url?: string
  // task — the ONE field the task row adds. 'YYYY-MM-DD', local-day semantics.
  // Written by the WhatsApp route (which resolves "due: monday" itself) or by a
  // Claude session. Absent = no due date, which is the normal case.
  due_at?: string
  // Where the row came from, so the row can carry a source chip without
  // guessing: 'whatsapp' | 'claude'.
  source?: string
  // leads_ballot — what the batch is and what state the lane was in when it was
  // raised. `posts_as` names the Slack identity the approved body goes out under,
  // so the card can never imply the bot is speaking for him.
  company_count?: number
  people?: number
  sendable?: number
  page_url?: string
  posts_as?: string
  // conversation_takeover — the server-authored proposal binding and the
  // viewer evidence the operator reviews before transferring this conversation.
  proposal_hash?: string
  linkedin_url?: string
  icp_score?: number
  viewed_at?: string
  [key: string]: unknown
}

// Newsjack cards are not Slack-bound: approving one fires generation on the matching
// engine and leaves the draft in that board's review buffer. Same table, different
// destination. (The queue-jump it used to do is now opt-in, off by default:
// integration_config.newsjack_auto_jump.)
export const ENGINE_LABEL: Record<string, string> = { ivan: 'your feed', risedtc: 'Rise', arch: 'Arch' }
export function engineLabel(clientId: string): string {
  return ENGINE_LABEL[clientId] ?? clientId
}

// WHOSE SEAT the comment goes out from. 2026-08-03, Ivan: "also says 'OUTBOUND
// your feed' when it should be Comments - Ivan or Mattan". A comment is posted
// BY a person from their account, so the card names the person; "your feed" is
// the newsjack/publishing register and stays there. Derived from the row's own
// client_id — never hardcoded, because both lanes render this card.
export const SEAT_LABEL: Record<string, string> = { ivan: 'Ivan', risedtc: 'Mattan Danino', arch: 'Davorin Smit' }
export function seatLabel(clientId: string): string {
  return SEAT_LABEL[clientId] ?? ENGINE_LABEL[clientId] ?? clientId
}

// Newsjack lift is ~24h and the card TTLs at 48h, so the countdown is the whole
// point of the card — a stale one is worth discarding rather than running.
export function expiresIn(iso?: string, now: number = Date.now()): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return 'expired'
  const h = Math.floor(ms / 3600000)
  if (h >= 1) return `${h}h left`
  return `${Math.max(1, Math.floor(ms / 60000))}m left`
}

export type OpsDraft = {
  id: string
  client_id: string
  kind: OpsKind
  slack_channel: string
  body: string
  context: OpsContext | null
  created_at: string
  approved_at: string | null
  sent_at: string | null
  send_blocked_reason: string | null
}

// Distinct from a dispatcher/guard block below — an operator-initiated
// discard is deliberately invisible everywhere (never re-shown as "blocked").
export const DISCARDED_REASON = 'discarded_by_operator'

// An audience proposal lives in this table and is NOT an ops card (Run 06
// CONTRACTS B2). It has no channel, no dispatcher and no approve button here:
// it is read and decided in Strategy, beside the audience numbers that produced
// it, and approving it calls a database function rather than sending anything.
//
// The exclusion is written ONCE, here, because `pendingOps` is what every Ops
// surface counts: the Ops screen's card list (wb/ops, screens/OpsScreen), the
// DM lane preview (`pendingDmLaneOps`, DraftsScreen, stockShell) and the v2c
// Shell badge all derive from this one filter. A row of this kind showing up as
// an unread ops card would be a to-do nobody can do from that screen.
export const AUDN_KIND = 'audn_recommendation'

export function isAudnKind(kind: OpsKind): boolean {
  return kind === AUDN_KIND
}

// Pending = nothing has happened to it yet — the only rows the operator acts on.
// Comment cards also age out: past the window they are noise, not a to-do.
export function pendingOps(rows: OpsDraft[], now = Date.now()): OpsDraft[] {
  return rows.filter(d =>
    !d.approved_at && !d.sent_at && !d.send_blocked_reason
    && !isAudnKind(d.kind) && !isStaleComment(d, now) && !isExpiredNewsjack(d, now))
}

// THE OPS NUMBER (rebuild, blueprint v3 decision 11). Approvals waiting and
// tasks, every kind `pendingOps` keeps, EXCEPT that comment ideas
// (comment_outbound) count only up to what the poster can still post today:
// it posts 3 a day, so idea 4 and on is not work for today. They sit in their
// own counted fold on Ops instead ("rn i mainly use it for notifications
// important, tasks, and approval pending items", 31 Aug; comments "i approve
// in ops", 22 Sep).
export const COMMENT_IDEAS_PER_DAY = 3

const warsawDay = (t: number | string) =>
  new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })

export function opsBadge(rows: OpsDraft[], now = Date.now()): { n: number; ideasFolded: number } {
  const pend = pendingOps(rows, now)
  const today = warsawDay(now)
  const postedToday = rows.filter(d =>
    d.kind === 'comment_outbound' && d.approved_at && warsawDay(d.approved_at) === today).length
  const room = Math.max(0, COMMENT_IDEAS_PER_DAY - postedToday)
  const ideas = pend.filter(d => d.kind === 'comment_outbound').length
  const counted = Math.min(ideas, room)
  return { n: pend.length - ideas + counted, ideasFolded: ideas - counted }
}

// A newsjack past its `expires_at` is a story that has moved on: the card's own
// countdown already reads "expired", and the lift it was written for is gone.
// It leaves the Ops number the same way a stale comment does, so the icon never
// counts a to-do whose only right answer is to let it go. Unknown expiry is
// not expiry.
export function isExpiredNewsjack(d: OpsDraft, now = Date.now()): boolean {
  if (d.kind !== 'newsjack') return false
  const t = new Date(d.context?.expires_at ?? '').getTime()
  return Number.isFinite(t) && t <= now
}

// An ops read that comes back EMPTY over a board that had rows is a failure,
// not a cleared queue: `fetchOpsDrafts` returns the newest 300 rows in every
// state, so the table never legitimately shrinks to nothing between two reads.
export function emptyReadOverRows(prev: OpsDraft[], next: OpsDraft[]): boolean {
  return prev.length > 0 && next.length === 0
}

// Ask 12 — "i see in dms that its showing drafts that arent dm they are comment
// drafts... those go in Ops". The DM lane's ops preview listed EVERY pending
// ops row, and the live queue on 2026-08-03 was exactly 2 pending rows, BOTH
// kind=comment_outbound (one ivan, one risedtc) — so the "DMs" surface was
// showing only comment drafts. Comment kinds are Ops cards (OpsScreen renders
// and approves them); the DM lane shows the rest. outreach_messages itself
// carries no comment rows (live message_type mix: connection_note / dm /
// inmail / email / email_reply / audit_delivery), so this is the one source of
// the leak.
export function isCommentKind(kind: OpsKind): boolean {
  return kind === 'comment_reply' || kind === 'comment_outbound'
}

export function pendingDmLaneOps(rows: OpsDraft[], now = Date.now()): OpsDraft[] {
  return pendingOps(rows, now).filter(d => !isCommentKind(d.kind))
}

// ---------------------------------------------------------------------------
// TASKS (UX v2, 2026-08-30)
// ---------------------------------------------------------------------------
//
// 2026-08-29, Ivan, on the task card shipped the day before: "u made it a
// shitty text dude make it a more crm thing with thick or something... better
// functioning". A task is not a draft — there is nothing to edit before it is
// sent, because nothing is ever sent. It is a LIST ITEM: one line you read, a
// circle you tick, and it is gone.
//
// So a task row is derived, not stored: `body` keeps its one-column shape
// (first line = the title, the rest = the detail), and the only NEW field is
// `context.due_at`. That is deliberately the jsonb bag and not a new column —
// `context` is already free-form on this table, the board reads all 300 rows
// and sorts in memory, and nothing server-side ever filters on a due date, so
// a column would buy a migration and no query.

export function isTaskKind(kind: OpsKind): boolean {
  return kind === 'task'
}

// The first non-empty line. A title is what he scans, so it is capped at a
// readable length rather than allowed to become the whole paragraph: a body
// dictated as one long sentence still gets a title and a detail line.
export const TASK_TITLE_MAX = 90

export function taskTitle(body: string): string {
  const first = (body ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? ''
  if (first.length <= TASK_TITLE_MAX) return first
  // Cut on the last word boundary inside the cap, never mid-word.
  const cut = first.slice(0, TASK_TITLE_MAX)
  const sp = cut.lastIndexOf(' ')
  return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…'
}

// Everything the title did not take. When the title was truncated the detail
// line has to start from the REMAINDER of that first line, or the words between
// the cap and the newline vanish from the card entirely.
export function taskDetails(body: string): string {
  const lines = (body ?? '').split('\n')
  const i = lines.findIndex(l => l.trim().length > 0)
  if (i === -1) return ''
  const first = lines[i].trim()
  const rest = lines.slice(i + 1).join('\n').trim()
  if (first.length <= TASK_TITLE_MAX) return rest
  const head = taskTitle(body).replace(/…$/, '')
  const tail = first.slice(head.length).trim()
  return [tail, rest].filter(Boolean).join('\n')
}

// `context.due_at` is a DATE, written 'YYYY-MM-DD'. Date-only on purpose: every
// producer of a task (WhatsApp dictation, a Claude session) means "that day",
// and a timestamp would render a 00:00 UTC due date as the day before for half
// the world. A full ISO timestamp is accepted and truncated, so a producer that
// writes one is not silently dropped.
export function taskDue(d: OpsDraft): string | null {
  const raw = d.context?.due_at ?? d.context?.due
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

// Local-day arithmetic, not UTC: "due today" has to mean the day Ivan is
// looking at the screen on.
export function localDay(now: number | Date = Date.now()): string {
  const t = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  return Math.round((b - a) / 86400_000)
}

export type DueLabel = { text: string; tone: 'over' | 'now' | 'soon' | 'later' }

// What the chip says. Overdue and today are the only two tones that get to be
// loud — a task due next week is information, not an alarm.
export function dueLabel(due: string, now: number | Date = Date.now()): DueLabel | null {
  const today = localDay(now)
  const n = daysBetween(today, due)
  if (!Number.isFinite(n)) return null
  if (n < -1) return { text: `${-n} days late`, tone: 'over' }
  if (n === -1) return { text: 'yesterday', tone: 'over' }
  if (n === 0) return { text: 'today', tone: 'now' }
  if (n === 1) return { text: 'tomorrow', tone: 'soon' }
  if (n <= 6) {
    const wd = new Date(`${due}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    return { text: wd, tone: 'soon' }
  }
  const md = new Date(`${due}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return { text: md, tone: 'later' }
}

// Where the task came from, and NOTHING when we do not know. A source chip that
// guesses "Claude" for every unstamped row would be a claim, not a label.
export function taskSource(d: OpsDraft): string | null {
  const s = d.context?.source
  if (s === 'whatsapp') return 'WA'
  if (s === 'claude' || s === 'claude_session') return 'Claude'
  return null
}

// The task list's own queue. Sorted the way a list is read: overdue and dated
// first (soonest at the top), undated after them, newest of those first.
export function pendingTasks(rows: OpsDraft[], now = Date.now()): OpsDraft[] {
  return pendingOps(rows, now)
    .filter(d => isTaskKind(d.kind))
    .sort((a, b) => {
      const da = taskDue(a), db = taskDue(b)
      if (da && db) return da.localeCompare(db) || b.created_at.localeCompare(a.created_at)
      if (da) return -1
      if (db) return 1
      return b.created_at.localeCompare(a.created_at)
    })
}

// Ticked today, most recent first — the strip that gives the tick a receipt.
// Scoped to TODAY on purpose: a permanent done-pile is a second list to read.
export function doneTodayTasks(rows: OpsDraft[], now = Date.now()): OpsDraft[] {
  const today = localDay(now)
  return rows
    .filter(d => isTaskKind(d.kind) && d.sent_at !== null && localDay(new Date(d.sent_at!)) === today)
    .sort((a, b) => b.sent_at!.localeCompare(a.sent_at!))
}

// Done, from the list. Same writer as the card's Done button: the double-stamp
// is load-bearing (approved_at alone strands the row in `claiming` forever,
// waiting on a dispatcher that does not exist for this kind), and the body is
// re-sent unchanged because a list row has no editor.
export async function completeTask(d: OpsDraft): Promise<void> {
  return approveWeeklyReport(d.id, d.body)
}

// Approved but not yet done. Slack rows sit here for ~2 minutes; a newsjack sits here
// while it generates and QA-gates (it clears once the draft is in the buffer), which
// can run to an hour — without this group the card would just vanish on approve and
// look like nothing happened.
export function claimingOps(rows: OpsDraft[]): OpsDraft[] {
  return rows
    .filter(d => d.approved_at && !d.sent_at && !d.send_blocked_reason)
    .sort((a, b) => b.approved_at!.localeCompare(a.approved_at!))
}

// Sent = already dispatched to Slack. Read-only, most-recent-first, capped.
export function sentOps(rows: OpsDraft[], limit = 10): OpsDraft[] {
  return rows
    .filter(d => d.sent_at !== null)
    .sort((a, b) => b.sent_at!.localeCompare(a.sent_at!))
    .slice(0, limit)
}

// Blocked = the dispatcher (or a guard) refused to send it — never includes
// operator discards, which stay hidden.
export function blockedOps(rows: OpsDraft[]): OpsDraft[] {
  return rows
    .filter(d => d.send_blocked_reason && d.send_blocked_reason !== DISCARDED_REASON)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// W6-2: an explicit column list, not `select=*`. The table has exactly these
// ten columns (db/015_ops_drafts.sql) so the rows are unchanged; naming them
// is what stops the request from being schema-fragile (a future wide column
// added to the table would otherwise ride along on every load unasked).
const OPS_DRAFT_COLUMNS = 'id,client_id,kind,slack_channel,body,context,created_at,approved_at,sent_at,send_blocked_reason'

export async function fetchOpsDrafts(): Promise<OpsDraft[]> {
  const { data, error } = await supabase.from('ops_drafts')
    .select(OPS_DRAFT_COLUMNS)
    // The audience kind is filtered at the READ as well as at `pendingOps`.
    // One rule (`AUDN_KIND`), two locks: `pendingOps` is what the card lists
    // and the badges count, but this fetch also feeds `sentOps`, `claimingOps`
    // and `blockedOps` — and an APPROVED proposal carries `sent_at` (the
    // publish RPC stamps both), so without this filter it would surface in the
    // Ops screen's Sent list, labelled as something it is not.
    .neq('kind', AUDN_KIND)
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) throw error
  return data as OpsDraft[]
}

/**
 * A task from a bot message's `task` pill (spec section 3).
 *
 * Ops IS his task list, so a pill that says "make this a task" writes exactly
 * the row the WhatsApp dictation and the Claude session already write: kind
 * 'task', client 'ivan', the title as the first line, the detail under it.
 * `TaskList` reads `taskTitle(body)`, so the shape of the body IS the contract
 * and nothing here invents a second one.
 *
 * `card_key` is `bot:<turn id>:<index>`, which makes a double tap on the same
 * pill identifiable in the table rather than merely duplicated. The pill also
 * disables itself on success, which is the cheap half of the same guard.
 *
 * Never any other kind: the spec says so in one sentence and this is the only
 * place that could break it.
 */
export async function createBotTask(
  turnId: string, index: number, title: string, body?: string,
): Promise<boolean> {
  const head = (title ?? '').trim()
  if (!head) return false
  const detail = (body ?? '').trim()
  try {
    const { error } = await supabase.from('ops_drafts').insert({
      client_id: 'ivan',
      kind: 'task',
      body: detail ? `${head}\n\n${detail}` : head,
      context: { source: 'claude', card_key: `bot:${turnId}:${index}` },
    })
    return !error
  } catch {
    return false
  }
}

// Approve stamps the (possibly edited) body and approved_at together, same
// shape as outreach_messages' approveDraft — the n8n dispatcher picks up any
// row with approved_at set and posts it to Slack within ~2 minutes.
export async function approveOpsDraft(id: string, editedBody: string, kind: OpsKind): Promise<void> {
  if (kind === 'conversation_takeover') {
    throw new Error('Conversation takeovers require the dedicated approval route.')
  }
  const { error } = await supabase.from('ops_drafts')
    .update({ body: editedBody, approved_at: new Date().toISOString() })
    .eq('id', id).is('sent_at', null)
  if (error) throw error
}

export type ConversationTakeoverApproval = {
  ok: boolean
  reason?: string
  thread_id?: string
  draft_id?: string
}

export const TAKEOVER_SENDING_HELD = 'Draft ready. Sending is held while LinkedIn checks finish.'

export async function fetchConversationTakeoverReadiness(draftId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('conversation_agent_takeover_readiness', { p_draft_id: draftId })
  if (error) throw error
  return data?.ready === true
}

export async function approveConversationTakeover(
  draftId: string,
  expectedHash: string,
  editedBody: string,
): Promise<ConversationTakeoverApproval> {
  const body = editedBody.trim()
  if (!expectedHash) throw new Error('This proposal has no approval hash. Refresh Ops before approving it.')
  if (!body) throw new Error('Write an opener before approving the takeover.')
  if (body.length > 400) throw new Error('The opener must be 400 characters or fewer.')

  const { data, error } = await supabase.rpc('conversation_agent_approve_takeover', {
    p_draft_id: draftId,
    p_expected_hash: expectedHash,
    p_body: editedBody,
  })
  if (error) throw error
  const result = data as ConversationTakeoverApproval | null
  if (!result?.ok) throw new Error(takeoverApprovalError(result?.reason))
  return result
}

function takeoverDiscardError(reason?: string): string {
  if (reason === 'operator_denied') return 'Only an authenticated operator can skip a takeover.'
  if (reason === 'not_found') return 'This takeover proposal no longer exists. Refresh Ops.'
  if (reason === 'proposal_hash_mismatch') return 'This takeover proposal changed. Refresh Ops before skipping it.'
  if (reason === 'already_approved') return 'This takeover was already approved. Refresh Ops.'
  return reason ? `Takeover was not skipped: ${reason.replaceAll('_', ' ')}.` : 'Takeover was not skipped.'
}

export async function discardConversationTakeover(
  draftId: string,
  expectedHash: string,
): Promise<ConversationTakeoverApproval> {
  if (!expectedHash) throw new Error('This proposal has no approval hash. Refresh Ops before skipping it.')
  const { data, error } = await supabase.rpc('conversation_agent_discard_takeover', {
    p_draft_id: draftId,
    p_expected_hash: expectedHash,
  })
  if (error) throw error
  const result = data as ConversationTakeoverApproval | null
  if (!result?.ok) throw new Error(takeoverDiscardError(result?.reason))
  return result
}

export function takeoverApprovalError(reason?: string): string {
  if (reason === 'operator_denied') return 'Only an authenticated operator can approve a takeover.'
  if (['sending_held', 'account_not_ready', 'release_not_ready', 'new_chat_unverified', 'takeover_review_disabled'].includes(reason ?? '')) return TAKEOVER_SENDING_HELD
  if (reason === 'invalid_body') return 'The opener is invalid. Keep it under 400 characters and try again.'
  if (reason === 'not_found') return 'This takeover proposal no longer exists. Refresh Ops.'
  if (reason === 'proposal_discarded') return 'This takeover proposal was already skipped.'
  if (reason === 'proposal_expired') return 'This takeover proposal expired. Refresh Ops for a current draft.'
  if (reason === 'proposal_hash_mismatch') return 'This takeover proposal changed. Refresh Ops before approving it.'
  if (reason?.startsWith('stale_')) return 'The viewer or conversation changed. Refresh Ops for a current proposal.'
  return reason ? `Takeover was not approved: ${reason.replaceAll('_', ' ')}.` : 'Takeover was not approved.'
}

// A weekly_report card either dispatches or it does not, and the CARD says
// which — never the client id, never a hardcoded list here.
//
// The ARCH shape carries `send_after` (the 09:00 Monday Warsaw gate) and a
// dedicated n8n sender (I1Kp0jSPBWF9ZP0A) posts it as two messages: the report
// from the app, then Ivan's read from his own account ten seconds later. Those
// cards must stamp approved_at ALONE — the sender's predicate is
// `approved_at NOT NULL AND sent_at IS NULL`, so double-stamping hides the row
// from the writer built to send it. That is exactly what happened to the 0830
// ARCH report on 2026-09-07: approved, stamped sent, never posted, sent by hand.
//
// The RISE shape carries no gate and no sender: Ivan still pastes it from
// Mattan's seat, so approving IS the send and both stamps go down together
// (approved_at alone would strand that card in Working forever).
export function weeklyReportDispatches(d: OpsDraft): boolean {
  return d.kind === 'weekly_report' && typeof d.context?.send_after === 'string'
}

// When a dispatching card is allowed out. null = no gate, it goes on the next
// pass. The sender runs every minute, so "approved after the gate" means now.
export function weeklySendAfter(d: OpsDraft): number | null {
  const s = d.context?.send_after
  if (typeof s !== 'string') return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}
// A comment older than this is dead: the post has left the feed and a reply lands
// on nobody (Ivan, 2026-07-30). Same number the card writer uses.
export const MAX_COMMENT_AGE_DAYS = 4

export function isStaleComment(d: OpsDraft, now = Date.now()): boolean {
  if (d.kind !== 'comment_reply' && d.kind !== 'comment_outbound') return false
  const t = new Date(d.context?.posted_at ?? 0).getTime()
  if (!Number.isFinite(t) || t === 0) return false   // unknown age is not staleness
  return now - t > MAX_COMMENT_AGE_DAYS * 86400_000
}

// comment_outbound, ivan lane: approving opens the n8n gate webhook in a new tab -
// the five poster gates (arming flag, freshness, window, caps, cooldown) + jitter
// still own the actual LinkedIn write, and the tab shows their plain-text verdict
// ("posting in ~6 min" / "cooldown active"). The card itself double-stamps like
// weekly_report because no dispatcher writes sent_at for this kind.
// risedtc lane: context has no approve_url - the caller copies the body instead
// and Ivan hand-posts from Mattan's seat. Same double-stamp.
export function outboundApproveUrl(d: OpsDraft): string | null {
  if (d.kind !== 'comment_outbound') return null
  const u = d.context?.approve_url
  return typeof u === 'string' && u.startsWith('https://') ? u : null
}

// Best-effort cancel of the underlying feed row when a card is discarded - if it
// fails the row just expires on its own 5-day gate, so fire-and-forget is safe.
export function outboundSkipUrl(d: OpsDraft): string | null {
  if (d.kind !== 'comment_outbound') return null
  const u = d.context?.skip_url
  return typeof u === 'string' && u.startsWith('https://') ? u : null
}

// comment_reply is the one kind that posts to LinkedIn. The edge function owns
// the whole act: it re-reads the thread first and refuses if the client already
// answered, so pressing approve twice cannot double post. Everything is stamped
// server-side, which is why nothing here writes to the table.
async function callCommentReplyFn(payload: Record<string, unknown>) {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('not signed in')
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rise-comment-reply`,
    {
      method: 'POST',
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out?.ok === false) {
    // The ARCH post-leg gate answers with a reason worth reading, not just a code.
    const why = Array.isArray(out?.strikes) && out.strikes.length
      ? `Not posted: ${out.strikes.map((k: { why?: string }) => k.why).filter(Boolean).join('; ')}`
      : out?.detail ? `Not posted: ${out.detail}` : null
    throw new Error(why ?? out?.error ?? `post failed (${res.status})`)
  }
  return out
}

// True when what is about to post is not the ARCH drafter's own untouched draft.
export function isHandWritten(d: OpsDraft, finalBody: string): boolean {
  if (d.client_id !== 'arch') return false
  return archOutcome(d) !== 'DRAFT' || finalBody.trim() !== (d.body ?? '').trim()
}

export async function postCommentReply(
  id: string, editedBody: string, tagCommenter = true, handWritten = false,
): Promise<{ posted: boolean; reason?: string; tagged?: boolean; tagVerified?: boolean | null }> {
  const out = await callCommentReplyFn({
    ops_draft_id: id, body: editedBody, tag_commenter: tagCommenter,
    // ARCH post leg (2026-09-17): a machine draft must carry the drafter's DRAFT
    // verdict; text Ivan typed or edited says so and still passes the range backstop.
    ...(handWritten ? { hand_written: true } : {}),
  })
  return {
    posted: out.posted === true,
    reason: out.reason,
    tagged: out.tagged === true,
    // true = mention entity confirmed on LinkedIn; false = posted as plain text
    // (out-of-network profiles resolve to nothing); null/undefined = unverified.
    tagVerified: typeof out.tag_verified === 'boolean' ? out.tag_verified : null,
  }
}

// Likes THEIR comment from the client seat. Works on a card in any state -
// liking is independent of replying, and a repeat like is a LinkedIn no-op.
// The function stamps context.liked so the button survives refreshes.
export async function likeComment(id: string): Promise<void> {
  await callCommentReplyFn({ ops_draft_id: id, action: 'react' })
}

// The tag needs the commenter's provider id, captured at pull time. Old rows
// (or degraded pulls) may not have it - the card hides the toggle then.
export function canTagCommenter(d: OpsDraft): boolean {
  return d.kind === 'comment_reply'
    && Boolean(d.context?.comment_id)
    && Boolean(d.context?.author_name)
}

// A comment card with an empty body is one the pipeline refused to draft: either
// the category is escalate-only (PEER_ELABORATION, CHALLENGE, anything
// judgement-bearing) or every candidate failed the voice gates. Both are honest
// states, and both are worth a starting point when Ivan asks for one — hence the
// button. Nothing else in the app can be drafted on demand.
export function canGenerateDraft(d: OpsDraft): boolean {
  return d.kind === 'comment_reply'
    && !d.body.trim()
    && !d.approved_at && !d.sent_at && !d.send_blocked_reason
    && Boolean(d.context?.comment_id)
}

// The one decision that separates "post this to LinkedIn" from "close the card
// and post nothing". It is about the EDITOR, not the stored row: an escalate card
// arrives empty, but the operator can type a reply into it by hand, and then the
// card has something to post. Reading the stored body here meant a hand-written
// reply landed on "Mark handled", which posts nothing AND blanks what was typed
// (Ivan hit this on the Samuel Adeyinka card, 08-31).
export function isCloseOnlyComment(d: OpsDraft, editorBody: string): boolean {
  return d.kind === 'comment_reply' && !d.body.trim() && !editorBody.trim()
}

export type GeneratedDraft = {
  drafted: boolean
  draft?: string
  // Why the engine refused, in plain lines, or "he already answered".
  why?: string[]
  reason?: string
  category_auto_eligible?: boolean
  // The engine keeps its refused candidates on the card and reasons from them on
  // the next call (rise-comment-draft, 2026-09-02). True = another round is owed.
  can_continue?: boolean
  rounds?: number
  closest?: string | null
  // arch-comment-draft only — the verdict, written to the row's context too.
  outcome?: ArchOutcome
  category?: string
  basis?: string
  sources?: ArchSource[]
  // The drafter could not run (proxy cap, model timeout). NOTHING was written and
  // nothing was decided: this is neither a draft nor a refusal on the merits, and
  // the card must not present it as either. Pressing again is the whole fix.
  transient?: boolean
  error?: string
}

// What the card says when the drafter never got to answer. It is not a refusal,
// so it never renders on the "Refused:" line.
export const DRAFTER_BUSY = 'drafter busy, nothing written, try again'

// Each lane has its own drafter, because each answers to a different person's
// public record: risedtc/ivan speak in Mattan's voice from the RISE corpus,
// `arch` answers only with what Davorin has said in public. Routing on the row's
// own client_id is what stops an ARCH card being handed to a function that
// refuses every client but risedtc.
export const COMMENT_DRAFT_FN: Record<string, string> = { arch: 'arch-comment-draft' }

export function commentDraftFn(clientId?: string): string {
  return (clientId && COMMENT_DRAFT_FN[clientId]) ?? 'rise-comment-draft'
}

// The four exits the ARCH drafter is allowed to take. Three of them leave the
// body empty on purpose, and the card has to name which one it is — an empty
// editor with no verdict reads as a drafter that broke.
export type ArchOutcome = 'DRAFT' | 'NEEDS_DAVOR' | 'ESCALATE' | 'HANDLED'

const ARCH_OUTCOMES: ArchOutcome[] = ['DRAFT', 'NEEDS_DAVOR', 'ESCALATE', 'HANDLED']

// The stamped verdict on an ARCH comment card, or null when there is none to
// read. Null for every other lane and every other kind: this is ARCH furniture,
// and a RISE card must never grow it from a stray context key.
export function archOutcome(d: OpsDraft): ArchOutcome | null {
  if (d.kind !== 'comment_reply' || d.client_id !== 'arch') return null
  const raw = d.context?.arch_outcome
  if (typeof raw !== 'string') return null
  const up = raw.trim().toUpperCase() as ArchOutcome
  return ARCH_OUTCOMES.includes(up) ? up : null
}

// What the operator reads on the chip. ESCALATE says who answers instead, because
// "Escalate" alone reads as a queue it goes into rather than a thing he does.
export function archOutcomeLabel(outcome: ArchOutcome): string {
  switch (outcome) {
    case 'DRAFT': return 'Draft'
    case 'NEEDS_DAVOR': return 'Needs Davor'
    case 'ESCALATE': return 'Escalate: answer by hand'
    case 'HANDLED': return 'No reply needed'
  }
}

// The sources block is a receipt, not a bibliography: five is what fits on a
// phone card, and anything beyond it is read on the post itself.
export const ARCH_SOURCES_MAX = 5

export function archSources(d: OpsDraft, max: number = ARCH_SOURCES_MAX): ArchSource[] {
  const raw = d.context?.arch_sources
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is ArchSource => Boolean(s) && typeof s === 'object' && typeof (s as ArchSource).title === 'string')
    .slice(0, max)
}

// How many continuation calls one press of the button makes on its own. Each call
// runs as many stages (generate, QA, reason again) as fit its clock — one model
// call takes ~60s through the proxy today, so a call is usually one or two stages
// and a full two-round rethink is up to six. The button never gives up before the
// engine has spent its rounds.
export const DRAFT_CONTINUE_MAX = 6

// Runs the SAME drafter the pipeline runs (same content_prompts rows, same
// exemplars, same RAG corpus, same gates), for one card, now. It writes the body
// and nothing else — publishing still goes through postCommentReply, which
// re-reads the thread first. A refusal returns its reasons instead of a draft.
//
// `clientId` picks the lane's drafter (see commentDraftFn). It is optional only
// so the older stock shell keeps compiling; every ARCH call site MUST pass the
// row's client_id or the card is handed to a function that will refuse it.
export async function generateCommentDraft(id: string, clientId?: string): Promise<GeneratedDraft> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('not signed in')
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${commentDraftFn(clientId)}`,
    {
      method: 'POST',
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ops_draft_id: id }),
    },
  )
  const out = await res.json().catch(() => ({}))
  // Read BEFORE the error guard, and before the continue loop can act on it: a
  // transient bail wrote nothing and decided nothing. Treating it as a throw
  // paints a red failure on the card; treating it as a refusal would tell the
  // operator the drafter judged this comment when it never ran at all. Both are
  // lies, so it comes back as its own state with the loop stopped.
  if (out?.transient === true) {
    return { ...out, drafted: false, can_continue: false, transient: true } as GeneratedDraft
  }
  if (!res.ok || out?.ok === false) throw new Error(out?.error ?? `draft failed (${res.status})`)
  return out as GeneratedDraft
}

// "This one wants Davorin." Stamps the row and nothing else: no approve, no send,
// no close — the card stays in the queue wearing the reason it is still there.
//
// A plain `update` on the jsonb column, so the whole context is merged HERE and
// written back; the `{ error }` is read and thrown, never assumed away (a silent
// PostgREST refusal would paint the chip and leave the row untouched, and the
// next refresh would quietly drop it).
export async function markNeedsDavor(d: OpsDraft, now: string = new Date().toISOString()): Promise<void> {
  const { error } = await supabase.from('ops_drafts')
    .update({ context: { ...(d.context ?? {}), needs_davor: true, needs_davor_at: now } })
    .eq('id', d.id).is('sent_at', null)
  if (error) throw error
}

// An escalate card has no draft to post: closing it is bookkeeping only, the same
// shape weekly_report uses (approve IS the end of the line, so both stamps go down
// together or the card strands in Working forever).
export async function markCommentHandled(id: string): Promise<void> {
  return approveWeeklyReport(id, '')
}

export async function approveWeeklyReport(id: string, editedBody: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase.from('ops_drafts')
    .update({ body: editedBody, approved_at: now, sent_at: now })
    .eq('id', id).is('sent_at', null)
  if (error) throw error
}

export async function discardOpsDraft(id: string, kind: OpsKind): Promise<void> {
  if (kind === 'conversation_takeover') {
    throw new Error('Conversation takeovers require the dedicated discard route.')
  }
  const { error } = await supabase.from('ops_drafts')
    .update({ send_blocked_reason: DISCARDED_REASON })
    .eq('id', id).is('sent_at', null)
  if (error) throw error
}

// Every pending task at once (Ivan, 2026-09-06: "in ops tasks add a delete all
// pending"). The same discard as the row's Remove, over the ids the list is
// showing RIGHT NOW: a task that arrives between his tap and the write is not
// on the list he agreed to clear, so it stays.
export async function discardPendingTasks(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const { data, error } = await supabase.from('ops_drafts')
    .update({ send_blocked_reason: DISCARDED_REASON })
    .in('id', ids).is('sent_at', null).is('approved_at', null)
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}

// ---------------------------------------------------------------------------
// The comment gate, fired FROM THE APP (2026-08-03)
// ---------------------------------------------------------------------------
//
// Ivan: "'Approve & open gate' in ops why u opening a new tab on n8n just send
// that shit lol... dont make me go to a new tab and make it be 'Queued'".
//
// Opening a tab was not just clumsy — it hid a real failure. The gate REFUSES
// (disarmed flag, stale post, daily cap, 10-minute spacing, one-in-flight,
// per-target cooldown) and the card was stamped approved+sent unconditionally,
// so a refused comment rendered as handled and never posted. Fired from here,
// the verdict is read and only an ACCEPT stamps the card.
//
// Probed 2026-08-03 on the live webhook: CORS is open to this origin
// (`access-control-allow-origin` echoed, `allow-methods: OPTIONS, GET`) and a
// plain GET with no custom headers is a CORS-simple request, so no preflight
// and no edge-function relay is needed. POST is NOT allowed (the node is GET)
// and its preflight 500s — never change the method.
//
// The reply is BARE TEXT with HTTP 200 for every outcome, accept and refusal
// alike, so the status code carries nothing and the sentence is the only
// signal. That makes this classifier load-bearing, which is why it is a pure
// function with tests rather than an inline regex at the call site.

export type GateOutcome =
  | 'accepted' // queued at the poster; jitter is running
  | 'already' // idempotent replay — the row already left `pending`
  | 'timing' // refused BY THE CLOCK: retrying later can succeed
  | 'refused' // refused on the merits: retrying changes nothing today
  | 'unknown' // could not be classified, or the call failed

// `held`: an ACCEPT the gate parked. The volume lane's gate (Volume Lane -
// Drainer, gi8Kcnmno1136bxT) answers "approved: <name> - held in the queue, the
// volume lane is still switched off (volume_auto_commenting)." when its kill
// switch is off: the row IS approved and drains once the switch flips, but
// nothing posts until then. Read as plain "approved", Ivan took held comments
// for posted ones (2026-09-22), so the card has to say it.
export type GateVerdict = { outcome: GateOutcome; message: string; retryable: boolean; held?: boolean }

export const GATE_HELD_LABEL = 'Approved · held — lane is switched off'

// Ordered, longest-intent-first. Every string below is quoted from the live
// workflow (lwuWECwQRbhzK5Bt, node "Validate + Approve").
const GATE_RULES: { re: RegExp; outcome: GateOutcome }[] = [
  { re: /^approved:/i, outcome: 'accepted' },
  { re: /^queued:/i, outcome: 'accepted' },
  { re: /^already /i, outcome: 'already' },
  // THE clock refusals — the whole reason the app needs its own queue.
  { re: /another comment is already queued/i, outcome: 'timing' },
  { re: /too soon after the last post/i, outcome: 'timing' },
  { re: /daily auto-post cap reached/i, outcome: 'timing' },
  { re: /approve the rest in the morning/i, outcome: 'timing' },
  // Merits: nothing about waiting changes these.
  { re: /cooldown active/i, outcome: 'refused' },
  { re: /DISARMED/i, outcome: 'refused' },
  { re: /older than 5 days/i, outcome: 'refused' },
  { re: /no draft on this row/i, outcome: 'refused' },
  { re: /bad link|bad token|row not found/i, outcome: 'refused' },
]

export function classifyGateReply(raw: string): GateVerdict {
  const message = (raw ?? '').trim()
  for (const r of GATE_RULES) {
    if (r.re.test(message)) {
      const v: GateVerdict = { outcome: r.outcome, message, retryable: r.outcome === 'timing' }
      if (r.outcome === 'accepted' && /held/i.test(message)) v.held = true
      return v
    }
  }
  // FAIL CLOSED. An unrecognised sentence is never treated as an accept: the
  // cost of a wrong 'accepted' is a card that says posted for a comment that
  // never went out, which is the exact defect this replaced.
  return {
    outcome: 'unknown',
    message: message || 'The gate returned nothing.',
    retryable: true,
  }
}

// Fire the gate. GET, no custom headers, no `mode:'no-cors'` — no-cors would
// make the response opaque and throw the verdict away, which is what the
// discard path used to do.
export async function dispatchCommentGate(url: string): Promise<GateVerdict> {
  let res: Response
  try {
    res = await fetch(url, { method: 'GET' })
  } catch (e) {
    return {
      outcome: 'unknown',
      message: `Could not reach the gate (${e instanceof Error ? e.message : 'network error'}).`,
      retryable: true,
    }
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    return { outcome: 'unknown', message: `The gate returned ${res.status}.`, retryable: true }
  }
  return classifyGateReply(text)
}

// ---- durable state: comment_feed, not React ----
//
// The poster writes NOTHING to ops_drafts (verified across all 250 workflows) —
// it owns `comment_feed`, and `context.feed_id` on the card IS that row's id.
// So "is this actually queued / did it post" is re-derived from the database on
// every load instead of remembered in component state, which is what makes a
// refresh safe.
//
// 🔴 EXPLICIT COLUMN LIST, NEVER `*`: comment_feed carries `approve_token`, a
// live capability token. Selecting it would put a bearer credential into the
// React tree and, via any future cache, into localStorage — the same class of
// leak lib/today.ts's whitelist projection and fail-closed cacheSafe() exist to
// prevent.
export type FeedState = {
  id: string
  status: string
  approved_at: string | null
  posted_at: string | null
  post_error: string | null
}

export function outboundFeedId(d: OpsDraft): string | null {
  if (d.kind !== 'comment_outbound') return null
  const f = d.context?.feed_id
  return typeof f === 'string' && f.length > 0 ? f : null
}

export async function fetchCommentFeedStates(ids: string[]): Promise<Map<string, FeedState>> {
  const out = new Map<string, FeedState>()
  if (ids.length === 0) return out
  const { data, error } = await supabase.from('comment_feed')
    .select('id,status,approved_at,posted_at,post_error')
    .in('id', ids.slice(0, 200))
  if (error) throw error
  for (const r of (data ?? []) as FeedState[]) out.set(r.id, r)
  return out
}

// What the CARD says, derived from the feed row. `pending` deliberately maps to
// null — the card is simply actionable again, which is the honest state for a
// comment the gate declined: nothing is scheduled and nothing will retry it
// server-side.
export type CardPostState = 'queued' | 'posted' | 'failed' | 'dismissed' | null

export function cardStateOf(f: FeedState | undefined): CardPostState {
  if (!f) return null
  if (f.status === 'approved' || f.status === 'posting') return 'queued'
  if (f.status === 'posted') return 'posted'
  if (f.status === 'failed' || f.status === 'expired') return 'failed'
  if (f.status === 'dismissed') return 'dismissed'
  return null
}
