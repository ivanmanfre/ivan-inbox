import { supabase } from './supabase'

// n8nClaw — the WhatsApp-mirrored assistant. Same four tables the dashboard's
// AgentPanel reads (personal-site/hooks/useAgentData.ts), same column names,
// same filters. Everything else that lives under the dashboard's "Agent"
// heading (the retired Agent-Ready blueprint pipeline) is deliberately absent.

export type ChatRole = 'user' | 'assistant' | string

export type AgentMessage = {
  // bigint PK, not a uuid — the dashboard compares ids numerically to detect a
  // fresh assistant reply (useAgentData.ts:91).
  id: number
  role: ChatRole
  content: string
  created_at: string
}

export type AgentAlert = {
  id: string
  alert_type: string
  title: string
  body: string | null
  sent: boolean
  sent_at: string | null
  created_at: string
}

export type AgentReminder = {
  // integer PK — dashboard_action casts p_id::integer for this table
  // specifically (client_autofix.sql:47-49).
  id: number
  reminder_text: string
  remind_at: string
  status: string
  recurrence: string | null
  created_at: string
}

export type AgentSummary = {
  id: string
  date: string
  summary: string
  topics: string[]
  action_items: string[]
  message_count: number
  created_at: string
}

export const CHAT_PAGE_SIZE = 50

// Newest N, returned oldest-first for rendering. The table has no ascending
// index-friendly cursor from the tail, so the fetch orders DESC and the list is
// reversed here — the same shape useAgentData.ts:82 uses.
export async function fetchChat(limit = CHAT_PAGE_SIZE): Promise<AgentMessage[]> {
  const { data, error } = await supabase.from('n8nclaw_chat_messages')
    .select('id, role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as unknown as AgentMessage[]).slice().reverse()
}

// Older page, for "load older messages". Cursor is the oldest loaded timestamp.
export async function fetchChatBefore(beforeIso: string, limit = CHAT_PAGE_SIZE): Promise<AgentMessage[]> {
  const { data, error } = await supabase.from('n8nclaw_chat_messages')
    .select('id, role, content, created_at')
    .lt('created_at', beforeIso)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as unknown as AgentMessage[]).slice().reverse()
}

// Alerts are windowed. The first tournament render was two 60+day-old unsent
// pipeline_stall rows sitting at the top of the Agent screen as if they were
// today's news — nothing had acknowledged them because nobody was ever going to
// act on them. Stale unsent ≠ actionable today. So the screen shows the last 14
// days and the older unsent rows collapse to a count.
export const ALERT_WINDOW_DAYS = 14

// Cutoff as an ISO instant. Pure so the window is testable without a clock or a
// network. UTC 'Z', never '+00:00' — a literal '+' in a PostgREST filter is
// read as a space unless it is encoded.
export function alertWindowCutoff(now: number | Date = Date.now(), days = ALERT_WINDOW_DAYS): string {
  const ms = now instanceof Date ? now.getTime() : now
  return new Date(ms - days * 24 * 60 * 60 * 1000).toISOString()
}

export type AlertsPage = {
  alerts: AgentAlert[]
  // Unacknowledged rows OLDER than the window. Not hidden — summarised. A zero
  // here means the backlog is genuinely clear; a number means there is history
  // to go read somewhere else, which is a different statement from "nothing is
  // wrong" (D10: an empty screen has to be distinguishable from a filtered one).
  olderUnsent: number
}

export async function fetchAlerts(limit = 50, days = ALERT_WINDOW_DAYS): Promise<AlertsPage> {
  const cutoff = alertWindowCutoff(Date.now(), days)
  const [recent, older] = await Promise.all([
    supabase.from('n8nclaw_proactive_alerts')
      .select('id, alert_type, title, body, sent, sent_at, created_at')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(limit),
    // head-count only, no rows over the wire. `sent` is nullable and
    // unsentAlerts() counts NULL as unacknowledged, so the count has to as well
    // or the two numbers disagree on the same rows.
    supabase.from('n8nclaw_proactive_alerts')
      .select('id', { count: 'exact', head: true })
      .lt('created_at', cutoff)
      .or('sent.is.null,sent.eq.false'),
  ])
  if (recent.error) throw recent.error
  if (older.error) throw older.error
  return {
    alerts: (recent.data ?? []) as unknown as AgentAlert[],
    olderUnsent: older.count ?? 0,
  }
}

