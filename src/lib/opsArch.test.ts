/* ==========================================================================
   The ARCH comment lane's client-side contract (2026-09-17).

   Three things can only be proven here, because they are decisions the card
   makes before anything reaches a screen:

     · WHICH drafter a "Draft it" press calls. The ARCH function refuses nothing
       but ARCH rows and the RISE one refuses everything that is not risedtc, so
       a row handed to the wrong lane is a dead button either way.
     · What a TRANSIENT bail means. The drafter ran out of proxy or clock and
       wrote nothing — that is neither a draft nor a judgement, and the loop must
       stop rather than spend five more rounds on it.
     · That the "Needs Davor" stamp READS its `{ error }`. A write whose error is
       dropped paints a chip over a row that never changed.
   ========================================================================== */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArchSource, OpsDraft } from './ops'

type Write = { table: string; payload: unknown; filters: Record<string, unknown> }
const writes: Write[] = []
let writeError: unknown = null

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }) },
    from: (table: string) => ({
      update(payload: unknown) {
        const w: Write = { table, payload, filters: {} }
        writes.push(w)
        const chain = {
          eq(k: string, v: unknown) { w.filters[`eq:${k}`] = v; return chain },
          is(k: string, v: unknown) { w.filters[`is:${k}`] = v; return chain },
          then(res: (r: { error: unknown }) => unknown) { return Promise.resolve({ error: writeError }).then(res) },
        }
        return chain
      },
    }),
  },
}))

const {
  generateCommentDraft, commentDraftFn, markNeedsDavor, archOutcome, archOutcomeLabel,
  archSources, DRAFTER_BUSY, ARCH_SOURCES_MAX,
} = await import('./ops')

const base: OpsDraft = {
  id: 'card-1', client_id: 'arch', kind: 'comment_reply', slack_channel: '',
  body: '', context: {}, created_at: '2026-09-17T09:00:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: null,
}

const calls: string[] = []
function respond(body: Record<string, unknown>, ok = true, status = 200) {
  return vi.fn((url: string) => {
    calls.push(url)
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as unknown as Response)
  })
}

beforeEach(() => {
  writes.length = 0; calls.length = 0; writeError = null
})

describe('the Draft it button routes by client, never by lane default', () => {
  it('sends an ARCH row to arch-comment-draft', async () => {
    vi.stubGlobal('fetch', respond({ ok: true, drafted: true, draft: 'hi', outcome: 'DRAFT' }))
    await generateCommentDraft('card-1', 'arch')
    expect(calls[0]).toContain('/functions/v1/arch-comment-draft')
    expect(calls[0]).not.toContain('rise-comment-draft')
  })

  it('leaves every other lane on rise-comment-draft, including a missing client', async () => {
    vi.stubGlobal('fetch', respond({ ok: true, drafted: true, draft: 'hi' }))
    await generateCommentDraft('card-1', 'risedtc')
    await generateCommentDraft('card-1', 'ivan')
    await generateCommentDraft('card-1')
    expect(calls.every(u => u.includes('/functions/v1/rise-comment-draft'))).toBe(true)
    expect(commentDraftFn('arch')).toBe('arch-comment-draft')
    expect(commentDraftFn('risedtc')).toBe('rise-comment-draft')
    expect(commentDraftFn(undefined)).toBe('rise-comment-draft')
    expect(commentDraftFn('somebody-new')).toBe('rise-comment-draft')
  })

  it('posts the card id and nothing else', async () => {
    const fetchMock = vi.fn((_u: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({ ops_draft_id: 'card-1' })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, drafted: false, outcome: 'HANDLED' }) } as unknown as Response)
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await generateCommentDraft('card-1', 'arch')
    expect(out.drafted).toBe(false)
    expect(out.outcome).toBe('HANDLED')
  })
})

describe('a transient bail is neither a draft nor a refusal', () => {
  it('comes back with the continue loop stopped and nothing drafted', async () => {
    vi.stubGlobal('fetch', respond({ ok: true, drafted: false, transient: true, can_continue: true, error: 'proxy_session_limit' }))
    const out = await generateCommentDraft('card-1', 'arch')
    expect(out.transient).toBe(true)
    expect(out.drafted).toBe(false)
    // can_continue arrives true and is overridden: another five rounds against a
    // capped proxy burn the operator's wait and answer nothing.
    expect(out.can_continue).toBe(false)
    expect(out.draft).toBeUndefined()
  })

  it('never throws, even when the bail arrives on a non-2xx or with ok:false', async () => {
    vi.stubGlobal('fetch', respond({ ok: false, transient: true, error: 'upstream timeout' }, false, 503))
    const out = await generateCommentDraft('card-1', 'arch')
    expect(out.transient).toBe(true)
    expect(out.drafted).toBe(false)
  })

  it('still throws on a real failure, which is not transient', async () => {
    vi.stubGlobal('fetch', respond({ ok: false, error: 'not an arch card' }, false, 400))
    await expect(generateCommentDraft('card-1', 'arch')).rejects.toThrow('not an arch card')
  })

  it('has one sentence for the card, and it never says refused', () => {
    expect(DRAFTER_BUSY).toBe('drafter busy, nothing written, try again')
    expect(DRAFTER_BUSY).not.toMatch(/refus/i)
  })
})

