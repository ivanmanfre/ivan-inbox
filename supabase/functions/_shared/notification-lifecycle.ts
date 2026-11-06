import { KNOWN_FAMILIES, kindFor } from './alert-kinds.ts'

/** The existing interrupting workflow families, shared with the browser popup. */
export const IMPORTANT_WORKFLOW_FAMILIES = [
  'system_infra_alarm', 'send_failed_alert', 'lane_supply_alarm',
] as const

export function isImportantWorkflowFamily(family: string): boolean {
  return (IMPORTANT_WORKFLOW_FAMILIES as readonly string[]).includes(family)
}

/** A deterministic fallback for direct producers that have not supplied a
 * machine incident key. Retain failure terms and HTTP status, but ignore common
 * run IDs, timestamps and count-only changes. Digest the full normalized text
 * so a different failed step or error remains a different incident. */
export async function fallbackIncidentKey(n: {
  family: string; source?: string | null; tenant?: string | null;
  severity?: string | null; title: string; body?: string | null
}): Promise<string> {
  const thresholds: string[] = []
  // The separator stops a title ending in "floor" from consuming a measured
  // number at the start of the body as if it were the configured floor.
  const stable = `${n.title} | ${n.body ?? ''}`.toLowerCase()
    // Protect explicit limits before removing changing measurements. In
    // "12 leads, 8%; under floor 20 leads", only 12 and 8 are observations.
    .replace(/\b(threshold|floor|target|minimum|min|required|limit)\s*(?:(is|of|at|>=|>|:|=)\s*)?(\d+(?:[.,]\d+)?)(?:\s*(%|bookings?|records?|rows?|items?|prospects?|sends?|leads?|slots?))?(?=$|[\s,;.)])/g,
      (_match, kind: string, operator: string | undefined, value: string, unit: string | undefined) => {
        thresholds.push(`${kind}:${operator ?? ''}:${value.replace(',', '.')}:${unit ?? ''}`)
        return `${kind} <limit>`
      })
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/g, '<time>')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<date>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/g, '<uuid>')
    .replace(/\b(?:run|exec(?:ution)?|attempt|count|total|sent|failed|sends?|leads?|slots?)\s*(?:id|#|:|=)?\s*\d+\b/g, '<count>')
    .replace(/\b\d+\s+(?:failures?|sends?|leads?|slots?|messages?|items?|attempts?|alerts?|errors?|drafts?|replies?)\b/g, '<count>')
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, '<percent>')
    .replace(/\s+/g, ' ').trim()
  const bytes = new TextEncoder().encode(`${stable}|limits:${thresholds.join('|')}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  return `auto:${n.tenant ?? '_'}:${n.source ?? '_'}:${n.family}:${n.severity ?? 'info'}:${hash}`
}

/** Ivan's bell and phone exclude technical chatter; rows remain available to diagnostics. */
export const MUTED_NOTIFICATION_FAMILIES = [
  'system_infra_alarm', 'system_watchdog_digest', 'seat_health',
  'content_sourcing_pipeline', 'arch_build_progress', 'lane_run_summary',
  'ops_other', 'runner_sync', 'smoke_push', 'smoke_test', 'relay_smoke',
] as const

export function isMutedNotificationFamily(family: string): boolean {
  return (MUTED_NOTIFICATION_FAMILIES as readonly string[]).includes(family)
}

/**
 * The bell's two tiers (Ivan's review, 2026-11-06: "the bell is a log, not a to-do list").
 * Activity = things that already happened and ask nothing of him: sent logs, published posts, run
 * summaries, digests (kinds `digest` and `done`). They fold into one quiet "Activity" group, never count
 * in the badge. A finished Claude answer is `done` too, but he asked for it, so it stays a needs-you row.
 * An error row is always `failed`, so a broken log still lands on top.
 */
export function isActivityRow(family: string, severity: string | null | undefined, title = ''): boolean {
  if (family === 'claude_turn') return false
  const sev = severity === 'error' || severity === 'attention' ? severity : 'info'
  const kind = kindFor(family, sev, title)
  return kind === 'digest' || kind === 'done'
}

/** Known families whose non-error rows are always Activity: the badge query leaves them out server side. */
export const ACTIVITY_FAMILIES: readonly string[] = KNOWN_FAMILIES.filter(f => isActivityRow(f, 'attention') && isActivityRow(f, 'info'))
