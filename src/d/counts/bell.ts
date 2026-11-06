import { supabase } from '../../lib/supabase'
import { NOTIFICATIONS_VIEW } from '../../lib/turns'
import { ACTIVITY_FAMILIES, isActivityRow, isImportantWorkflowFamily, MUTED_NOTIFICATION_FAMILIES } from '../../../supabase/functions/_shared/notification-lifecycle'

// The badge counts unread NEEDS-YOU incidents from the last four hours. Activity rows (sent logs,
// published posts, run summaries, digests) never count: they fold into the feed's quiet Activity group.
//
// Two small bounded reads, never a page through the whole open pile: the old read walked every open row
// 1,000 at a time (2,552 open on 11-06 = 3 requests) on mount, focus, every push and every 3 minutes.
//   1. unread rows created in the badge window (at most BADGE_LIMIT, newest first)
//   2. the single next expiry among open rows, so the badge refreshes exactly when a row leaves
export type BellCounts = { unreadGroups: number; nextExpiryAt?: string | null }

const BADGE_WINDOW_MS = 4 * 60 * 60_000
const BADGE_LIMIT = 500
// The one Activity shape inside a needs-you family (alert-kinds isAutoQueuedDraft): filtered before the limit too.
const AUTO_QUEUED_TITLE = 'DM1 wins auto-queued for'
type CountRow = { id: string; family: string; severity: string | null; title: string | null; incident_key: string | null; group_key: string | null; created_at: string; expires_at: string | null }

export function unreadGroups(rows: { id: string; group_key: string | null; family?: string; incident_key?: string | null }[]): number {
  return new Set(rows.map(r => r.family && isImportantWorkflowFamily(r.family) && r.incident_key
    ? `incident:${r.incident_key}` : r.group_key || r.id)).size
}

export async function fetchBellCounts(): Promise<BellCounts> {
  const now = new Date().toISOString()
  const nowMs = Date.parse(now)
  const since = new Date(nowMs - BADGE_WINDOW_MS).toISOString()
  const muted = `(${MUTED_NOTIFICATION_FAMILIES.join(',')})`
  const [badge, expiry] = await Promise.all([
    supabase.from(NOTIFICATIONS_VIEW)
      .select('id,family,severity,title,incident_key,group_key,created_at,expires_at')
      .is('dismissed_at', null)
      .is('read_at', null)
      .not('family', 'in', muted)
      .gt('created_at', since)
      .lte('created_at', now)
      // Activity families leave before the limit (an error row of one still counts), so a burst of logs
      // can never push a needs-you row out of the bounded read. Expiry is checked below.
      .or(`severity.eq.error,and(family.not.in.(${ACTIVITY_FAMILIES.join(',')}),title.not.like.${AUTO_QUEUED_TITLE}*)`)
      .order('created_at', { ascending: false })
      .limit(BADGE_LIMIT),
    supabase.from(NOTIFICATIONS_VIEW)
      .select('expires_at')
      .is('dismissed_at', null)
      .not('family', 'in', muted)
      .gt('expires_at', now)
      .order('expires_at', { ascending: true })
      .limit(1),
  ])
  if (badge.error) throw badge.error
  if (expiry.error) throw expiry.error
  const badgeRows = ((badge.data ?? []) as CountRow[])
    .filter(row => !row.expires_at || Date.parse(row.expires_at) > nowMs)
    .filter(row => !isActivityRow(row.family, row.severity, row.title ?? ''))
  const nextRow = ((expiry.data ?? []) as { expires_at: string | null }[])[0]?.expires_at
  const next = nextRow ? Date.parse(nextRow) : Infinity
  const badgeNext = badgeRows.reduce((min, row) => Math.min(min, Date.parse(row.created_at) + BADGE_WINDOW_MS), Infinity)
  const nextDeadline = Math.min(next, badgeNext)
  return {
    unreadGroups: unreadGroups(badgeRows),
    nextExpiryAt: Number.isFinite(nextDeadline) ? new Date(nextDeadline).toISOString() : null,
  }
}
