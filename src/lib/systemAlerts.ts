import { supabase } from './supabase'

// system_alerts (db/027) — infrastructure facts that carry a deadline.
//
// The first of them is the Instagram grant behind the Rise mirror: Meta caps an
// Instagram Login long-lived token at 60 days, and once it lapses it cannot be
// refreshed at all, so recovery is the client clicking a fresh connect link.
// The failure is silent — posts start failing and the feed says nothing — which
// is exactly the class of thing that has to arrive somewhere Ivan reads.
//
// Why not the tables that already exist. n8nclaw_proactive_alerts is rendered
// only as a COUNT of rows OLDER than 14 days, captioned "historical, not
// actionable here" (ContentList.tsx), so a fresh row there is invisible for two
// weeks and then labelled history. ops_drafts approve POSTS TO A CLIENT SLACK
// CHANNEL. Neither one can carry this.

export type Severity = 'info' | 'warn' | 'critical'

export type SystemAlert = {
  id: string
  source: string
  dedupe_key: string
  severity: Severity
  title: string
  body: string | null
  action_url: string | null
  action_label: string | null
  created_at: string
  resolved_at: string | null
}

export const SYSTEM_ALERTS_TABLE = 'system_alerts'

const COLS = 'id, source, dedupe_key, severity, title, body, action_url, action_label, created_at, resolved_at'

// Open rows only. A dismissed alert is gone from the surface for good: the
// writer's dedupe_key is unique, so nothing re-inserts the same warning and
// nothing resurrects a row Ivan has already read.
export async function fetchSystemAlerts(limit = 20): Promise<SystemAlert[]> {
  const { data, error } = await supabase.from(SYSTEM_ALERTS_TABLE)
    .select(COLS)
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as SystemAlert[]
}

export async function dismissSystemAlert(id: string): Promise<void> {
  const { error } = await supabase.from(SYSTEM_ALERTS_TABLE)
    .update({ resolved_at: new Date().toISOString(), resolved_by: 'inbox' })
    .eq('id', id)
  if (error) throw error
}

const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 }

// Worst first, then newest. A critical row that landed on Monday outranks a
// warn that landed this morning: the ordering is by what it costs to ignore,
// never by when it arrived.
export function rankAlerts(rows: SystemAlert[]): SystemAlert[] {
  return rows.slice().sort((a, b) => {
    const r = (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3)
    if (r !== 0) return r
    return Date.parse(b.created_at) - Date.parse(a.created_at)
  })
}

// The strip's own headline. Counting severities rather than printing a bare
// total, because "1 alert" and "1 critical alert" are different sentences and
// only one of them says whether to stop what you are doing.
export function alertSummary(rows: SystemAlert[]): string {
  const n = (s: Severity) => rows.filter(r => r.severity === s).length
  const parts = [
    n('critical') > 0 && `${n('critical')} critical`,
    n('warn') > 0 && `${n('warn')} warning${n('warn') === 1 ? '' : 's'}`,
    n('info') > 0 && `${n('info')} note${n('info') === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[]
  return parts.join(' · ')
}
