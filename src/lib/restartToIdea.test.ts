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
  RESTART_STATUS, canRestartToIdea, restartToIdeaPrompt, restartDraftToIdea,
} = await import('./content')

beforeEach(() => { steps.length = 0; writeQueue = [] })

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
    expect(steps[0].filters).toEqual({ 'eq:id': 'd1', 'is:client_id': null })
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
