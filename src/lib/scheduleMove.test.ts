import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE DATE WRITE, asserted at the wire.
//
// 🔴 This suite exists because these two calls sit next to each other and one of
// them ARMS: operator_schedule_draft sets status='scheduled' AND
// board_visible=true, so a wrong argument there does not fail quietly — it
// publishes something on a paying client's board. operator_set_schedule_date
// (db/032) is the calendar's write and touches `scheduled_at` alone. WHICH NAME
// GOES ON THE WIRE is therefore the assertion that matters most here.
//
// Nothing touches the network; the rpc is mocked and the assertions are on the
// payload SHAPE and the function name. Every expectation mirrors a live function
// body (pg_get_functiondef, 2026-08-07).

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

const {
  scheduleDraftAt, setScheduleDateAt, CLIENT_OPS_GATE, ClientRpcError, clientRpcMessage,
} = await import('./content')
const { publishAtForDay, canMoveDate } = await import('./calendarItems')

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

// ---------------------------------------------------------------------------
// setScheduleDateAt — the CALENDAR's write. Date only, both lanes.
// ---------------------------------------------------------------------------

describe('setScheduleDateAt — the payload', () => {
  it('calls operator_set_schedule_date — NOT the arming rpc — with its three named params', async () => {
    rpcQueue = [{ data: { ok: true, id: 'draft-1', scheduled_at: '2026-09-01T09:00:00Z', status: 'review' }, error: null }]
    await setScheduleDateAt('draft-1', '2026-09-01T09:00:00Z')
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('operator_set_schedule_date')
    expect(rpcCalls[0].name).not.toBe('operator_schedule_draft')
    expect(rpcCalls[0].args).toEqual({
      p_gate: CLIENT_OPS_GATE,
      p_draft_id: 'draft-1',
      p_scheduled_at: '2026-09-01T09:00:00Z',
    })
    // 🔴 `p_publish_at` is the ARMING rpc's parameter name. If it ever appears
    // here the call is going to the wrong function, or to this one with an
    // argument it will ignore.
    expect(rpcCalls[0].args).not.toHaveProperty('p_publish_at')
    expect(Object.keys(rpcCalls[0].args)).toHaveLength(3)
  })

  it('returns the date the DATABASE ended up holding, not the one we asked for', async () => {
    rpcQueue = [{ data: { ok: true, scheduled_at: '2026-09-01T13:00:00Z' }, error: null }]
    expect(await setScheduleDateAt('d', '2026-09-01T09:00:00Z')).toBe('2026-09-01T13:00:00Z')
  })

  it('falls back to what was sent when the row comes back without one', async () => {
    rpcQueue = [{ data: { ok: true }, error: null }]
    expect(await setScheduleDateAt('d', '2026-09-01T09:00:00Z')).toBe('2026-09-01T09:00:00Z')
  })

  it('a transport error is an error, never a silent success', async () => {
    rpcQueue = [{ data: null, error: { message: 'network down' } }]
    await expect(setScheduleDateAt('d', '2026-09-01T09:00:00Z')).rejects.toThrow('network down')
  })
})

describe('the calendar move, end to end at the wire', () => {
  // What the component does on Move, with the network mocked: pick a day →
  // publishAtForDay → setScheduleDateAt. Both lanes, because the RPC no longer
  // has a lane.
  const move = async (row: { status: string; client_id: string | null }, at: string | null, day: string) => {
    if (!canMoveDate(row)) return { offered: false as const }
    const iso = publishAtForDay(at, day)
    return { offered: true as const, at: await setScheduleDateAt('d', iso), iso }
  }

  it('🔴 an IVAN row is offered the move and the day survives into the payload', async () => {
    rpcQueue = [{ data: { ok: true, scheduled_at: '2026-08-19T14:30:00Z', status: 'scheduled' }, error: null }]
    const r = await move({ status: 'scheduled', client_id: null }, '2026-08-12T10:30:00Z', '2026-08-19')
    expect(r.offered).toBe(true)
    expect(rpcCalls[0].name).toBe('operator_set_schedule_date')
    expect(new Date(String(rpcCalls[0].args.p_scheduled_at)).getDate()).toBe(19)
  })

  it('a CLIENT review row takes the same path — one write, one function', async () => {
    rpcQueue = [{ data: { ok: true, scheduled_at: '2026-08-19T14:30:00Z', status: 'review' }, error: null }]
    await move({ status: 'review', client_id: 'risedtc' }, '2026-08-12T10:30:00Z', '2026-08-19')
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('operator_set_schedule_date')
  })

  it('a published row is never offered the control, so no call is made at all', async () => {
    const r = await move({ status: 'published', client_id: 'risedtc' }, '2026-08-12T10:30:00Z', '2026-08-19')
    expect(r.offered).toBe(false)
    expect(rpcCalls).toHaveLength(0)
  })

  it('🔴 bad_status reaches the operator as a SENTENCE, not as a raw code', async () => {
    rpcQueue = [{ data: { ok: false, error: 'bad_status', status: 'published' }, error: null }]
    const e = await setScheduleDateAt('d', '2026-09-01T09:00:00Z').catch(err => err) as { code: string; message: string }
    expect(e).toBeInstanceOf(ClientRpcError)
    expect(e.code).toBe('bad_status')
    // this string is what the calendar renders in .ops-err
    expect(e.message).toBe(clientRpcMessage('bad_status'))
    expect(e.message).toContain('Needs review or Scheduled')
    expect(e.message).toContain('Nothing changed')
    expect(e.message).not.toContain('bad_status')
  })

  it('not_found and bad_gate keep their own sentences too', async () => {
    for (const code of ['not_found', 'bad_gate']) {
      rpcQueue = [{ data: { ok: false, error: code }, error: null }]
      const e = await setScheduleDateAt('d', '2026-09-01T09:00:00Z').catch(err => err) as { code: string; message: string }
      expect(e.code).toBe(code)
      expect(e.message).toBe(clientRpcMessage(code))
    }
  })
})
