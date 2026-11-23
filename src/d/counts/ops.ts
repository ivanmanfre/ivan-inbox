import { AUDN_KIND, countsAsWaiting, pendingOps, type OpsDraft } from '../../lib/ops'
import { supabase } from '../../lib/supabase'
import { seatOf, type Seat } from '../seats'

// Ops "Waiting on you", per seat: THE Ops number (lib/ops.ts opsBadge), split
// by seat instead of summed. Every pending reply, card and task counts, except comment
// ideas and newsjacks (countsAsWaiting: they show on the board, never in the
// number). ops_drafts' legacy client 'rise' is Rise.
// Per seat; with `other` (clients with no seat) they add up to today's single Ops badge.
export type OpsWaiting = Record<Seat, number> & {
  /** Pending cards for a client with no seat in this app (drawn as their own lane on Ops, never dropped). */
  other?: number
}

export function opsWaitingBySeat(rows: OpsDraft[], now: number = Date.now()): OpsWaiting {
  const out: OpsWaiting = { ivan: 0, risedtc: 0, arch: 0, swishdm: 0, anna: 0, leah: 0 }
  for (const d of pendingOps(rows, now)) {
    if (!countsAsWaiting(d)) continue
    const s = seatOf(d.client_id)
    if (s) out[s] += 1
    else out.other = (out.other ?? 0) + 1
  }
  return out
}

// X items no longer count here: they count on the X tab in Content and in Content's number (useXWaiting).
export async function fetchOpsWaiting(now: number = Date.now()): Promise<OpsWaiting> {
  return opsWaitingBySeat(await fetchOpsCountRows(), now)
}

// 2026-11-15 speed review: the number read the whole Ops list (300 rows with body and context, ~226 KB)
// on every open of every place, and Home and Ops read it again for their own lists. The number needs
// only the columns and context keys `pendingOps` reads (dry_run, presentation, posted_at, expires_at),
// so it reads only those, over the SAME rows fetchOpsDrafts reads (same filters, order and limit).
export const OPS_COUNT_COLUMNS = 'id,client_id,kind,created_at,approved_at,sent_at,send_blocked_reason,'
  + 'dry_run:context->dry_run,presentation:context->>presentation,posted_at:context->>posted_at,expires_at:context->>expires_at'
type OpsCountRow = Omit<OpsDraft, 'body' | 'context' | 'slack_channel'> & { dry_run: unknown; presentation: string | null; posted_at: string | null; expires_at: string | null }

export function opsCountRow(r: OpsCountRow): OpsDraft {
  const context: Record<string, unknown> = {}
  if (r.dry_run !== null && r.dry_run !== undefined) context.dry_run = r.dry_run
  if (r.presentation != null) context.presentation = r.presentation
  if (r.posted_at != null) context.posted_at = r.posted_at
  if (r.expires_at != null) context.expires_at = r.expires_at
  return { id: r.id, client_id: r.client_id, kind: r.kind, created_at: r.created_at, approved_at: r.approved_at, sent_at: r.sent_at,
    send_blocked_reason: r.send_blocked_reason, body: '', slack_channel: '', context: context as OpsDraft['context'] }
}

async function fetchOpsCountRows(): Promise<OpsDraft[]> {
  const { data, error } = await supabase.from('ops_drafts').select(OPS_COUNT_COLUMNS)
    .neq('kind', AUDN_KIND).neq('kind', 'escalation')
    .order('created_at', { ascending: false }).limit(300)
  if (error) throw error
  return ((data ?? []) as unknown as OpsCountRow[]).map(opsCountRow)
}
