import { supabase } from './supabase'

export type SendRow = {
  client_id: string
  message_type: 'connection_note' | 'dm' | 'inmail' | 'email'
  channel: string
  sent_total: number
  sent_24h: number
  sent_7d: number
  sent_30d: number
  blocked: number
  last_sent: string | null
}

export type DailyRow = {
  client_id: string
  message_type: 'connection_note' | 'dm' | 'inmail' | 'email'
  day: string
  sent: number
}

export type LaneKey = 'connection_note' | 'dm' | 'inmail' | 'email'

export type Lane = {
  key: LaneKey
  label: string
  client_id: string
  sent_24h: number
  sent_7d: number
  sent_30d: number
  sent_total: number
  blocked: number
  last_sent: string | null
  daily: number[] // 14 values oldest -> newest, shares an x-axis with all lanes
  status: 'live' | 'slowing' | 'stale'
}

const LANE_ORDER: LaneKey[] = ['connection_note', 'dm', 'inmail', 'email']
const LANE_LABEL: Record<LaneKey, string> = {
  connection_note: 'Connections',
  dm: 'DMs',
  inmail: 'InMails',
  email: 'Emails',
}

export async function fetchSends(): Promise<SendRow[]> {
  const { data, error } = await supabase.from('inbox_sends_v').select('*')
  if (error) throw error
  return (data ?? []) as SendRow[]
}

export async function fetchSendsDaily(): Promise<DailyRow[]> {
  const { data, error } = await supabase.from('inbox_sends_daily_v').select('*')
  if (error) throw error
  return (data ?? []) as DailyRow[]
}

export type RecentSend = {
  id: string
  prospect_id: string
  prospect_name: string
  message_text: string
  sent_at: string
  client_id: string
}

export type SendLogItem = {
  id: string
  prospect_id: string
  prospect_name: string
  client_id: string
  message_type: string
  message_text: string
  event_at: string
  kind: 'sent' | 'failed'
  reason: string | null
}

type LogRow = {
  id: string; prospect_id: string; prospect_name: string; client_id: string;
  message_type: string | null; message_text: string;
  sent_at: string | null; send_blocked_at: string | null; send_blocked_reason: string | null;
}

// Merge sent + failed rows into one chronological feed. Pure so it's testable.
// Sent rows get the phantom-duplicate collapse; discarded drafts are Ivan's own
// action, not a pipeline event, so they stay out of the log.
export function buildSendLog(sent: LogRow[], failed: LogRow[]): SendLogItem[] {
  const seen = new Set<string>()
  const items: SendLogItem[] = []
  for (const m of sent) {
    if (!m.sent_at) continue
    const dk = `${m.prospect_id}|${m.sent_at}|${m.message_text}`
    if (seen.has(dk)) continue
    seen.add(dk)
    items.push({
      id: m.id, prospect_id: m.prospect_id, prospect_name: m.prospect_name,
      client_id: m.client_id, message_type: m.message_type ?? 'dm',
      message_text: m.message_text, event_at: m.sent_at, kind: 'sent', reason: null,
    })
  }
  for (const m of failed) {
    if (!m.send_blocked_at || m.send_blocked_reason === 'discarded_in_inbox') continue
    items.push({
      id: m.id, prospect_id: m.prospect_id, prospect_name: m.prospect_name,
      client_id: m.client_id, message_type: m.message_type ?? 'dm',
      message_text: m.message_text, event_at: m.send_blocked_at, kind: 'failed',
      reason: m.send_blocked_reason,
    })
  }
  return items.sort((a, b) => b.event_at.localeCompare(a.event_at))
}

export async function fetchSendLog(
  client: 'all' | 'ivan' | 'risedtc',
  limit = 120,
): Promise<SendLogItem[]> {
  const cols = 'id, prospect_id, prospect_name, client_id, message_type, message_text, sent_at, send_blocked_at, send_blocked_reason'
  let sentQ = supabase.from('inbox_messages_v').select(cols)
    .eq('direction', 'outbound').not('sent_at', 'is', null)
    .order('sent_at', { ascending: false }).limit(limit * 3) // wide for dedupe headroom
  let failQ = supabase.from('inbox_messages_v').select(cols)
    .eq('direction', 'outbound').not('send_blocked_at', 'is', null)
    .order('send_blocked_at', { ascending: false }).limit(60)
  if (client !== 'all') { sentQ = sentQ.eq('client_id', client); failQ = failQ.eq('client_id', client) }
  const [sent, fail] = await Promise.all([sentQ, failQ])
  if (sent.error) throw sent.error
  if (fail.error) throw fail.error
  return buildSendLog(
    (sent.data ?? []) as LogRow[],
    (fail.data ?? []) as LogRow[],
  ).slice(0, limit)
}

