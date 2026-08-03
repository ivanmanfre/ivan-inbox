import { supabase } from './supabase'

export type OpsKind = 'escalation' | 'update' | 'newsjack' | 'weekly_report' | 'comment_reply' | 'comment_outbound'

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

// Newsjack cards are not Slack-bound: approving one fires generation and claims the
// next publish slot on the matching engine. Same table, different destination.
export const ENGINE_LABEL: Record<string, string> = { ivan: 'your feed', risedtc: 'Rise' }
export function engineLabel(clientId: string): string {
  return ENGINE_LABEL[clientId] ?? clientId
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
// while it generates and QA-gates, which can run to an hour — without this group the
// card would just vanish on approve and look like nothing happened.
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
export async function postCommentReply(
  id: string, editedBody: string,
): Promise<{ posted: boolean; reason?: string }> {
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
      body: JSON.stringify({ ops_draft_id: id, body: editedBody }),
    },
  )
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out?.ok === false) throw new Error(out?.error ?? `post failed (${res.status})`)
  return { posted: out.posted === true, reason: out.reason }
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
