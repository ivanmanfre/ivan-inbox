import { beforeEach, describe, expect, it, vi } from 'vitest'

// Jonathan's seat: reply drafts are inserted HELD (awaiting_client_review, send_blocked_at set). The inbox must
// show them as pending drafts and approve ONE row through its own RPC, without opening the hold to any other lane.
const calls: { table?: string; op: string; args: unknown[] }[] = []
let readRow: Record<string, unknown> | null = null
const chain = (table: string, result: () => unknown) => {
  const q: Record<string, unknown> = {}
  for (const op of ['select', 'update', 'eq', 'is', 'or', 'in']) q[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return q }
  q.single = () => Promise.resolve({ data: readRow, error: null })
  q.maybeSingle = () => Promise.resolve({ data: readRow, error: null })
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res)
  return q
}
const rpc = vi.fn()
vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => chain(table, () => ({ data: [{ id: 'x' }], error: null })),
    rpc: (...args: unknown[]) => { calls.push({ op: 'rpc', args }); return rpc(...args) },
  },
}))

import { canSendRejectedDm } from './rejectedDm'
import { approveDraft, groupThreads, holdReason, isDraft, isSwishdmReply, isSwishdmReplyHold, restoreDraft, saveDraftText, sendFailed, swishdmPageUrl, type InboxMessage } from './inbox'

const token = 'abcdefghijklmnopqrst'
const url = `https://madebyswishdm.com/compare/${token}/`
const reply: InboxMessage = {
  id: 'r1', prospect_id: 'p1', direction: 'outbound', message_text: 'Looks like that landed, Sam.', message_type: 'dm', channel: 'linkedin',
  sent_at: null, approved_at: null, read_at: null, created_at: '2026-10-19T10:00:00Z', send_blocked_at: '2026-10-19T10:00:00Z',
  send_blocked_reason: 'awaiting_client_review', unipile_chat_id: null, ai_model: 'swishdm_reply_writer_v1',
  prospect_name: 'Sam Lee', prospect_company: 'Acme', prospect_headline: null, prospect_stage: 'swishdm_replied', prospect_email: null,
  profile_photo_url: null, campaign_name: 'SwishDM - Anchor engagers', client_id: 'swishdm', prospect_linkedin_url: null, chat_provider_id: null,
  snoozed_until: null, snoozed_at: null,
}
const inbound: InboxMessage = { ...reply, id: 'i1', direction: 'inbound', ai_model: null, send_blocked_at: null, send_blocked_reason: null, message_text: 'sure, send them', created_at: '2026-10-19T09:00:00Z', sent_at: '2026-10-19T09:00:00Z' }
const firstList: InboxMessage = { ...reply, id: 'f1', ai_model: 'swishdm_first_list_v1 (template + reviewed fills)', message_type: 'connection_note' }

beforeEach(() => { calls.length = 0; rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null }); readRow = null })

describe('a held SwishDM reply is a pending draft', () => {
  it('is a draft, and not a failed send', () => {
    expect(isSwishdmReplyHold(reply)).toBe(true)
    expect(isSwishdmReply(reply)).toBe(true)
    expect(isDraft(reply)).toBe(true)
    expect(sendFailed(reply)).toBe(false)
    expect(groupThreads([inbound, reply])[0].draft?.id).toBe('r1')
  })
  it('only the reply writer rows on the SwishDM seat count: first-list rows stay hidden, other seats are untouched', () => {
    expect(isDraft(firstList)).toBe(false)
    expect(isDraft({ ...reply, client_id: 'arch' })).toBe(false)
    expect(isDraft({ ...reply, client_id: 'ivan' })).toBe(false)
    expect(isDraft({ ...reply, send_blocked_reason: 'something_else' })).toBe(false)
    expect(isDraft({ ...reply, approved_at: '2026-10-19T11:00:00Z' })).toBe(false)
    expect(isDraft({ ...reply, send_blocked_reason: 'discarded_in_inbox' })).toBe(false)
  })
  it('a held first-list row is not drawn as "Send failed" either (it is waiting for review, nothing was attempted)', () => {
    expect(sendFailed(firstList)).toBe(false)
    expect(sendFailed({ ...reply, send_blocked_reason: 'send_failed_400: check LinkedIn' })).toBe(true)
  })
  it('a page-link reply tells Ivan that approving puts the page live; a plain one has no warning', () => {
    const withPage = { ...reply, draft_evidence: { page_token: token, page_url: url } as never }
    expect(swishdmPageUrl(withPage)).toBe(url)
    expect(holdReason(withPage)).toContain(url)
    expect(holdReason(withPage)).toMatch(/public, not indexed/)
    expect(holdReason(reply)).toBeNull()
    expect(swishdmPageUrl({ ...withPage, client_id: 'arch' })).toBeNull()
    expect(swishdmPageUrl({ ...reply, draft_evidence: { page_url: 'https://evil.example/compare/abcdefghijklmnopqrst/' } as never })).toBeNull()
  })
})

