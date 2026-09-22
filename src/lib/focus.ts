// Today's first line (instantly-picks item 1, 2026-09-22): "N things need
// you. Everything else is running.", the one number that can never disagree
// with the rows under it, because it is built from the exact same arrays
// zone A renders (buildReplyItems / buildOpsItems, workQueue.ts), plus
// one-tap batches over the pending ops that are safe to approve as a group.
//
// Pure module: no supabase import here. The batch orchestration (runBatch)
// takes an injected `act` so the network call lives at the UI call site
// (wb/today/FocusBlock.tsx), never here: the whole point is that every case
// below is testable on literal inputs, no network.
import { outboundApproveUrl, pendingOps, type OpsDraft, type OpsKind } from './ops'
import { buildOpsItems, buildReplyItems } from './workQueue'
import type { Thread } from './inbox'
import { runwayDays, type GovernorRow, type PipelineRow } from './kpis'

export type Batch = {
  key: string
  kind: 'manual_invite' | 'comment_outbound'
  client: string | null
  ids: string[]
  label: string
}

export type FocusInput = {
  threads: Thread[]
  opsDrafts: OpsDraft[]
  now?: number
  // Ready-supply signal (brief §2.4): sum(sendable)/avg(sent_7d) per client,
  // same shape useToday() already fetches into health.pipeline/health.governor,
  // no new fetch anywhere this composes into.
  pipeline?: PipelineRow[]
  governor?: GovernorRow[]
}

export type FocusSummary = {
  count: number
  replyCount: number
  opsCount: number
  line: string
  batches: Batch[]
  singles: OpsDraft[]
  alarmLane: string | null
}

// Byte-for-byte the (unexported) LANE_NAME map in workQueue.ts:159, cannot
// import it (not exported, and workQueue.ts is out of this item's owned
// files), so this is the same copy kept in a second place on purpose rather
// than invented anew.
const LANE_NAME: Record<string, string> = { ivan: 'Your', risedtc: "Mattan's", arch: "Davorin's" }
export function laneName(client: string): string {
  return `${LANE_NAME[client] ?? client} lane`
}

// Only kinds whose approve is idempotent and has no per-item edit batch.
// Every other kind stays a single card (brief §3, locked 2026-09-22).
const BATCH_NOUN: Record<string, string> = { manual_invite: 'manual invites', comment_outbound: 'comments' }

// A draft is batchable when its approve is idempotent and has no per-item
// edit AND no per-item live call that itself needs a reader's confirm.
// manual_invite always qualifies (a double-stamp, nothing is sent).
// comment_outbound qualifies ONLY for the ivan lane (outboundApproveUrl set):
// that is the one poster-gate dispatch, safe to fire N times in sequence with
// one confirm up front. The risedtc lane (no approve_url) is clipboard +
// stamp, one paste per card, and stays a single card every time (fable
// review, HIGH, 2026-09-22).
function isBatchable(d: OpsDraft): boolean {
  return d.kind === 'manual_invite'
    || (d.kind === 'comment_outbound' && outboundApproveUrl(d) !== null)
}

function groupBatches(drafts: OpsDraft[], now: number): { batches: Batch[]; singles: OpsDraft[] } {
  const pending = pendingOps(drafts, now)
  const groups = new Map<string, OpsDraft[]>()
  const singles: OpsDraft[] = []
  for (const d of pending) {
    if (!isBatchable(d)) { singles.push(d); continue }
    const key = `${d.kind}:${d.client_id}`
    const arr = groups.get(key)
    if (arr) arr.push(d)
    else groups.set(key, [d])
  }
  const batches: Batch[] = []
  for (const [key, list] of groups) {
    // A group of 1 stays a single (brief §3).
    if (list.length === 1) { singles.push(list[0]); continue }
    const kind = list[0].kind as Batch['kind']
    const client = list[0].client_id
    const noun = BATCH_NOUN[kind] ?? kind
    batches.push({
      key, kind, client,
      ids: list.map(d => d.id),
      label: `${list.length} ${noun} · ${laneName(client)}`,
    })
  }
  return { batches, singles }
}

