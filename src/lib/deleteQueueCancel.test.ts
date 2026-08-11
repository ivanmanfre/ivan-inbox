import { describe, it, expect, vi, beforeEach } from 'vitest'

// DELETING A DRAFT USED TO LEAVE THE POST IN THE PUBLISH QUEUE.
//
// Ivan, 2026-08-11: "whatever appears on calendar is not what truly gets posted".
// Measured that day: 8 of the 16 pending `scheduled_posts` rows pointed at a
// carousel_drafts id that exists in NO table in the database — the drafts were
// deleted from a board and their queue rows outlived them. `deleteDraft` writes
// to carousel_drafts and nothing else, there is no ON DELETE anything, and the
// publisher's live-draft refresh fail-softs when the lookup comes back empty
// (`if (!draft) { fresh.push(post); continue; }`) — so it publishes the snapshot
// it was queued with, days later, from a row nobody can open or edit any more.
//
// A delete has to reach BOTH tables or it is not a delete.

type Step = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown }
let steps: Step[] = []
let deleteResult: { data: unknown; error: unknown } = { data: [{ id: 'd1' }], error: null }
let updateResult: { data: unknown; error: unknown } = { data: [{ id: 'd1' }], error: null }

function builder(table: string) {
  const make = (op: string, payload?: unknown) => {
    const step: Step = { table, op, filters: {}, payload }
    steps.push(step)
    const chain = {
      eq(k: string, v: unknown) { step.filters[`eq:${k}`] = v; return chain },
      is(k: string, v: unknown) { step.filters[`is:${k}`] = v; return chain },
      in(k: string, v: unknown) { step.filters[`in:${k}`] = v; return chain },
      select() { return Promise.resolve(op === 'delete' ? deleteResult : updateResult) },
      then(res: (v: unknown) => unknown) { return Promise.resolve({ error: null }).then(res) },
    }
    return chain
  }
  return {
    delete: () => make('delete'),
    update: (payload: unknown) => make('update', payload),
  }
}

vi.mock('./supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))

const { deleteDraft } = await import('./content')

beforeEach(() => {
  steps = []
  deleteResult = { data: [{ id: 'd1' }], error: null }
  updateResult = { data: [{ id: 'd1' }], error: null }
})

const queueWrites = () => steps.filter(s => s.table === 'scheduled_posts')

describe('deleteDraft — the post leaves the publish queue too', () => {
  it('cancels the pending queue row when the draft is hard-deleted', async () => {
    expect(await deleteDraft('d1', {})).toBe('deleted')
    const q = queueWrites()
    expect(q).toHaveLength(1)
    // Cancelled, not deleted: the queue row is the record that this slot existed,
    // and `cancelled` is the one status the calendar already refuses to draw.
    expect((q[0].payload as Record<string, unknown>).status).toBe('cancelled')
    expect(q[0].filters['eq:clickup_task_id']).toBe('d1')
    // NEVER a posted/failed row — history is not rewritten by a delete.
    expect(q[0].filters['in:status']).toEqual(['pending', 'queued_v2', 'posting'])
  })

  it('cancels it on the disqualified fallback path too', async () => {
    deleteResult = { data: [], error: null }   // RLS refused the hard DELETE
    expect(await deleteDraft('d1', {})).toBe('disqualified')
    expect(queueWrites()).toHaveLength(1)
  })

  it('does not touch the queue when the row could not be removed at all', async () => {
    deleteResult = { data: [], error: null }
    updateResult = { data: [], error: null }
    await expect(deleteDraft('d1', {})).rejects.toThrow()
    expect(queueWrites()).toHaveLength(0)
  })
})
