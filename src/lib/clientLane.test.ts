import { describe, it, expect, vi, beforeEach } from 'vitest'

// The client lane's write path (inbox-mattan-lane-actions).
//
// Every expectation below mirrors a predicate read off the LIVE function body
// (pg_get_functiondef, 2026-08-03 — goal-runs/inbox-mattan-lane-actions-
// 2026-08-03-out/rpc-defs.json). The point of the file is that if the SQL is
// ever changed, these go red rather than the client lane quietly doing the
// wrong thing to a paying client's board.

type Step = { table: string; op: 'select' | 'update' | 'delete'; filters: Record<string, unknown>; payload?: unknown }
type Call = { name: string; args: Record<string, unknown> }
const steps: Step[] = []
const rpcCalls: Call[] = []
let selectQueue: Array<{ data: unknown; error: unknown }> = []
let writeQueue: Array<{ data: unknown; error: unknown }> = []
let rpcQueue: Array<{ data: unknown; error: unknown }> = []

function builder(table: string) {
  const make = (op: Step['op'], payload?: unknown) => {
    const step: Step = { table, op, filters: {}, payload }
    steps.push(step)
    const chain = {
      eq(k: string, v: unknown) { step.filters[`eq:${k}`] = v; return chain },
      is(k: string, v: unknown) { step.filters[`is:${k}`] = v; return chain },
      not(k: string, o: string, v: unknown) { step.filters[`not:${k}:${o}`] = v; return chain },
      select() {
        return op === 'select' ? chain : Promise.resolve(writeQueue.shift() ?? { data: [{ id: 'd1' }], error: null })
      },
      maybeSingle() { return Promise.resolve(selectQueue.shift() ?? { data: null, error: null }) },
    }
    return chain
  }
  return {
    select: () => make('select'),
    update: (payload: unknown) => make('update', payload),
    delete: () => make('delete'),
  }
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return Promise.resolve(rpcQueue.shift() ?? { data: { ok: true }, error: null })
    },
  },
}))

const {
  CLIENT_OPS_GATE, ClientRpcError, DraftSaveConflict, clientRpcMessage,
  canPromote, canUnpromote, clientEditable, clientDeletable,
  setBoardVisible, saveClientDraftBody, deleteClientDraft,
  clientStageLabel, boardGroupOf, reviewActionable, STAGE_LABEL,
} = await import('./content')

beforeEach(() => {
  steps.length = 0; rpcCalls.length = 0
  selectQueue = []; writeQueue = []; rpcQueue = []
})

const OLD = '2026-08-03T10:00:00Z'

// ---------------------------------------------------------------------------

describe('the promote policy mirrors operator_set_board_visible', () => {
  it('promotes ONLY from review — the RPC answers not_in_review for anything else', () => {
    expect(canPromote('review', 'risedtc')).toBe(true)
    for (const s of ['approved', 'scheduled', 'published', 'error', 'disqualified', 'generating']) {
      expect(canPromote(s, 'risedtc')).toBe(false)
    }
  })
  it('never on the Ivan lane — the RPC reads client_id IS NULL as draft_not_found', () => {
    expect(canPromote('review', 'ivan')).toBe(false)
  })
  it('un-promote has no status rule: the not_in_review branch is guarded by p_visible', () => {
    expect(canUnpromote('risedtc', true)).toBe(true)
    expect(canUnpromote('risedtc', false)).toBe(false)
    // NULL is not evidence of promotion.
    expect(canUnpromote('risedtc', null)).toBe(false)
    expect(canUnpromote('risedtc', undefined)).toBe(false)
    expect(canUnpromote('ivan', true)).toBe(false)
  })
  it('approve stays Ivan-only — approving a client row would lock it off the board for good', () => {
    expect(reviewActionable('review', 'risedtc')).toBe(false)
    expect(reviewActionable('error', 'risedtc')).toBe(false)
    expect(reviewActionable('review', 'ivan')).toBe(true)
  })
})

describe('the edit policy mirrors operator_edit_draft_body', () => {
  it("status in ('review','scheduled'), verbatim", () => {
    expect(clientEditable('review', 'risedtc')).toBe(true)
    expect(clientEditable('scheduled', 'risedtc')).toBe(true)
    for (const s of ['published', 'approved', 'error', 'disqualified']) {
      expect(clientEditable(s, 'risedtc')).toBe(false)
    }
  })
  it('the RPC is client-rows-only (client_id IS NOT NULL), so the Ivan lane never uses it', () => {
    expect(clientEditable('review', 'ivan')).toBe(false)
  })
})

