import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ from: vi.fn(), result: { data: [{ id: 'failed' }], error: null } as { data: { id: string }[] | null; error: { message: string } | null }, filters: [] as unknown[][] }))
vi.mock('./supabase', () => ({ supabase: { from: db.from } }))
import { opsBadge, pendingOps, retryFailedCommentReply, type OpsDraft } from './ops'
import { readBoard } from '../d/ops/model'
import { opsWaitingBySeat } from '../d/counts/ops'

const failed: OpsDraft = {
  id: 'failed', client_id: 'risedtc', kind: 'comment_reply', slack_channel: '', body: 'Reply',
  context: { posted_at: '2026-10-15T15:30:00Z' }, created_at: '2026-10-15T15:31:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: 'post_failed: Error: unipile 422',
}
const now = Date.parse('2026-10-16T14:00:00Z')

beforeEach(() => {
  db.filters = []
  db.result = { data: [{ id: 'failed' }], error: null }
  db.from.mockReset().mockImplementation(() => {
    const q: Record<string, unknown> = {}
    for (const method of ['update', 'eq', 'is']) q[method] = (...args: unknown[]) => { db.filters.push([method, ...args]); return q }
    q.select = async () => db.result
    return q
  })
})

describe('failed comment replies', () => {
  it('remain visible and counted in the Rise lane after reload', () => {
    expect(pendingOps([failed], now)).toEqual([failed])
    expect(opsBadge([failed], now).n).toBe(1)
    expect(opsWaitingBySeat([failed], now).risedtc).toBe(1)
    expect(readBoard([failed], new Set(), now).lanes.risedtc).toEqual([failed])
    expect(readBoard([failed], new Set(), now).waiting.risedtc).toBe(1)
  })
  it('never revives answered, discarded, sent, approved, stale or other blocked kinds', () => {
    const rows: OpsDraft[] = [
      { ...failed, send_blocked_reason: 'already_answered_on_linkedin' },
      { ...failed, send_blocked_reason: 'discarded_by_operator' },
      { ...failed, sent_at: '2026-10-16T12:00:00Z' },
      { ...failed, approved_at: '2026-10-16T12:00:00Z' },
      { ...failed, context: { posted_at: '2026-10-01T12:00:00Z' } },
      { ...failed, kind: 'update' },
    ]
    expect(pendingOps(rows, now)).toEqual([])
  })
  it('clears only the same failed unsent reply before an operator retry', async () => {
    await retryFailedCommentReply(failed)
    expect(db.from).toHaveBeenCalledWith('ops_drafts')
    expect(db.filters).toEqual(expect.arrayContaining([
      ['eq', 'id', failed.id], ['eq', 'kind', 'comment_reply'],
      ['eq', 'send_blocked_reason', failed.send_blocked_reason],
      ['is', 'approved_at', null], ['is', 'sent_at', null],
    ]))
  })
  it('refuses to retry when another device changed the card', async () => {
    db.result.data = []
    await expect(retryFailedCommentReply(failed)).rejects.toThrow(/changed/)
  })
  it('does not clear any permanent block', async () => {
    await retryFailedCommentReply({ ...failed, send_blocked_reason: 'already_answered_on_linkedin' })
    expect(db.from).not.toHaveBeenCalled()
  })
})
