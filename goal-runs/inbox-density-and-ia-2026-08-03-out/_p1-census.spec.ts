// PHASE 1 CENSUS — not a test, a live probe that runs through vitest so it uses
// the SHIPPED functions (groupThreads / inboxBreakdown / filterThreads) rather
// than a reimplementation. A reimplementation would only prove the census agrees
// with itself. Writes phase1-census.json.
//
// Run: npx vitest run goal-runs/inbox-density-and-ia-2026-08-03-out/_p1-census.spec.ts
import fs from 'fs'
import { it } from 'vitest'
import {
  groupThreads, inboxBreakdown, inboxWaitingCount, filterThreads, threadKind,
  type InboxMessage, type Thread,
} from '../../src/lib/inbox'
import { pendingDmLaneOps, pendingOps, type OpsDraft } from '../../src/lib/ops'

const DIR = 'goal-runs/inbox-density-and-ia-2026-08-03-out'

it('census', async () => {
  const db = await import('./_db.mjs') as {
    q: (p: string) => Promise<unknown[]>
    page: (p: string) => Promise<unknown[]>
  }
  const rows = await db.page('inbox_messages_v?select=*&order=created_at.asc,id.asc') as InboxMessage[]
  const flagged = await db.q('outreach_prospects?select=id&needs_manual_reply=eq.true&limit=1000') as { id: string }[]
  const opsRows = await db.q('ops_drafts?select=*&order=created_at.desc&limit=1000') as OpsDraft[]
  const ids = new Set(flagged.map(f => f.id))
  const threads = groupThreads(rows, ids)

  // What the INBOX surface renders (InboxScreen -> filterThreads(threads,'all')).
  const inboxRows = filterThreads(threads, 'all')
  // What the DMs surface renders today (DraftsScreen: threads.filter(t=>t.draft)).
  const dmRows = threads.filter(t => t.draft !== null)
  const b = inboxBreakdown(threads)

  const bucket = (t: Thread) => {
    const lastInbound = t.messages.filter(m => m.direction === 'inbound')
      .map(m => m.sent_at ?? m.created_at).sort().at(-1) ?? null
    const lastSent = t.messages.filter(m => m.direction === 'outbound' && m.sent_at)
      .map(m => m.sent_at!).sort().at(-1) ?? null
    const answer = t.unread > 0 && !(lastInbound !== null && lastSent !== null && lastSent > lastInbound)
    if (answer) return 'answer'
    if (t.draft !== null) return 'approve'
    if (t.needsManualReply) return 'flagged'
    return 'waiting'
  }

  const byBucket: Record<string, Thread[]> = { answer: [], approve: [], flagged: [], waiting: [] }
  for (const t of inboxRows) byBucket[bucket(t)].push(t)

  const out = {
    probed_at: new Date().toISOString(),
    raw: { inbox_messages_v_rows: rows.length, flagged_prospects: flagged.length, ops_drafts: opsRows.length },
    threads_total: threads.length,
    INBOX_surface_rows: inboxRows.length,
    DMs_surface_rows_today: dmRows.length,
    badge: { ...b, waiting_badge: inboxWaitingCount(threads) },
    by_bucket: Object.fromEntries(Object.entries(byBucket).map(([k, v]) => [k, {
      n: v.length,
      by_client: v.reduce<Record<string, number>>((a, t) => { a[t.client_id] = (a[t.client_id] ?? 0) + 1; return a }, {}),
      by_kind: v.reduce<Record<string, number>>((a, t) => { const k2 = threadKind(t); a[k2] = (a[k2] ?? 0) + 1; return a }, {}),
      sample: v.slice(0, 5).map(t => ({ name: t.prospect_name, client: t.client_id, stage: t.stage, unread: t.unread, flagged: t.needsManualReply, draft: !!t.draft })),
    }])),
    // Where each kind lands after the cut, verified by the same predicates the
    // surviving surface will use.
    ops: { pending_total: pendingOps(opsRows).length, pending_dm_lane: pendingDmLaneOps(opsRows).length },
    non_conversation_threads: threads.length - inboxRows.length,
  }
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(`${DIR}/phase1-census.json`, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
}, 120000)
