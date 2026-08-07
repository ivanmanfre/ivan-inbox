import { describe, it, expect, vi, beforeEach } from 'vitest'

// RESTART-TO-IDEA — the old board's "regenerate from idea" flow, ported.
//
// Three things this file pins, because all three are the kind of thing that
// goes wrong silently:
//   1. the WRITE (table, column, value) and its IVAN-LANE SCOPE — the same
//      `.is('client_id', null)` every other v2 draft write carries;
//   2. that it CANNOT fire without an answered confirm, because the write
//      overwrites the copy and the image;
//   3. the confirm's exact words, which are Ivan's board's words
//      (PostStudioPanel.tsx:717-719) and must not drift.

type Step = { table: string; op: 'select' | 'update' | 'delete'; filters: Record<string, unknown>; payload?: unknown }
const steps: Step[] = []
let writeQueue: Array<{ data: unknown; error: unknown }> = []

// A fake carousel_drafts, one row deep, that actually APPLIES the filters the
// write carries. It exists so "a scheduled row is never written" is asserted
// against the ROW's status afterwards rather than against a reply the test
// handed itself — a guard the query does not really carry would pass the
// second check and fail this one. Empty `rows` keeps the old behaviour (a
// generic one-row success) for the tests that are not about a status.
type Row = { id: string; client_id: string | null; status: string }
let rows: Row[] = []

function parseInList(v: unknown): string[] {
  return String(v).replace(/^\(|\)$/g, '').split(',').map(s => s.trim().replace(/^"|"$/g, ''))
}

function matches(step: Step, r: Row): boolean {
  return Object.entries(step.filters).every(([k, v]) => {
    if (k === 'eq:id') return r.id === v
    if (k === 'is:client_id') return r.client_id === v
    if (k === 'not:status:in') return !parseInList(v).includes(r.status)
    return true
  })
}

function builder(table: string) {
  const make = (op: Step['op'], payload?: unknown) => {
    const step: Step = { table, op, filters: {}, payload }
    steps.push(step)
    const run = () => {
      const queued = writeQueue.shift()
      if (queued) return queued
      if (rows.length === 0) return { data: [{ id: 'd1' }], error: null }
      const hit = rows.filter(r => matches(step, r))
      if (op === 'update') for (const r of hit) Object.assign(r, step.payload)
      return { data: hit.map(r => ({ id: r.id })), error: null }
    }
    const chain = {
      eq(k: string, v: unknown) { step.filters[`eq:${k}`] = v; return chain },
      is(k: string, v: unknown) { step.filters[`is:${k}`] = v; return chain },
      not(k: string, o: string, v: unknown) { step.filters[`not:${k}:${o}`] = v; return chain },
      select() {
        return op === 'select' ? chain : Promise.resolve(run())
      },
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
  supabase: { from: (t: string) => builder(t) },
}))

const {
  RESTART_STATUS, RESTART_BLOCKED_STATUS, RESTART_BLOCKED_FILTER,
  canRestartToIdea, restartToIdeaPrompt, restartDraftToIdea,
} = await import('./content')

beforeEach(() => { steps.length = 0; writeQueue = []; rows = [] })

const draft = { id: 'd1', type: 'single_image', image_urls: [] as string[] | null }
const yes = vi.fn(async () => true)
const no = vi.fn(async () => false)

// ---------------------------------------------------------------------------

describe('the write', () => {
  it('flips carousel_drafts.status to idea, by id, on the Ivan lane only', async () => {
    const ok = await restartDraftToIdea(draft, yes)
    expect(ok).toBe(true)
    expect(steps).toHaveLength(1)
    expect(steps[0].table).toBe('carousel_drafts')
    expect(steps[0].op).toBe('update')
    expect(steps[0].payload).toEqual({ status: 'idea' })
    expect(RESTART_STATUS).toBe('idea')
    expect(steps[0].filters).toEqual({
      'eq:id': 'd1', 'is:client_id': null, 'not:status:in': RESTART_BLOCKED_FILTER,
    })
  })

  it('touches nothing but status — no scheduled_at, no taxonomy, no client_id', async () => {
    await restartDraftToIdea(draft, yes)
    expect(Object.keys(steps[0].payload as object)).toEqual(['status'])
  })

  it('refuses to report success on a write RLS filtered away (silent 204)', async () => {
    writeQueue = [{ data: [], error: null }]
    await expect(restartDraftToIdea(draft, yes)).rejects.toThrow(/did not accept/)
  })
})

describe('it never fires without a confirm', () => {
  it('writes NOTHING when the sheet is dismissed', async () => {
    const ok = await restartDraftToIdea(draft, no)
    expect(ok).toBe(false)
    expect(no).toHaveBeenCalledTimes(1)
    expect(steps).toHaveLength(0)
  })

  it('asks BEFORE it writes, never after', async () => {
    const order: string[] = []
    await restartDraftToIdea(draft, async () => { order.push('ask'); return true })
    order.push(`wrote:${steps.length}`)
    expect(order).toEqual(['ask', 'wrote:1'])
  })
})

