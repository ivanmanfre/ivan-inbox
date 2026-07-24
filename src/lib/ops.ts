import { supabase } from './supabase'

export type OpsKind = 'escalation' | 'update'

// The row shape varies by kind (escalation carries a prospect, update carries
// receipts), so context stays a loose bag rather than a fixed type.
export type OpsContext = {
  prospect_name?: string
  company?: string
  receipts?: string[]
  replay?: boolean
  [key: string]: unknown
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

export async function discardOpsDraft(id: string): Promise<void> {
  const { error } = await supabase.from('ops_drafts')
    .update({ send_blocked_reason: DISCARDED_REASON })
    .eq('id', id).is('sent_at', null)
  if (error) throw error
}
