import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDraftEvidence, groupThreads, type InboxMessage } from './inbox'

const { requests, rowsById, fail } = vi.hoisted(() => ({
  requests: [] as string[][], rowsById: new Map<string, unknown>(), fail: { value: false },
}))
vi.mock('./supabase', () => ({ supabase: { from: () => ({ select: () => ({
  in: (_column: string, ids: string[]) => {
    requests.push(ids)
    return Promise.resolve({ data: ids.filter(id => rowsById.has(id)).reverse().map(id => ({ id, draft_evidence: rowsById.get(id) })), error: fail.value ? new Error('unavailable') : null })
  },
}) }) } }))

beforeEach(() => { requests.length = 0; rowsById.clear(); fail.value = false })

describe('draft evidence fetch', () => {
  it('batches requested IDs without a 500-row cutoff or dependence on response order', async () => {
    const ids = Array.from({ length: 625 }, (_, i) => `draft-${i}`)
    ids.forEach(id => rowsById.set(id, { brief: { the_move: id } }))
    const result = await fetchDraftEvidence([...ids, ids[0]])
    expect(result.size).toBe(625)
    expect(result.get('draft-624')?.brief?.the_move).toBe('draft-624')
    expect(requests.flat()).toEqual(ids)
    expect(requests.every(batch => batch.length <= 100)).toBe(true)
  })

  it('makes no request with an empty list and surfaces a failed read to the existing degrade path', async () => {
    expect((await fetchDraftEvidence([])).size).toBe(0)
    expect(requests).toHaveLength(0)
    fail.value = true
    await expect(fetchDraftEvidence(['draft'])).rejects.toThrow('unavailable')
  })

  it('associates only current primary and companion drafts, including a lint-held draft', async () => {
    const base = { prospect_id: 'p', prospect_name: 'Test', client_id: 'arch', prospect_stage: 'replied', direction: 'outbound', channel: 'linkedin', message_type: 'arch_reply', message_text: 'draft', approved_at: null, sent_at: null, send_blocked_at: null, send_blocked_reason: null, created_at: '2026-09-08T10:00:00Z' } as InboxMessage
    const rows = [
      { ...base, id: 'superseded' },
      { ...base, id: 'current', created_at: '2026-09-08T11:00:00Z', send_blocked_at: '2026-09-08T11:01:00Z', send_blocked_reason: 'lint_unbacked_commitment' },
      { ...base, id: 'email', channel: 'email' as const, created_at: '2026-09-08T11:00:00Z' },
      { ...base, id: 'discarded', created_at: '2026-09-08T12:00:00Z', send_blocked_at: '2026-09-08T12:00:00Z', send_blocked_reason: 'discarded_in_inbox' },
    ]
    const ids = groupThreads(rows).flatMap(t => [t.draft, t.companionDraft].flatMap(m => m ? [m.id] : []))
    rowsById.set('current', { brief: { the_move: 'DM move' } })
    rowsById.set('email', { brief: { the_move: 'Email move' } })
    const evidence = await fetchDraftEvidence(ids)
    rows.forEach(row => { row.draft_evidence = evidence.get(row.id) })
    const thread = groupThreads(rows)[0]
    expect(new Set(requests.flat())).toEqual(new Set(['current', 'email']))
    expect(thread.draft?.draft_evidence?.brief?.the_move).toBe('DM move')
    expect(thread.companionDraft?.draft_evidence?.brief?.the_move).toBe('Email move')
    expect(rows[0].draft_evidence).toBeUndefined()
  })

  it('floats a pending draft for a 2+ day scan opener above newer threads, and only while it waits', () => {
    const base = { prospect_name: 'T', client_id: 'ivan', prospect_stage: 'dm_sent', direction: 'outbound', channel: 'linkedin', message_type: 'dm', message_text: 'x', approved_at: null, send_blocked_at: null, send_blocked_reason: null } as InboxMessage
    const rows = [
      { ...base, id: 'old-sent', prospect_id: 'opener', sent_at: '2026-09-20T10:00:00Z', created_at: '2026-09-20T10:00:00Z' },
      { ...base, id: 'bump', prospect_id: 'opener', sent_at: null, created_at: '2026-09-24T09:00:00Z', draft_evidence: { scan_open_days: 2 } },
      { ...base, id: 'newer', prospect_id: 'fresh', sent_at: '2026-09-24T11:00:00Z', created_at: '2026-09-24T11:00:00Z' },
      { ...base, id: 'one-day', prospect_id: 'once', sent_at: null, created_at: '2026-09-24T10:00:00Z', draft_evidence: { scan_open_days: 1 } },
    ] as InboxMessage[]
    expect(groupThreads(rows).map(t => t.prospect_id)).toEqual(['opener', 'fresh', 'once'])
    const sent = rows.map(r => r.id === 'bump' ? { ...r, sent_at: '2026-09-24T09:30:00Z' } : r)
    expect(groupThreads(sent).map(t => t.prospect_id)).toEqual(['fresh', 'once', 'opener'])
  })
})
