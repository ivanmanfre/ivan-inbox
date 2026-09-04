// stream.ts — candidate C's thesis in one function: ONE chronological feed
// where his turns to Claude and the notifications that arrived are the same
// column, newest at the bottom like a chat.
//
// mergeStream is pure so the interleave-by-time, the repeat-fold and the
// quiet-fold can all be asserted without a browser or a network. The caller
// (StreamList) supplies the turns already carrying a wall-clock time — Turn
// (chat/events.ts) has no timestamp field of its own, so the component attaches
// one (see withTurnTimes in useStream.ts) before calling in here. Everything
// past that point is arithmetic on plain data.
import type { Turn } from '../../v2c/chat/events'
import { groupNotifications, type Notification, type NotificationGroup } from '../../../lib/turns'
import { isNeedsMe, isQuietEligible } from './families'

export type StreamTurn = Turn & { at: string }

export type FilterKey = 'all' | 'asks' | 'needs' | 'rise' | 'arch'

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'asks', label: 'Asks' },
  { key: 'needs', label: 'Needs you' },
  { key: 'rise', label: 'RISE' },
  { key: 'arch', label: 'ARCH' },
]

export type StreamEntry =
  | { kind: 'turn'; key: string; at: string; turn: Turn }
  | { kind: 'notification'; key: string; at: string; group: NotificationGroup }
  | { kind: 'quiet'; key: string; at: string; count: number; groups: NotificationGroup[] }

function tenantMatches(tenant: string | null, want: 'rise' | 'arch'): boolean {
  if (!tenant) return false
  return tenant.toLowerCase().includes(want)
}

/**
 * The whole thesis as arithmetic:
 *   1. Fold raw notification rows into groups (repeats collapse to one card
 *      with a count — groupNotifications already does this, keyed on
 *      group_key or on family+shape).
 *   2. Apply the filter chip. 'asks' clears every notification and shows only
 *      his turns — a look at just what he asked. 'needs' keeps only groups
 *      whose latest row still needs a decision. 'rise'/'arch' keep only groups
 *      tagged for that tenant; turns carry no tenant and are never tenant-
 *      filtered, because a conversation with Claude belongs to neither client.
 *   3. When `quiet` is on, fold every remaining info-severity, quiet-eligible
 *      group into ONE row ("14 quiet updates"). A group that needs a decision
 *      never folds, quiet or not — the toggle hides routine noise, never a
 *      thing waiting on him.
 *   4. Interleave what is left with the turns by timestamp, oldest first, so
 *      the newest thing — an answer or a notification — sits at the bottom
 *      exactly where a chat's newest message sits.
 */
export function mergeStream(
  turns: StreamTurn[],
  notifications: Notification[],
  opts: { filter: FilterKey; quiet: boolean },
): StreamEntry[] {
  const { filter, quiet } = opts
  const entries: StreamEntry[] = []

  if (filter !== 'asks') {
    let groups = groupNotifications(notifications)
    if (filter === 'needs') {
      groups = groups.filter(g => isNeedsMe(g.family, g.latest.severity))
    } else if (filter === 'rise' || filter === 'arch') {
      groups = groups.filter(g => tenantMatches(g.latest.tenant, filter))
    }

    const folded: NotificationGroup[] = []
    const shown: NotificationGroup[] = []
    for (const g of groups) {
      if (quiet && isQuietEligible(g.family, g.latest.severity)) folded.push(g)
      else shown.push(g)
    }

    for (const g of shown) {
      entries.push({ kind: 'notification', key: `n:${g.key}`, at: g.lastSeenAt, group: g })
    }
    if (folded.length > 0) {
      const count = folded.reduce((s, g) => s + g.count, 0)
      const at = folded.reduce((max, g) => (g.lastSeenAt > max ? g.lastSeenAt : max), folded[0].lastSeenAt)
      entries.push({ kind: 'quiet', key: 'quiet-fold', at, count, groups: folded })
    }
  }

  for (const t of turns) {
    entries.push({ kind: 'turn', key: `t:${t.id}`, at: t.at, turn: t })
  }

  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return entries
}

/**
 * The empty-state clock: the most recent timestamp across everything that WAS
 * on screen before a filter or the quiet toggle emptied it, or across the raw
 * feed on a genuinely quiet morning. Pure so "Nothing new since 14:20" can be
 * asserted against a fixed clock rather than Date.now().
 */
export function latestActivityAt(turns: StreamTurn[], notifications: Notification[]): string | null {
  let latest: string | null = null
  for (const t of turns) if (!latest || t.at > latest) latest = t.at
  for (const n of notifications) {
    const at = n.last_seen_at || n.created_at
    if (!latest || at > latest) latest = at
  }
  return latest
}
