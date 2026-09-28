import { beforeEach, describe, expect, it, vi } from 'vitest'
import { msg, owedNoDraft, threads } from '../d/dms/fixtures'
const db = vi.hoisted(() => ({ rows: [] as unknown[], insert: vi.fn(), reads: 0 }))
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) }, from: () => ({
  select: () => ({ eq: async () => { db.reads++; return { data: db.rows, error: null } } }),
  insert: db.insert,
}) } }))
const fetchDraft = vi.fn()
vi.stubGlobal('window', { fetch: fetchDraft })
import { requestDmDraft } from './dmDraft'

const make = () => threads(owedNoDraft('tetiana', { client_id: 'arch', prospect_name: 'Tetiana' }))[0]
beforeEach(() => { vi.clearAllMocks(); db.reads = 0; db.insert.mockResolvedValue({ error: null }) })

describe('direct DM drafting', () => {
  it('allows drafting after an old hold was answered and a new inbound arrived', async () => {
    const base = make()
    const hold = msg({ prospect_id: 'tetiana', client_id: 'arch', message_text: '', created_at: '2026-09-27T10:00:00Z', send_blocked_at: '2026-09-27T10:00:00Z', send_blocked_reason: 'owner_confirmation' })
    const answer = msg({ prospect_id: 'tetiana', client_id: 'arch', message_text: 'Here is the answer.', created_at: '2026-09-27T11:00:00Z', sent_at: '2026-09-27T11:00:00Z' })
    const inbound = msg({ prospect_id: 'tetiana', client_id: 'arch', direction: 'inbound', message_text: 'Thanks, what next?', created_at: '2026-09-27T12:00:00Z', sent_at: '2026-09-27T12:00:00Z' })
    const t = threads([...base.messages, hold, answer, inbound])[0]
    db.rows = t.messages
    fetchDraft.mockResolvedValue({ ok: true, json: async () => ({ reply: 'Here is the next step.', input_message_ids: t.messages.filter(m => m.id !== hold.id).map(m => m.id) }) })
    await requestDmDraft(t)
    expect(db.insert).toHaveBeenCalled()
  })

  it('saves a generated reply unapproved with model provenance and the actual thread identity', async () => {
    const t = make(); db.rows = t.messages
    fetchDraft.mockResolvedValue({ ok: true, json: async () => ({ reply: 'Thanks for letting me know.', input_message_ids: t.messages.map(m => m.id) }) })
    await requestDmDraft(t)
    expect(db.reads).toBe(2)
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      prospect_id: 'tetiana', message_text: 'Thanks for letting me know.',
      sent_at: null, approved_at: null, ai_model: 'inbox_on_demand_reply',
    }))
    expect(JSON.parse(fetchDraft.mock.calls[0][1].body)).toEqual({ prospect_id: 'tetiana' })
  })

  it.each(['{"reply":null,"reason":"Confirm pricing with Davorin."}', 'Here is what I would do...', '{"reply":"","reason":null}'])('never saves an explanation or invalid output: %s', async raw => {
    const t = make(); db.rows = t.messages
    fetchDraft.mockResolvedValue({ ok: true, json: async () => JSON.parse(raw) })
    await expect(requestDmDraft(t)).rejects.toThrow()
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('does not save when the conversation changes during generation', async () => {
    const t = make(); db.rows = t.messages
    fetchDraft.mockImplementation(async () => {
      db.rows = [...t.messages, msg({ prospect_id: 'tetiana', direction: 'inbound', message_text: 'New information' })]
      return { ok: true, json: async () => ({ reply: 'Old reply', input_message_ids: t.messages.map(m => m.id) }) }
    })
    await expect(requestDmDraft(t)).rejects.toThrow(/conversation changed/i)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('surfaces a model error and creates no draft', async () => {
    const t = make(); db.rows = t.messages
    fetchDraft.mockImplementation(async () => { return { ok: false, json: async () => ({ error: 'Drafting timed out.' }) } })
    await expect(requestDmDraft(t)).rejects.toThrow()
    expect(db.insert).not.toHaveBeenCalled()
  })
})


it('does not draft when a fresh owner question replaced the retry failure', async () => {
  const t = make()
  db.rows = [...t.messages, msg({ prospect_id: 'tetiana', client_id: 'arch', message_text: '', send_blocked_at: '2026-09-28T10:00:00Z', send_blocked_reason: 'owner_confirmation' })]
  await expect(requestDmDraft(t)).rejects.toThrow(/owner answer/i)
  expect(fetchDraft).not.toHaveBeenCalled()
})
