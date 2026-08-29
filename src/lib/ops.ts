import { supabase } from './supabase'

// `task` is the one kind with no engine behind it at all: it is Ivan's own to-do,
// dictated to the WhatsApp assistant or written down by a Claude session. Done
// double-stamps (nothing is sent), Remove discards. It is deliberately absent from
// the Slack dispatcher's pick list (kind IN escalation/update/booking), so a task
// can never reach a channel — least of all the client-facing one `update` writes to.
export type OpsKind = 'escalation' | 'update' | 'newsjack' | 'weekly_report' | 'comment_reply' | 'comment_outbound' | 'booking' | 'precall_email' | 'manual_invite' | 'task'

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

// Pending = nothing has happened to it yet — the only rows the operator acts on.
// Comment cards also age out: past the window they are noise, not a to-do.
export function pendingOps(rows: OpsDraft[], now = Date.now()): OpsDraft[] {
  return rows.filter(d =>
    !d.approved_at && !d.sent_at && !d.send_blocked_reason && !isStaleComment(d, now))
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

export async function fetchOpsDrafts(): Promise<OpsDraft[]> {
  const { data, error } = await supabase.from('ops_drafts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) throw error
  return data as OpsDraft[]
}

// Approve stamps the (possibly edited) body and approved_at together, same
// shape as outreach_messages' approveDraft — the n8n dispatcher picks up any
// row with approved_at set and posts it to Slack within ~2 minutes.
export async function approveOpsDraft(id: string, editedBody: string): Promise<void> {
  const { error } = await supabase.from('ops_drafts')
    .update({ body: editedBody, approved_at: new Date().toISOString() })
    .eq('id', id).is('sent_at', null)
  if (error) throw error
}

// weekly_report is the one kind with no dispatcher behind it: Ivan sends the
// report to the client himself, so approving IS the send. Stamping only
// approved_at would strand the card in the Working group forever, waiting on a
// writer that does not exist. Both timestamps go down together.
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
  if (!res.ok || out?.ok === false) throw new Error(out?.error ?? `post failed (${res.status})`)
  return out
}

export async function postCommentReply(
  id: string, editedBody: string, tagCommenter = true,
): Promise<{ posted: boolean; reason?: string; tagged?: boolean; tagVerified?: boolean | null }> {
  const out = await callCommentReplyFn({
    ops_draft_id: id, body: editedBody, tag_commenter: tagCommenter,
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

export type GeneratedDraft = {
  drafted: boolean
  draft?: string
  // Why the engine refused: the named gate violations, or "he already answered".
  why?: string[]
  reason?: string
  category_auto_eligible?: boolean
}

// Runs the SAME drafter the pipeline runs (same content_prompts rows, same
// exemplars, same RAG corpus, same gates), for one card, now. It writes the body
// and nothing else — publishing still goes through postCommentReply, which
// re-reads the thread first. A refusal returns its reasons instead of a draft.
export async function generateCommentDraft(id: string): Promise<GeneratedDraft> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('not signed in')
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rise-comment-draft`,
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
  if (!res.ok || out?.ok === false) throw new Error(out?.error ?? `draft failed (${res.status})`)
  return out as GeneratedDraft
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

export async function discardOpsDraft(id: string): Promise<void> {
  const { error } = await supabase.from('ops_drafts')
    .update({ send_blocked_reason: DISCARDED_REASON })
    .eq('id', id).is('sent_at', null)
  if (error) throw error
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

export type GateVerdict = { outcome: GateOutcome; message: string; retryable: boolean }

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
      return { outcome: r.outcome, message, retryable: r.outcome === 'timing' }
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