export async function fetchReminders(): Promise<AgentReminder[]> {
  const { data, error } = await supabase.from('n8nclaw_reminders')
    .select('id, reminder_text, remind_at, status, recurrence, created_at')
    .eq('status', 'pending')
    .order('remind_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as AgentReminder[]
}

export async function fetchDailySummaries(limit = 7): Promise<AgentSummary[]> {
  const { data, error } = await supabase.from('n8nclaw_daily_summaries')
    .select('id, date, summary, topics, action_items, message_count, created_at')
    .order('date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as unknown as Array<Partial<AgentSummary> & { id: string; date: string }>)
    .map(r => ({
      id: r.id, date: r.date, summary: r.summary ?? '',
      topics: r.topics ?? [], action_items: r.action_items ?? [],
      message_count: r.message_count ?? 0, created_at: r.created_at ?? r.date,
    }))
}

// ---------- send ----------

// The RPC is the ONLY send path.
//
// The dashboard's fallback POSTs an unauthenticated spoofed WhatsApp inbound to
// n8n on ANY rpc error; from a phone a stray retry ghost-messages the real
// assistant loop. Not ported (skeptic verdict 2026-07-31).
//
// So an rpc error THROWS here and the caller shows it. A failed send that looks
// failed is strictly better than a "sent" that arrived at Ivan's real WhatsApp
// thread through a spoofed inbound envelope.
export async function sendChat(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('empty message')
  const { error } = await supabase.rpc('n8nclaw_dashboard_send', { p_message: trimmed })
  if (error) throw error
}

// ---------- acks ----------

// dashboard_action is a generic SECURITY DEFINER field-setter whose allowlist
// reaches far past this domain — it will happily set outreach_campaigns.is_active
// or outreach_prospects.stage, i.e. arm outreach, if handed those arguments
// (client_autofix.sql:37-38). This module therefore never exposes the table or
// field as parameters: the two pairs the inbox is allowed to touch are consts,
// the dispatcher is module-private, and there is no code path from a caller to
// an arbitrary field. Widening it is a deliberate edit here, not a call-site
// argument.
export const ALERT_TABLE = 'n8nclaw_proactive_alerts'
export const ALERT_FIELD = 'sent'
export const REMINDER_TABLE = 'n8nclaw_reminders'
export const REMINDER_FIELD = 'status'

async function dashboardAction(table: string, id: string, field: string, value: string): Promise<void> {
  const { error } = await supabase.rpc('dashboard_action', {
    p_table: table, p_id: id, p_field: field, p_value: value,
  })
  if (error) throw error
}

// Acknowledging an alert means "I have seen this", which the schema spells
// sent=true — the same write the dashboard's Ack button makes
// (useAgentData.ts:205).
export async function ackAlert(id: string): Promise<void> {
  return dashboardAction(ALERT_TABLE, id, ALERT_FIELD, 'true')
}

// Integer PK: dashboard_action casts p_id::integer for n8nclaw_reminders and
// ::uuid for everything else, so the id must arrive as a plain numeric string.
export async function ackReminder(id: number, status = 'completed'): Promise<void> {
  return dashboardAction(REMINDER_TABLE, String(id), REMINDER_FIELD, status)
}

// ---------- pure helpers ----------

// Local calendar day. Two messages either side of midnight get a separator
// between them; everything else in the same day does not.
export function chatDayKey(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function needsDaySeparator(currentIso: string, prevIso: string | null): boolean {
  if (!prevIso) return true
  return chatDayKey(currentIso) !== chatDayKey(prevIso)
}

// Consecutive messages from the same speaker read as one turn; only the first
// of a run carries the avatar/timestamp.
export function startsTurn(msgs: Array<{ role: ChatRole }>, i: number): boolean {
  if (i <= 0) return true
  return msgs[i].role !== msgs[i - 1].role
}

// Alerts the agent raised that nobody has acknowledged — the badge number.
export function unsentAlerts(rows: AgentAlert[]): AgentAlert[] {
  return rows.filter(a => a.sent !== true)
}

// The newest assistant message, used to tell "still waiting on a reply" from
// "the reply landed". A run of user messages with nothing after it is a stalled
// send, not a finished one.
export function latestAssistantId(msgs: AgentMessage[]): number | null {
  let best: number | null = null
  for (const m of msgs) {
    if (m.role === 'assistant' && (best === null || m.id > best)) best = m.id
  }
  return best
}
