import { supabase } from './supabase'

export type OpsKind = 'escalation' | 'update' | 'newsjack' | 'weekly_report' | 'comment_reply'

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
export function pendingOps(rows: OpsDraft[]): OpsDraft[] {
  return rows.filter(d => !d.approved_at && !d.sent_at && !d.send_blocked_reason)
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
// comment_reply shares weekly_report's posture for the same reason: this lane is
// read-only against LinkedIn, so Ivan (or Mattan) posts the reply by hand and the
// approve IS the send. Nothing will ever stamp sent_at for him.
export async function approveCommentReply(id: string, editedBody: string): Promise<void> {
  return approveWeeklyReport(id, editedBody)
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