describe('the delete policy is OURS, and it protects the board', () => {
  it('a promoted row is not deletable — its copy would outlive it on the client board', () => {
    expect(clientDeletable('risedtc', true)).toBe(false)
  })
  it('a never-promoted row is deletable: it cannot be in the board queue', () => {
    expect(clientDeletable('risedtc', false)).toBe(true)
    expect(clientDeletable('risedtc', null)).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('setBoardVisible', () => {
  it('calls the gated RPC with the gate, the id and the flag', async () => {
    rpcQueue = [{ data: { ok: true, sync_request_id: 42 }, error: null }]
    await setBoardVisible('d1', true)
    expect(rpcCalls).toEqual([{
      name: 'operator_set_board_visible',
      args: { p_gate: CLIENT_OPS_GATE, p_draft_id: 'd1', p_visible: true },
    }])
  })
  it('never writes carousel_drafts directly — the whole point of the gated path', async () => {
    await setBoardVisible('d1', true)
    expect(steps).toEqual([])
  })
  it('a server refusal throws with the server’s own code, not a generic message', async () => {
    rpcQueue = [{ data: { ok: false, error: 'not_in_review' }, error: null }]
    await expect(setBoardVisible('d1', true)).rejects.toBeInstanceOf(ClientRpcError)
    rpcQueue = [{ data: { ok: false, error: 'not_in_review' }, error: null }]
    await setBoardVisible('d1', true).catch((e: InstanceType<typeof ClientRpcError>) => {
      expect(e.code).toBe('not_in_review')
      expect(e.message).toContain('Needs review')
    })
  })
  it('an UNKNOWN code keeps its name rather than being smoothed away', () => {
    expect(clientRpcMessage('some_new_rule')).toContain('some_new_rule')
  })
  it('ok:false with no code still throws — a silent false is not a success', async () => {
    rpcQueue = [{ data: {}, error: null }]
    await expect(setBoardVisible('d1', false)).rejects.toBeInstanceOf(ClientRpcError)
  })
})

describe('saveClientDraftBody — the conflict contract survives the gated write', () => {
  it('stamps the guard first (with a CAS), then writes the body through the RPC', async () => {
    selectQueue = [{ data: { post_body: 'mine', updated_at: OLD }, error: null }]
    writeQueue = [{ data: [{ id: 'd1' }], error: null }]
    rpcQueue = [{ data: { ok: true }, error: null }]
    await saveClientDraftBody('d1', 'mine, edited', { pillar: 'authority' }, 'mine', OLD)

    const stamp = steps.find(s => s.op === 'update')!
    // 🔴 The regen guard: operator_edit_draft_body does not set this, so a
    // client edit would otherwise be the only edit db/025 does not protect.
    expect((stamp.payload as { taxonomy: Record<string, unknown> }).taxonomy.human_edited).toBe(true)
    // The pre-existing taxonomy is merged, never clobbered.
    expect((stamp.payload as { taxonomy: Record<string, unknown> }).taxonomy.pillar).toBe('authority')
    // The compare-and-swap rides in the predicate, on the PRE-FLIGHT value.
    expect(stamp.filters['eq:updated_at']).toBe(OLD)
    // Client rows only.
    expect(stamp.filters['not:client_id:is']).toBe(null)
    // The stamp must NOT carry the body — that write is the RPC's.
    expect((stamp.payload as Record<string, unknown>).post_body).toBeUndefined()

    expect(rpcCalls).toEqual([{
      name: 'operator_edit_draft_body',
      args: { p_gate: CLIENT_OPS_GATE, p_draft_id: 'd1', p_body: 'mine, edited' },
    }])
  })

  it('refuses when the stored body moved underneath the editor, and hands both texts back', async () => {
    selectQueue = [{ data: { post_body: 'an engine rewrote it', updated_at: OLD }, error: null }]
    await expect(saveClientDraftBody('d1', 'mine, edited', {}, 'mine', OLD))
      .rejects.toBeInstanceOf(DraftSaveConflict)
    // Nothing was written, by either path.
    expect(steps.filter(s => s.op === 'update')).toEqual([])
    expect(rpcCalls).toEqual([])
  })

  it('a deleted row is `gone`, not `conflict` — they are different facts', async () => {
    selectQueue = [{ data: null, error: null }]
    await saveClientDraftBody('d1', 'x', {}, 'mine', OLD).catch((e: InstanceType<typeof DraftSaveConflict>) => {
      expect(e.detail.kind).toBe('gone')
    })
    expect(rpcCalls).toEqual([])
  })

  it('a lost compare-and-swap is a conflict, and the body is never sent', async () => {
    selectQueue = [
      { data: { post_body: 'mine', updated_at: OLD }, error: null },
      { data: { post_body: 'theirs', updated_at: '2026-08-03T11:00:00Z' }, error: null },
    ]
    writeQueue = [{ data: [], error: null }]   // the CAS matched nothing
    await saveClientDraftBody('d1', 'mine, edited', {}, 'mine', OLD)
      .catch((e: InstanceType<typeof DraftSaveConflict>) => {
        expect(e.detail.kind).toBe('conflict')
        expect(e.detail.theirs).toBe('theirs')
      })
    expect(rpcCalls).toEqual([])
  })

  it('a database refusal on the body write surfaces its code', async () => {
    selectQueue = [{ data: { post_body: 'mine', updated_at: OLD }, error: null }]
    writeQueue = [{ data: [{ id: 'd1' }], error: null }]
    rpcQueue = [{ data: { ok: false, error: 'not_editable' }, error: null }]
    await saveClientDraftBody('d1', 'x', {}, 'mine', OLD)
      .catch((e: InstanceType<typeof ClientRpcError>) => {
        expect(e.code).toBe('not_editable')
        expect(e.message).toContain('Needs review or Scheduled')
      })
  })
})

describe('deleteClientDraft', () => {
  it('re-reads board_visible and refuses a promoted row — a UI-only guard is not a guard', async () => {
    selectQueue = [{ data: { board_visible: true }, error: null }]
    await expect(deleteClientDraft('d1', {})).rejects.toThrow(/on Mattan’s board/)
    expect(steps.filter(s => s.op === 'delete')).toEqual([])
  })
  it('hard-deletes a never-promoted row', async () => {
    selectQueue = [{ data: { board_visible: false }, error: null }]
    writeQueue = [{ data: [{ id: 'd1' }], error: null }]
    expect(await deleteClientDraft('d1', {})).toBe('deleted')
  })
  it('falls back to an archived row when the hard delete lands nothing', async () => {
    selectQueue = [{ data: { board_visible: null }, error: null }]
    writeQueue = [
      { data: [], error: null },              // DELETE filtered away
      { data: [{ id: 'd1' }], error: null },  // the archive write landed
    ]
    expect(await deleteClientDraft('d1', {})).toBe('disqualified')
    const upd = steps.find(s => s.op === 'update')!
    expect((upd.payload as { taxonomy: Record<string, unknown> }).taxonomy.deleted_by_operator).toBe(true)
  })
  it('throws when NEITHER write landed — an unverified delete is never a success', async () => {
    selectQueue = [{ data: { board_visible: false }, error: null }]
    writeQueue = [{ data: [], error: null }, { data: [], error: null }]
    await expect(deleteClientDraft('d1', {})).rejects.toThrow(/neither removed nor archived/)
  })
})

// ---------------------------------------------------------------------------

describe('clientStageLabel — one status, two meanings, two labels (Ivan’s item 3)', () => {
  it('“Needs review” never appears on either client category', () => {
    expect(clientStageLabel('review', 'board')).not.toContain('Needs review')
    expect(clientStageLabel('review', 'internal')).not.toContain('Needs review')
    // …while the Ivan lane keeps it.
    expect(STAGE_LABEL.review).toBe('Needs review')
  })
  it('names WHOSE review it is', () => {
    // Ivan's own word for it, 2026-08-04: the rows sitting on his client board.
    expect(clientStageLabel('review', 'board')).toBe('On buffer · RISE DTC board')
    expect(clientStageLabel('review', 'internal')).toBe('Waiting on you')
  })
  it('every stage that means two things renders as two different labels', () => {
    // The whole of item 3: these are the stages a client draft can sit at on
    // either side of the promotion line, and none of them may read the same in
    // both categories. (published/error mean one thing, so they share a label.)
    for (const s of ['review', 'approved', 'scheduled'] as const) {
      expect(clientStageLabel(s, 'board')).not.toBe(clientStageLabel(s, 'internal'))
    }
  })
  it('a stage with no client-specific meaning keeps the shared label', () => {
    expect(clientStageLabel('published', 'board')).toBe(STAGE_LABEL.published)
    expect(clientStageLabel('error', 'internal')).toBe(STAGE_LABEL.error)
  })
  it('boardGroupOf treats NULL as not promoted, exactly as countBoardVisible does', () => {
    expect(boardGroupOf({ board_visible: true })).toBe('board')
    expect(boardGroupOf({ board_visible: false })).toBe('internal')
    expect(boardGroupOf({ board_visible: null })).toBe('internal')
    expect(boardGroupOf({})).toBe('internal')
  })
})