// The most recent actually-sent rows for one lane — powers the drill-in so you
// can see WHAT went out, not just that the count moved. A historical insert
// loop duplicated some DMs hundreds of times (identical text + timestamp), so
// pull a wide window, collapse exact duplicates, then take the newest few —
// otherwise one phantom burst would fill the whole list.
export async function fetchLaneRecent(
  key: LaneKey,
  client: 'all' | 'ivan' | 'risedtc',
  limit = 25,
): Promise<RecentSend[]> {
  let q = supabase.from('inbox_messages_v')
    .select('id, prospect_id, prospect_name, message_text, sent_at, client_id')
    .eq('message_type', key)
    .eq('direction', 'outbound')
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(400)
  if (client !== 'all') q = q.eq('client_id', client)
  const { data, error } = await q
  if (error) throw error

  const seen = new Set<string>()
  const out: RecentSend[] = []
  for (const m of (data ?? []) as RecentSend[]) {
    const dk = `${m.prospect_id}|${m.sent_at}|${m.message_text}`
    if (seen.has(dk)) continue
    seen.add(dk)
    out.push(m)
    if (out.length >= limit) break
  }
  return out
}

export type CampaignSend = {
  campaign_id: string
  campaign_name: string
  is_active: boolean
  sent: number
}

// Per-campaign send counts for the Overview → Campaigns block. inbox_messages_v
// exposes campaign_name (not a stable id), so we count sends by name client-side
// — applying the same phantom-duplicate collapse the log/lane fetchers use — and
// join to outreach_campaigns (by name) to pick up the id + active/paused flag.
// Campaigns with zero sends still appear (sent: 0) so paused-but-empty lanes show.
export async function fetchCampaignSends(
  client: 'all' | 'ivan' | 'risedtc',
): Promise<CampaignSend[]> {
  let campQ = supabase.from('outreach_campaigns').select('id, name, is_active, client_id')
  let msgQ = supabase.from('inbox_messages_v')
    .select('prospect_id, campaign_name, message_text, sent_at')
    .eq('direction', 'outbound').not('sent_at', 'is', null)
    .order('sent_at', { ascending: false }).limit(4000)
  if (client !== 'all') { campQ = campQ.eq('client_id', client); msgQ = msgQ.eq('client_id', client) }

  const [camp, msg] = await Promise.all([campQ, msgQ])
  if (camp.error) throw camp.error
  if (msg.error) throw msg.error

  type MsgRow = { prospect_id: string; campaign_name: string | null; message_text: string; sent_at: string | null }
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  for (const m of (msg.data ?? []) as MsgRow[]) {
    if (!m.campaign_name || !m.sent_at) continue
    const dk = `${m.prospect_id}|${m.sent_at}|${m.message_text}`
    if (seen.has(dk)) continue
    seen.add(dk)
    counts.set(m.campaign_name, (counts.get(m.campaign_name) ?? 0) + 1)
  }

  type CampRow = { id: string; name: string; is_active: boolean; client_id: string }
  return ((camp.data ?? []) as CampRow[])
    .map(c => ({
      campaign_id: c.id,
      campaign_name: c.name,
      is_active: c.is_active,
      sent: counts.get(c.name) ?? 0,
    }))
    .sort((a, b) => b.sent - a.sent)
}

export function laneStatus(last_sent: string | null, nowIso: string): 'live' | 'slowing' | 'stale' {
  if (!last_sent) return 'stale'
  const age = new Date(nowIso).getTime() - new Date(last_sent).getTime()
  const hours = age / 3_600_000
  if (hours <= 48) return 'live'
  if (hours <= 24 * 7) return 'slowing'
  return 'stale'
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

export function buildLanes(
  rows: SendRow[],
  daily: DailyRow[],
  client: 'all' | 'ivan' | 'risedtc',
): Lane[] {
  const inClient = (id: string) => client === 'all' || id === client

  // Shared x-axis: distinct sorted day set across the WHOLE daily result.
  const days = [...new Set(daily.map(d => d.day))].sort()
  const axis = days.slice(-14)

  return LANE_ORDER.map(key => {
    const laneRows = rows.filter(r => r.message_type === key && inClient(r.client_id))

    let sent_24h = 0, sent_7d = 0, sent_30d = 0, sent_total = 0, blocked = 0
    let last_sent: string | null = null
    for (const r of laneRows) {
      sent_24h += r.sent_24h
      sent_7d += r.sent_7d
      sent_30d += r.sent_30d
      sent_total += r.sent_total
      blocked += r.blocked
      last_sent = maxIso(last_sent, r.last_sent)
    }

    const perDay = new Map<string, number>()
    for (const d of daily) {
      if (d.message_type !== key || !inClient(d.client_id)) continue
      perDay.set(d.day, (perDay.get(d.day) ?? 0) + d.sent)
    }
    const daily14 = axis.map(day => perDay.get(day) ?? 0)

    const nowIso = new Date().toISOString()
    return {
      key,
      label: LANE_LABEL[key],
      client_id: client,
      sent_24h, sent_7d, sent_30d, sent_total, blocked,
      last_sent,
      daily: daily14,
      status: laneStatus(last_sent, nowIso),
    }
  })
}
