import { expect, it, vi } from 'vitest'
import { msg } from '../d/dms/fixtures'
import { statusOf } from '../d/dms/status'
import { groupThreads, needsAnswer } from './inbox'
import { withReactionQueues } from './swishdmReactionQueue'

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: () => ({ select: () => ({ in: read }) }) } }))

const base = { prospect_id: 'k', client_id: 'swishdm', prospect_stage: 'swishdm_connected' }
const dm = msg({ ...base, id: 'dm', approved_at: '2026-11-22T11:27:27Z' })
const reaction = msg({ ...base, id: 'rx', direction: 'inbound', message_text: '👍', sent_at: '2026-11-25T03:03:38Z' })
const now = Date.parse('2026-11-25T09:48:00Z')
const proof = { id: 'dm', approved_at: dm.approved_at, sequence_step: 1, lane: 'swishdm_first_list',
  queue_state: 'queued', queue_reason: 'reaction_fast_path', due_at: '2026-11-25T03:16:00Z' }

it('shows the first DM queued for an invite reaction and resurfaces a later inbound', async () => {
  read.mockResolvedValue({ data: [proof, { id: 'rx', is_reaction: true }] })
  const rows = await withReactionQueues([dm, reaction])
  const thread = groupThreads(rows)[0]
  expect(needsAnswer(thread, now)).toBe(false)
  expect(statusOf(thread, now).word).toBe('first DM queued')
  for (const extra of [
    { is_reaction: true, message_text: '👍', sent_at: '2026-11-25T03:25:00Z' },
    { is_reaction: false, message_text: 'Can you email it?', sent_at: '2026-11-25T03:02:00Z' },
  ]) expect(needsAnswer(groupThreads([...rows, { ...reaction, ...extra, id: 'extra' }])[0], now)).toBe(true)
})

it.each([{ deferred: { reason: 'profile_read_failed' } }, { stopped: true }, { send_blocked_reason: 'held' },
  { queue_reason: 'accepted' }, { approved_at: null }])('keeps the reaction visible when the sender cannot own it (%j)', async change => {
  read.mockResolvedValue({ data: [{ ...proof, ...change }, { id: 'rx', is_reaction: true }] })
  expect(needsAnswer(groupThreads(await withReactionQueues([dm, reaction]))[0], now)).toBe(true)
})