describe('no override path around the review hold', () => {
  it('a held SwishDM reply never offers Send anyways', () => {
    expect(canSendRejectedDm(reply)).toBe(false)
    // 2026-10-19: a SwishDM row is never sent from the inbox, not even a real failure. The SwishDM senders own
    // every send on Jonathan's seat, and a failed one needs a person to check LinkedIn first.
    expect(canSendRejectedDm({ ...reply, send_blocked_reason: 'send_failed_400: check LinkedIn' })).toBe(false)
  })
})

describe('approve, edit, skip', () => {
  it('approve goes through the SwishDM RPC with the evidence it was read with', async () => {
    readRow = { ai_model: 'swishdm_reply_writer_v1', draft_evidence: { lane: 'swishdm_reply' } }
    await approveDraft('r1', 'Edited text')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('approve_swishdm_reply_draft', { p_message_id: 'r1', p_text: 'Edited text', p_expected_evidence: { lane: 'swishdm_reply', _reviewed_email: { recipient_email: null, email_mirror_text: null } } })
  })
  it('every other draft still uses the shared RPC', async () => {
    readRow = { ai_model: 'rise_reply_draft_v1', draft_evidence: { a: 1 } }
    await approveDraft('r2', 'Text')
    expect(rpc.mock.calls[0][0]).toBe('approve_inbox_pipeline_draft')
  })
  it('a refused approval surfaces the error', async () => {
    readRow = { ai_model: 'swishdm_reply_page_v1', draft_evidence: {} }
    rpc.mockResolvedValue({ data: null, error: new Error('They wrote again after this draft.') })
    await expect(approveDraft('r1', 'x')).rejects.toThrow(/wrote again/)
  })
  it('edit saves while held, scoped to the reply writer rows only', async () => {
    await saveDraftText('r1', 'New text')
    const or = calls.find(c => c.op === 'or')!.args[0] as string
    expect(or).toContain('and(send_blocked_reason.eq.awaiting_client_review,ai_model.like.swishdm_reply_*)')
    expect(calls.find(c => c.op === 'update')!.args[0]).toEqual({ message_text: 'New text' })
  })
  it('bringing a skipped reply back restores its hold, never an unheld draft', async () => {
    readRow = { ai_model: 'swishdm_reply_writer_v1' }
    await restoreDraft('r1')
    const upd = calls.find(c => c.op === 'update')!.args[0] as Record<string, unknown>
    expect(upd.send_blocked_reason).toBe('awaiting_client_review')
    expect(upd.send_blocked_at).toEqual(expect.any(String))
  })
  it('restoring any other draft is unchanged', async () => {
    readRow = { ai_model: 'rise_reply_draft_v1' }
    await restoreDraft('r2')
    expect(calls.find(c => c.op === 'update')!.args[0]).toEqual({ send_blocked_reason: null, send_blocked_at: null, discard_mode: null })
  })
})