describe('archOutcome / archOutcomeLabel', () => {
  it('reads the stamp on an ARCH comment card only', () => {
    expect(archOutcome({ ...base, context: { arch_outcome: 'DRAFT' } })).toBe('DRAFT')
    expect(archOutcome({ ...base, context: { arch_outcome: 'needs_davor' } })).toBe('NEEDS_DAVOR')
    // Another lane's row can carry the key and still not wear the chip.
    expect(archOutcome({ ...base, client_id: 'risedtc', context: { arch_outcome: 'DRAFT' } })).toBeNull()
    expect(archOutcome({ ...base, kind: 'comment_outbound', context: { arch_outcome: 'DRAFT' } })).toBeNull()
    expect(archOutcome({ ...base, context: {} })).toBeNull()
    expect(archOutcome({ ...base, context: null })).toBeNull()
    expect(archOutcome({ ...base, context: { arch_outcome: 'SOMETHING_ELSE' } })).toBeNull()
  })

  it('names all four outcomes the way the operator reads them', () => {
    expect(archOutcomeLabel('DRAFT')).toBe('Draft')
    expect(archOutcomeLabel('NEEDS_DAVOR')).toBe('Needs Davor')
    expect(archOutcomeLabel('ESCALATE')).toBe('Escalate: answer by hand')
    expect(archOutcomeLabel('HANDLED')).toBe('No reply needed')
  })
})

describe('archSources', () => {
  it('caps the list and drops anything that is not a source', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, source_type: 'post', title: `t${i}`, public: true }))
    expect(archSources({ ...base, context: { arch_sources: many } })).toHaveLength(ARCH_SOURCES_MAX)
    expect(archSources({ ...base, context: { arch_sources: many } }, 2).map(s => s.id)).toEqual(['s0', 's1'])
    // Junk from an older row shape, cast in deliberately: the helper is what
    // stands between a half-written context and a card that throws on render.
    const junk = [null, 'x', { id: 'ok', source_type: 'doc', title: 'T', public: false }] as unknown as ArchSource[]
    expect(archSources({ ...base, context: { arch_sources: junk } }))
      .toEqual([{ id: 'ok', source_type: 'doc', title: 'T', public: false }])
    expect(archSources({ ...base, context: {} })).toEqual([])
    expect(archSources({ ...base, context: null })).toEqual([])
  })
})

describe('Needs Davor stamps the row and reads what the database said', () => {
  it('merges the stamp into the existing context and never touches sent rows', async () => {
    const row: OpsDraft = { ...base, context: { comment_id: 'c1', arch_outcome: 'NEEDS_DAVOR', arch_reason: 'keep me' } }
    await markNeedsDavor(row, '2026-09-17T11:00:00Z')
    expect(writes).toHaveLength(1)
    expect(writes[0].table).toBe('ops_drafts')
    expect(writes[0].payload).toEqual({
      context: {
        comment_id: 'c1', arch_outcome: 'NEEDS_DAVOR', arch_reason: 'keep me',
        needs_davor: true, needs_davor_at: '2026-09-17T11:00:00Z',
      },
    })
    expect(writes[0].filters).toEqual({ 'eq:id': 'card-1', 'is:sent_at': null })
  })

  it('throws the write error instead of looking green', async () => {
    writeError = { message: 'new row violates row-level security policy' }
    await expect(markNeedsDavor(base)).rejects.toMatchObject({
      message: 'new row violates row-level security policy',
    })
  })
})

import { isHandWritten } from './ops'
describe('isHandWritten', () => {
  const base = { id: 'x', kind: 'comment_reply', client_id: 'arch', body: 'Thanks!', context: { arch_outcome: 'DRAFT' } } as never
  it('is false for the untouched ARCH draft and for every RISE card', () => {
    expect(isHandWritten(base, 'Thanks! ')).toBe(false)
    expect(isHandWritten({ ...(base as object), client_id: 'risedtc' } as never, 'anything')).toBe(false)
  })
  it('is true when edited, or when the card never got a DRAFT verdict', () => {
    expect(isHandWritten(base, 'Thanks a lot!')).toBe(true)
    expect(isHandWritten({ ...(base as object), context: { arch_outcome: 'NEEDS_DAVOR' } } as never, 'Thanks!')).toBe(true)
  })
})
