import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE DATE WRITE, asserted at the wire.
//
// 🔴 This suite exists because the calendar's move control is pointed at a
// PAYING CLIENT'S live board: operator_schedule_draft sets status='scheduled'
// AND board_visible=true, so a wrong argument does not fail quietly — it
// publishes something. Nothing here touches the network; the rpc is mocked and
// the assertion is on the payload SHAPE and on which function name it is sent
// to. Every expectation mirrors the live function body (pg_get_functiondef,
// 2026-08-07).

type Call = { name: string; args: Record<string, unknown> }
const rpcCalls: Call[] = []
let rpcQueue: Array<{ data: unknown; error: unknown }> = []

vi.mock('./supabase', () => ({
  supabase: {
    from: () => { throw new Error('a date move must never touch a table directly') },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return Promise.resolve(rpcQueue.shift() ?? { data: { ok: true }, error: null })
    },
  },
}))

const { scheduleDraftAt, CLIENT_OPS_GATE, ClientRpcError, clientRpcMessage } = await import('./content')
const { publishAtForDay } = await import('./calendarItems')

beforeEach(() => { rpcCalls.length = 0; rpcQueue = [] })

describe('scheduleDraftAt — the payload', () => {
  it('calls operator_schedule_draft with the three named params, and nothing else', async () => {
    rpcQueue = [{ data: { ok: true, scheduled_at: '2026-09-01T09:00:00Z' }, error: null }]
    await scheduleDraftAt('draft-1', '2026-09-01T09:00:00Z')
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('operator_schedule_draft')
    expect(rpcCalls[0].args).toEqual({
      p_gate: CLIENT_OPS_GATE,
      p_draft_id: 'draft-1',
      p_publish_at: '2026-09-01T09:00:00Z',
    })
    expect(Object.keys(rpcCalls[0].args)).toHaveLength(3)
  })

  it('the gate literal is the one operator_gate_ok hashes', () => {
    expect(CLIENT_OPS_GATE).toBe('clientops')
  })

  it('returns the date the DATABASE ended up holding, not the one we asked for', async () => {
    rpcQueue = [{ data: { ok: true, scheduled_at: '2026-09-01T13:00:00Z' }, error: null }]
    expect(await scheduleDraftAt('d', '2026-09-01T09:00:00Z')).toBe('2026-09-01T13:00:00Z')
  })

  it('falls back to what was sent when the row comes back without one', async () => {
    rpcQueue = [{ data: { ok: true }, error: null }]
    expect(await scheduleDraftAt('d', '2026-09-01T09:00:00Z')).toBe('2026-09-01T09:00:00Z')
  })

  it('the day the operator picked survives the round trip into the payload', async () => {
    const iso = publishAtForDay('2026-08-12T10:30:00Z', '2026-08-19')
    await scheduleDraftAt('d', iso)
    expect(rpcCalls[0].args.p_publish_at).toBe(iso)
    expect(new Date(String(rpcCalls[0].args.p_publish_at)).getDate()).toBe(19)
  })
})

describe('scheduleDraftAt — the refusals, in the server’s own words', () => {
  const refuses = async (code: string) => {
    rpcQueue = [{ data: { ok: false, error: code }, error: null }]
    return scheduleDraftAt('d', '2026-09-01T09:00:00Z').catch(e => e)
  }

  it('🔴 not_a_client_draft: the Ivan lane is refused BY THE DATABASE, not by us', async () => {
    const e = await refuses('not_a_client_draft') as { code: string; message: string }
    expect(e).toBeInstanceOf(ClientRpcError)
    expect(e.code).toBe('not_a_client_draft')
    expect(e.message).toContain('your own drafts')
  })

  it('awaiting_media keeps its own sentence — a regen clears image_urls', async () => {
    const e = await refuses('awaiting_media') as { message: string }
    expect(e.message).toBe(clientRpcMessage('awaiting_media'))
  })

  it('an unknown refusal keeps its raw code rather than being smoothed away', async () => {
    const e = await refuses('some_new_rule') as { message: string }
    expect(e.message).toContain('some_new_rule')
  })

  it('a transport error is an error, never a silent success', async () => {
    rpcQueue = [{ data: null, error: { message: 'network down' } }]
    await expect(scheduleDraftAt('d', '2026-09-01T09:00:00Z')).rejects.toThrow('network down')
  })
})
