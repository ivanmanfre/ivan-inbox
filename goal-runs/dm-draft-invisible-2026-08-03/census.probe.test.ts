// Census through the SHIPPED functions (never a reimplementation) on the live
// snapshot in rows.json — what the DMs surface would actually render.
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { groupThreads, threadBucket, filterByStatus, filterThreads, needsAnswer, type InboxMessage } from '../../src/lib/inbox'

const DIR = new URL('.', import.meta.url).pathname
const rows = JSON.parse(readFileSync(`${DIR}/rows.json`, 'utf8')) as InboxMessage[]
const flagged = new Set(JSON.parse(readFileSync(`${DIR}/flagged.json`, 'utf8')) as string[])

describe('live census', () => {
  it('prints what each status shows', () => {
    const threads = groupThreads(rows, flagged)
    const convos = filterThreads(threads, 'all')
    const counts: Record<string, number> = {}
    for (const t of convos) counts[threadBucket(t)] = (counts[threadBucket(t)] ?? 0) + 1
    console.log('buckets:', counts)
    for (const s of ['needs', 'answer', 'approve', 'waiting', 'all'] as const) {
      console.log(`  status=${s} -> ${filterByStatus(convos, s).length} rows`)
    }

    const withDraft = threads.filter(t => t.draft !== null)
    console.log(`\nthreads carrying a pending draft: ${withDraft.length}`)
    for (const t of withDraft) {
      console.log(`  ${t.prospect_name} (${t.client_id}) stage=${t.stage} bucket=${threadBucket(t)} ` +
        `needsAnswer=${needsAnswer(t)} stale=${t.draftStale} draftAt=${t.draft!.created_at}`)
    }

    // The thread behind today's DM response.
    const today = threads.filter(t => t.messages.some(m =>
      m.direction === 'inbound' && (m.sent_at ?? m.created_at) >= '2026-08-03'))
    console.log(`\nthreads with an inbound today: ${today.length}`)
    for (const t of today) {
      console.log(`  ${t.prospect_name} (${t.client_id}) id=${t.prospect_id} stage=${t.stage} ` +
        `bucket=${threadBucket(t)} draft=${t.draft ? 'YES' : 'none'} flagged=${t.needsManualReply}`)
      for (const m of t.messages.slice(-4)) {
        console.log(`      ${m.direction.padEnd(8)} ${m.message_type ?? '-'} sent=${m.sent_at ?? 'null'} ` +
          `created=${m.created_at} ${JSON.stringify((m.message_text ?? '').slice(0, 60))}`)
      }
    }
  })
})

// Does a thread that has BOTH a fresh inbound and a pending AI draft ever reach
// the 'approve' bucket — i.e. does the DraftCard with the reply text render in
// the list? Synthetic rows, shipped functions.
describe('bucket precedence: fresh inbound + pending draft', () => {
  it('shows which bucket wins', () => {
    const base = {
      prospect_id: 'p1', prospect_name: 'Test Person', prospect_company: null,
      prospect_headline: null, prospect_stage: 'replied', prospect_email: null,
      profile_photo_url: null, campaign_name: 'c', client_id: 'ivan',
      channel: 'linkedin' as const, message_type: 'dm', ai_model: null,
      unipile_chat_id: null, read_at: null, send_blocked_at: null,
      send_blocked_reason: null, approved_at: null,
    }
    const now = new Date()
    const iso = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60_000).toISOString()
    const rows = [
      { ...base, id: 'm1', direction: 'outbound' as const, message_text: 'our inmail',
        sent_at: iso(180), created_at: iso(180) },
      { ...base, id: 'm2', direction: 'inbound' as const, message_text: 'Who is Kyle Hunt again?',
        sent_at: iso(40), created_at: iso(38) },
      // the AI reply draft: outbound, no sent_at / approved_at / send_blocked_at
      { ...base, id: 'm3', direction: 'outbound' as const, message_text: 'the drafted reply',
        sent_at: null, created_at: iso(20) },
    ] as InboxMessage[]
    const [t] = groupThreads(rows)
    console.log('draft present:', t.draft !== null, '| needsAnswer:', needsAnswer(t),
      '| bucket:', threadBucket(t))
    console.log("filterByStatus 'approve' (the Draft ready chip) ->", filterByStatus([t], 'approve').length, 'rows')
    console.log("filterByStatus 'answer' ->", filterByStatus([t], 'answer').length, 'rows')
  })
})
