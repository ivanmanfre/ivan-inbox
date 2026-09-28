import { supabase } from '../../lib/supabase'
import { NOTIFICATIONS_VIEW } from '../../lib/turns'
import { isImportantWorkflowFamily } from '../../../supabase/functions/_shared/notification-lifecycle'

// The badge counts unread incidents from the last four hours.
// The full active history remains available in the feed and `open` count.
export type BellCounts = { unreadGroups: number; open: number; nextExpiryAt?: string | null }

const BADGE_WINDOW_MS = 4 * 60 * 60_000
type CountRow = { id: string; family: string; incident_key: string | null; group_key: string | null; created_at: string; read_at: string | null; expires_at: string | null }

export function unreadGroups(rows: { id: string; group_key: string | null; family?: string; incident_key?: string | null }[]): number {
  return new Set(rows.map(r => r.family && isImportantWorkflowFamily(r.family) && r.incident_key
    ? `incident:${r.incident_key}` : r.group_key || r.id)).size
}

const PAGE = 1000

export async function fetchBellCounts(): Promise<BellCounts> {
  const now = new Date().toISOString()
  const nowMs = Date.parse(now)
  const rows: CountRow[] = []
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await supabase.from(NOTIFICATIONS_VIEW)
      .select('id,family,incident_key,group_key,created_at,read_at,expires_at')
      .is('dismissed_at', null)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const page = (data ?? []) as CountRow[]
    rows.push(...page)
    if (page.length < PAGE) break
    if (from + PAGE >= 50_000) throw new Error('bell_count_page_limit')
  }
  const badgeRows = rows.filter(row => {
    const created = Date.parse(row.created_at)
    return !row.read_at && Number.isFinite(created) && created > nowMs - BADGE_WINDOW_MS && created <= nowMs
  })
  const next = rows.reduce<number>((min, row) => row.expires_at
    ? Math.min(min, Date.parse(row.expires_at)) : min, Infinity)
  const badgeNext = badgeRows.reduce((min, row) => Math.min(min, Date.parse(row.created_at) + BADGE_WINDOW_MS), Infinity)
  const nextDeadline = Math.min(next, badgeNext)
  return {
    unreadGroups: unreadGroups(badgeRows),
    open: rows.length,
    nextExpiryAt: Number.isFinite(nextDeadline) ? new Date(nextDeadline).toISOString() : null,
  }
}
