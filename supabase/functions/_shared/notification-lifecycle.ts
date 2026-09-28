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
