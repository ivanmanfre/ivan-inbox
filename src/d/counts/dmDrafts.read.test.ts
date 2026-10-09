// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { InboxMessage } from '../../lib/inbox'
import { fetchManualReplyIds } from '../../lib/inbox'
import { fetchSolvedAt } from './solved'
import { countDmSeatFromRows, fetchDmSeatCount } from './dmDrafts'

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: h }))
vi.mock('../../lib/inbox', async orig => ({ ...await orig<typeof import('../../lib/inbox')>(), fetchManualReplyIds: vi.fn() }))
vi.mock('./solved', async orig => ({ ...await orig<typeof import('./solved')>(), fetchSolvedAt: vi.fn() }))

const NOW = Date.parse('2026-10-09T18:00:00Z')
let n = 0
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
function row(pid: string, client: string | null, patch: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: `r${++n}`, prospect_id: pid, direction: 'outbound', message_text: 'hello', message_type: 'dm', channel: 'linkedin',
    sent_at: null, approved_at: null, read_at: null, created_at: at(2), send_blocked_at: null,
    send_blocked_reason: null, unipile_chat_id: null, ai_model: 'reply_v1', prospect_name: pid,
    prospect_company: null, prospect_headline: null, prospect_stage: 'replied', prospect_email: null,
    profile_photo_url: null, campaign_name: 'c', client_id: client as string, prospect_linkedin_url: null,
    chat_provider_id: null, snoozed_until: null, snoozed_at: null, ...patch,
  }
}
function thread(pid: string, client: string | null): InboxMessage[] {
  return [
    row(pid, client, { sent_at: at(30), created_at: at(30) }),
    row(pid, client, { direction: 'inbound', message_text: 'Tell me more', sent_at: at(5), created_at: at(5) }),
    row(pid, client, { created_at: at(4) }),
  ]
}
function fallbackRows(rows: InboxMessage[]) {
  h.from.mockImplementation(() => {
    let selected = ''
    const q = {
      select: (cols: string) => { selected = cols; return q }, or: () => q, eq: () => q, is: () => q,
      gte: () => q, in: () => q, order: () => q,
      range: async () => ({ data: selected === '*' ? rows : [{ prospect_id: rows[0].prospect_id }], error: null }),
    }
    return q
  })
}

beforeEach(() => {
  n = 0
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'u1' } }))
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  h.rpc.mockReset(); h.from.mockReset()
  vi.mocked(fetchManualReplyIds).mockReset().mockResolvedValue(new Set())
  vi.mocked(fetchSolvedAt).mockReset().mockResolvedValue(new Map())
})
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

it('shares one in-flight complete-history RPC across seats and applies the existing classifier and probes', async () => {
  const rows = [...thread('i', null), ...thread('r', 'risedtc'), ...thread('a', 'arch')]
  let release!: (x: { data: InboxMessage[]; error: null }) => void
  h.rpc.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const all = Promise.all([fetchDmSeatCount('ivan'), fetchDmSeatCount('risedtc'), fetchDmSeatCount('arch')])
  expect(h.rpc).toHaveBeenCalledTimes(1)
  expect(h.rpc).toHaveBeenCalledWith('inbox_phone_first_rows_r2')
  release({ data: rows, error: null })
  const got = await all
  expect(got).toEqual(['ivan', 'risedtc', 'arch'].map(seat => countDmSeatFromRows(rows, seat as 'ivan' | 'risedtc' | 'arch', NOW)))
  expect(fetchManualReplyIds).toHaveBeenCalledTimes(3)
  expect(fetchSolvedAt).toHaveBeenCalledTimes(3)
  expect(h.from).not.toHaveBeenCalled()
  h.rpc.mockResolvedValue({ data: rows, error: null })
  await fetchDmSeatCount('ivan')
  expect(h.rpc).toHaveBeenCalledTimes(2) // no durable copy after the flight
})

it('falls back to complete historical candidate threads only when the RPC is missing', async () => {
  const rows = thread('i', 'ivan')
  h.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
  fallbackRows(rows)
  expect(await fetchDmSeatCount('ivan')).toEqual(countDmSeatFromRows(rows, 'ivan', NOW))
  expect(h.from).toHaveBeenCalled()
  h.rpc.mockClear(); h.from.mockClear()
  expect(await fetchDmSeatCount('ivan', NOW)).toEqual(countDmSeatFromRows(rows, 'ivan', NOW))
  expect(h.rpc).not.toHaveBeenCalled() // explicit historical time never uses live snapshot
})

it('propagates real RPC failures and malformed payloads without claiming an empty count', async () => {
  h.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } })
    .mockResolvedValueOnce({ data: {}, error: null })
  await expect(fetchDmSeatCount('ivan')).rejects.toMatchObject({ code: '42501' })
  await expect(fetchDmSeatCount('ivan')).rejects.toThrow('Could not read DM count threads')
  expect(h.from).not.toHaveBeenCalled()
})

it('does not share an in-flight read across signed-in users', async () => {
  const releases: ((x: { data: InboxMessage[]; error: null }) => void)[] = []
  h.rpc.mockImplementation(() => new Promise(resolve => { releases.push(resolve) }))
  const first = fetchDmSeatCount('ivan')
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'u2' } }))
  const second = fetchDmSeatCount('ivan')
  expect(h.rpc).toHaveBeenCalledTimes(2)
  releases[0]({ data: [], error: null })
  releases[1]({ data: [], error: null })
  expect(await Promise.all([first, second])).toEqual([{ drafts: 0, needs: 0 }, { drafts: 0, needs: 0 }])
})

it('keeps manual-reply and solved probes as required reads', async () => {
  const rows = thread('i', 'ivan')
  h.rpc.mockResolvedValue({ data: rows, error: null })
  vi.mocked(fetchManualReplyIds).mockRejectedValueOnce(new Error('flags failed'))
  await expect(fetchDmSeatCount('ivan')).rejects.toThrow('flags failed')
  vi.mocked(fetchSolvedAt).mockRejectedValueOnce(new Error('solves failed'))
  await expect(fetchDmSeatCount('ivan')).rejects.toThrow('solves failed')
  expect(h.from).not.toHaveBeenCalled()
})
