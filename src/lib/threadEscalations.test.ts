import { beforeEach, expect, it, vi } from 'vitest'
import { approveThreadEscalation, fetchThreadEscalations, type OpsDraft } from './ops'

let filters: Record<string, unknown>
let values: unknown
let receipt: { data: unknown[]; error: unknown }
const chain = {
  select: () => chain,
  update: (v: unknown) => { values = v; return chain },
  eq: (k: string, v: unknown) => { filters[`eq:${k}`] = v; return chain },
  is: (k: string, v: unknown) => { filters[`is:${k}`] = v; return chain },
  in: (k: string, v: unknown) => { filters[`in:${k}`] = v; return chain },
  order: () => chain, limit: () => chain,
  then: (resolve: (v: unknown) => unknown) => Promise.resolve(receipt).then(resolve),
}
vi.mock('./supabase', () => ({ supabase: { from: () => chain } }))
const row: OpsDraft = { id: 'q', client_id: 'rise', kind: 'escalation', slack_channel: 'C0BJ72F58BY', body: 'Original question',
  context: { prospect_id: 'lovisa' }, approved_at: null, sent_at: null, send_blocked_reason: null, created_at: '2026-10-25T16:00:00Z' }
beforeEach(() => { filters = {}; values = null; receipt = { data: [{ id: 'q' }], error: null } })

it('scopes the DM read to the exact prospect and both Rise aliases, keeping dispatch failures visible', async () => {
  await fetchThreadEscalations('lovisa', 'risedtc')
  expect(filters).toEqual({ 'eq:kind': 'escalation', 'eq:context->>prospect_id': 'lovisa', 'in:client_id': ['rise', 'risedtc'] })
})

it('never reads another seat for an unsupported client', async () => {
  expect(await fetchThreadEscalations('lovisa', 'ivan')).toEqual([])
  expect(filters).toEqual({})
})

it('approves only the exact pending snapshot and requires a returned row', async () => {
  await approveThreadEscalation(row, 'Edited question')
  expect(filters).toEqual({ 'eq:id': 'q', 'eq:kind': 'escalation', 'eq:client_id': 'rise', 'eq:body': 'Original question',
    'is:sent_at': null, 'is:approved_at': null, 'is:send_blocked_reason': null })
  expect(values).toMatchObject({ body: 'Edited question', send_blocked_reason: null })
  receipt.data = []
  await expect(approveThreadEscalation(row, 'Edited question')).rejects.toThrow('changed in another window')
})

it('retries only the exact failed dispatch snapshot', async () => {
  await approveThreadEscalation({ ...row, approved_at: '2026-10-25T16:02:00Z', send_blocked_reason: 'slack_failed' }, 'Retry question')
  expect(filters['eq:approved_at']).toBe('2026-10-25T16:02:00Z')
  expect(filters['eq:send_blocked_reason']).toBe('slack_failed')
  expect(values).toMatchObject({ body: 'Retry question', send_blocked_reason: null })
})

it('refuses queued and closed questions before issuing a write', async () => {
  for (const extra of [{ approved_at: '2026-10-25T16:02:00Z' }, { sent_at: '2026-10-25T16:02:00Z' }, { send_blocked_reason: 'discarded_by_operator' }]) {
    await expect(approveThreadEscalation({ ...row, ...extra }, 'Question')).rejects.toThrow('queued or closed')
  }
  expect(values).toBeNull()
})
