import { supabase } from '../../lib/supabase'
import { NOTIFICATIONS_VIEW } from '../../lib/turns'
import { isImportantWorkflowFamily } from '../../../supabase/functions/_shared/notification-lifecycle'

// The bell's number (coordinator ruling): unread GROUPS, i.e. distinct
// coalesce(group_key, id) over rows with read_at and dismissed_at both null in
// inbox_notifications_v. Counted over every open row, not the newest 200 the
// feed loads. `open` is every row not dismissed, for the panel's sub line.
export type BellCounts = { unreadGroups: number; open: number; nextExpiryAt?: string | null }

export function unreadGroups(rows: { id: string; group_key: string | null; family?: string; incident_key?: string | null }[]): number {
  return new Set(rows.map(r => r.family && isImportantWorkflowFamily(r.family) && r.incident_key
    ? `incident:${r.incident_key}` : r.group_key || r.id)).size
}

const PAGE = 1000

export async function fetchBellCounts(): Promise<BellCounts> {
  const now = new Date().toISOString()
  const rows: { id: string; family: string; incident_key: string | null; group_key: string | null; read_at: string | null; expires_at: string | null }[] = []
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await supabase.from(NOTIFICATIONS_VIEW)
      .select('id,family,incident_key,group_key,read_at,expires_at')
      .is('dismissed_at', null)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const page = (data ?? []) as { id: string; family: string; incident_key: string | null; group_key: string | null; read_at: string | null; expires_at: string | null }[]
    rows.push(...page)
    if (page.length < PAGE) break
    if (from + PAGE >= 50_000) throw new Error('bell_count_page_limit')
  }
  const next = rows.reduce<number>((min, row) => row.expires_at
    ? Math.min(min, Date.parse(row.expires_at)) : min, Infinity)
  return {
    unreadGroups: unreadGroups(rows.filter(row => !row.read_at)),
    open: rows.length,
    nextExpiryAt: Number.isFinite(next) ? new Date(next).toISOString() : null,
  }
}