describe('the confirm copy is the old board’s, word for word', () => {
  it('warns about the copy when there is no image', () => {
    expect(restartToIdeaPrompt({ type: 'text', image_urls: [] })).toEqual({
      title: 'Regenerate this post?',
      message: "Flipping to 'idea' will refire the pipeline and overwrite the current copy.",
      confirmText: 'Regenerate',
    })
  })

  it('adds " and image" only when the row actually has one', () => {
    const p = restartToIdeaPrompt({ type: 'single_image', image_urls: ['https://x/i.png'] })
    expect(p.message).toBe(
      "Flipping to 'idea' will refire the pipeline and overwrite the current copy and image.",
    )
  })

  it('names a carousel a carousel', () => {
    expect(restartToIdeaPrompt({ type: 'carousel', image_urls: [] }).title)
      .toBe('Regenerate this carousel?')
  })

  it('is the prompt the write actually asks with', async () => {
    const seen: unknown[] = []
    await restartDraftToIdea({ id: 'd1', type: 'carousel', image_urls: ['a'] }, async p => {
      seen.push(p); return false
    })
    expect(seen[0]).toEqual(restartToIdeaPrompt({ type: 'carousel', image_urls: ['a'] }))
  })
})

describe('which rows may be restarted', () => {
  it('never on Mattan’s lane — the write is scoped client_id IS NULL', () => {
    for (const s of ['review', 'approved', 'error', 'generating', 'disqualified']) {
      expect(canRestartToIdea(s, 'risedtc')).toBe(false)
    }
  })

  it('offers it on the stages a regeneration is actually for', () => {
    for (const s of ['review', 'approved', 'error', 'generating', 'disqualified']) {
      expect(canRestartToIdea(s, 'ivan')).toBe(true)
    }
  })

  it('never on an armed or shipped row, and never on one already at idea', () => {
    for (const s of ['scheduled', 'published', 'idea', 'suggestion']) {
      expect(canRestartToIdea(s, 'ivan')).toBe(false)
    }
  })
})

// 🔴 …AND THE WRITE REFUSES THEM TOO. The block above is a UI predicate: it
// decides whether a button is drawn. It cannot help a stale window, a second
// caller, or the case that actually worries: the n8n Bridge arming the row, or
// the publisher shipping it, BETWEEN the render and the click. The exclusion
// therefore rides in the UPDATE, the way deleteClientDraft re-checks the board
// rather than trusting the row the surface is holding.
describe('the write refuses a blocked row, not just the button', () => {
  const armed = (status: string): Row => ({ id: 'd1', client_id: null, status })

  it('carries the blocked statuses as a filter on the UPDATE itself', async () => {
    await restartDraftToIdea(draft, yes)
    expect(steps[0].filters['not:status:in']).toBe(RESTART_BLOCKED_FILTER)
    for (const s of RESTART_BLOCKED_STATUS) expect(RESTART_BLOCKED_FILTER).toContain(s)
  })

  it('🔴 leaves a SCHEDULED row at scheduled — no status write, and it says so', async () => {
    const row = armed('scheduled')
    rows = [row]
    await expect(restartDraftToIdea(draft, yes)).rejects.toThrow(/did not accept/)
    expect(row.status).toBe('scheduled')
  })

  it('🔴 leaves a PUBLISHED row at published — a shipped post cannot be un-shipped', async () => {
    const row = armed('published')
    rows = [row]
    await expect(restartDraftToIdea(draft, yes)).rejects.toThrow(/scheduled or published/)
    expect(row.status).toBe('published')
  })

  it('refuses the rest of the blocked list the same way', async () => {
    for (const s of RESTART_BLOCKED_STATUS) {
      const row = armed(s)
      rows = [row]
      await expect(restartDraftToIdea(draft, yes)).rejects.toThrow()
      expect(row.status).toBe(s)
    }
  })

  it('still writes the rows a regeneration IS for', async () => {
    for (const s of ['review', 'approved', 'error', 'generating', 'disqualified']) {
      const row = armed(s)
      rows = [row]
      await expect(restartDraftToIdea(draft, yes)).resolves.toBe(true)
      expect(row.status).toBe('idea')
    }
  })

  it('never reaches Mattan’s row even at an allowed status', async () => {
    const row = { id: 'd1', client_id: 'risedtc', status: 'review' }
    rows = [row]
    await expect(restartDraftToIdea(draft, yes)).rejects.toThrow(/did not accept/)
    expect(row.status).toBe('review')
  })
})