// Mirrors Overview.tsx's Q3 runway formula (dailyRate = max(7d average sent,
// today's governor daily_used), runwayDays(sendable, dailyRate)), grouped by
// CLIENT (money's lane axis) instead of Overview's sub-engine lane, since the
// alarm this line reports is per money-lane ("Mattan's lane is out of
// leads"). Deterministic: lowest client_id alphabetically wins when more
// than one lane is in alarm, so the line never flaps between renders.
export function supplyAlarmLane(pipeline: PipelineRow[], governor: GovernorRow[]): string | null {
  const byClient = new Map<string, { sendable: number; sent7: number }>()
  for (const r of pipeline) {
    const e = byClient.get(r.client_id) ?? { sendable: 0, sent7: 0 }
    e.sendable += r.sendable
    e.sent7 += r.sent_7d
    byClient.set(r.client_id, e)
  }
  const govDailyByClient = new Map<string, number>()
  for (const g of governor) {
    govDailyByClient.set(g.client_id, (govDailyByClient.get(g.client_id) ?? 0) + g.daily_used)
  }
  const clients = [...byClient.keys()].sort()
  for (const client of clients) {
    const e = byClient.get(client)!
    const avg7 = e.sent7 / 7
    const govDaily = govDailyByClient.get(client) ?? 0
    const dailyRate = Math.max(avg7, govDaily)
    if (runwayDays(e.sendable, dailyRate) < 1) return client
  }
  return null
}

function lineFor(count: number, alarmLane: string | null): string {
  if (alarmLane) return `${count} things need you. ${laneName(alarmLane)} is out of leads.`
  if (count === 0) return 'Nothing needs you. Everything is running.'
  if (count === 1) return '1 thing needs you. Everything else is running.'
  return `${count} things need you. Everything else is running.`
}

export function focusSummary(input: FocusInput): FocusSummary {
  const now = input.now ?? Date.now()
  // Same fns zone A calls (buildReplyItems / buildOpsItems, workQueue.ts):
  // the count can never disagree with the rows under it because it is not a
  // second reading of the data.
  const replyCount = buildReplyItems(input.threads, now).length
  const opsCount = buildOpsItems(input.opsDrafts, now).length
  const count = replyCount + opsCount
  const { batches, singles } = groupBatches(input.opsDrafts, now)
  const alarmLane = supplyAlarmLane(input.pipeline ?? [], input.governor ?? [])
  return { count, replyCount, opsCount, line: lineFor(count, alarmLane), batches, singles, alarmLane }
}

// ---------------------------------------------------------------------------
// Batch orchestration, pure and injectable (brief §2.7). `act` is the real
// per-id approve/discard call, supplied by the UI layer (FocusBlock.tsx),
// wrapping the exact same functions OpsScreen/PendingCard use. Kept here so
// the whole flow (still-pending filter, sequential run, partial-failure
// reporting) is covered by literal-input tests, no network.
// ---------------------------------------------------------------------------

// Only the ids that are STILL pending right now (brief §2.7: "approves only
// the ids still pending"). An id discarded or approved out of band between
// the batch forming and the tap is skipped, not retried.
export function pendingIdsOf(batch: Batch, drafts: OpsDraft[]): string[] {
  const byId = new Map(drafts.map(d => [d.id, d]))
  return batch.ids.filter(id => {
    const d = byId.get(id)
    return !!d && !d.approved_at && !d.sent_at && !d.send_blocked_reason
  })
}

export type BatchAct = (id: string) => Promise<void>
export type BatchRunResult = {
  succeeded: string[]
  failed: { id: string; error: string }[]
}

// Sequential, not parallel: each id is its own real approve (a comment gate
// dispatch, a double-stamp write), and running them one at a time is what
// makes "5 of 6 approved, 1 failed" a true sentence rather than a race.
export async function runBatch(ids: string[], act: BatchAct): Promise<BatchRunResult> {
  const succeeded: string[] = []
  const failed: { id: string; error: string }[] = []
  for (const id of ids) {
    try {
      await act(id)
      succeeded.push(id)
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { succeeded, failed }
}

export function batchResultLine(r: BatchRunResult, total: number): string {
  if (r.failed.length === 0) return `${total} of ${total} approved.`
  return `${r.succeeded.length} of ${total} approved, ${r.failed.length} failed: open`
}
