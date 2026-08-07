import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// IDEA DECISIONS — approve / reject on the ideas band, the act v2 shipped
// without ("i cant even approve the ideas", 2026-08-07).
//
// The write is NOT ours: `lm-curator-decide` fires the n8n promote run and only
// then stamps the candidate, so this app's whole job at this seam is to send the
// old board's exact request and refuse to send anything else. That makes four
// things worth pinning, all of them silent when they break:
//   1. the TRANSPORT — url, method, headers, body — byte-for-byte the old
//      board's (personal-site/lib/ideaProjection.ts:216-229);
//   2. the STATUS STRINGS the endpoint writes, read off the deployed function
//      (supabase/functions/lm-curator-decide/index.ts:63-101), because the band
//      empties on the strength of them;
//   3. the LANE GUARD, which exists only on this side — the function runs under
//      SERVICE_ROLE and checks NOTHING (index.ts:2, 17-26, 47, 106);
//   4. that a decision cannot be IMPLIED. `JSON.stringify` drops an undefined
//      value, so a missing `decision` would POST a well-formed request for a
//      call nobody made.
//
// Mocked transport throughout — no request leaves this file, and the supabase
// client is mocked to THROW so a regression that reroutes this write into a
// client-side UPDATE (the one thing the comment in content.ts forbids) fails
// here rather than in production.

const dbCalls: string[] = []
vi.mock('./supabase', () => ({
  supabase: {
    from(table: string) {
      dbCalls.push(table)
      throw new Error(`decideIdea must never touch the table directly (${table})`)
    },
    functions: {
      invoke() { throw new Error('invoke() dies in this project’s CORS preflight — bare fetch only') },
    },
  },
}))

// Stubbed BEFORE the import: the endpoint url is computed at module scope, and
// pinning it against .env.local would pin it against whatever Ivan last pointed
// the dev build at.
vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test-key')

const {
  decideIdea, ideaDecidable, draftExcerpt,
  IDEA_DECISION_STATUS, IDEA_DECISIONS, IDEA_NOT_OURS, EXCERPT_CHARS,
} = await import('./content')

type Call = { url: string; init: RequestInit }
const calls: Call[] = []
let reply: () => Response

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn((url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init })
    return Promise.resolve(reply())
  }))
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  calls.length = 0
  dbCalls.length = 0
  reply = json(200, { ok: true, status: 'promoted' })
  stubFetch()
})

afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

// Every reviewing row in the table today: both tenancy columns NULL.
const ours = { id: 'cand-1', workspace_type: null, campaign_id: null }
const body = (n = 0) => JSON.parse(String(calls[n].init.body)) as Record<string, unknown>
const headers = (n = 0) => calls[n].init.headers as Record<string, string>

// ---------------------------------------------------------------------------

describe('the transport is the old board’s, unchanged', () => {
  it('POSTs the deployed decide function, at the url built from the env', async () => {
    await decideIdea(ours, 'approve')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://test-project.supabase.co/functions/v1/lm-curator-decide')
    expect(calls[0].init.method).toBe('POST')
  })

  it('carries the anon bearer and the json content type, and nothing else', async () => {
    await decideIdea(ours, 'approve')
    // 🔴 No X-Client-Info: that is what supabase.functions.invoke() would add,
    // and it dies in this project's CORS preflight (claude.ts:6-10).
    expect(headers()).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer anon-test-key',
    })
  })

  it('never reaches the table itself — the promote run owns the write', async () => {
    await decideIdea(ours, 'approve')
    expect(dbCalls).toEqual([])
  })

  it('returns the function’s parsed body, and survives one that isn’t json', async () => {
    reply = json(200, { ok: true, clickup_task_id: 'ct-9' })
    expect(await decideIdea(ours, 'approve')).toEqual({ ok: true, clickup_task_id: 'ct-9' })
    reply = () => new Response('', { status: 200 })
    expect(await decideIdea(ours, 'reject')).toEqual({})
  })
})

describe('the payload', () => {
  it('is exactly candidate_id + decision when there is no note', async () => {
    await decideIdea(ours, 'approve')
    expect(body()).toEqual({ candidate_id: 'cand-1', decision: 'approve' })
  })

  it('adds `reason` only when the note has words in it', async () => {
    await decideIdea(ours, 'reject', '   ')
    expect(body(0)).toEqual({ candidate_id: 'cand-1', decision: 'reject' })
    await decideIdea(ours, 'reject', '  off-pillar  ')
    // Trimmed: the endpoint concatenates it into archived_reason
    // ('ivan_rejected:' + reason, index.ts:74), where leading space is visible.
    expect(body(1)).toEqual({ candidate_id: 'cand-1', decision: 'reject', reason: 'off-pillar' })
  })

  it('sends the row’s own id — the argument is the ROW, never a bare id', async () => {
    await decideIdea({ ...ours, id: 'cand-77' }, 'reject')
    expect(body().candidate_id).toBe('cand-77')
  })
})

describe('the statuses the endpoint writes', () => {
  // Read off the deployed function, not inferred from the verb: approve stamps
  // 'promoted' AFTER the promoter webhook returns ok (index.ts:63-99), reject
  // stamps 'archived' + archived_reason (index.ts:73-75).
  it('are promoted / archived, and are the reason the row leaves the band', () => {
    expect(IDEA_DECISION_STATUS).toEqual({ approve: 'promoted', reject: 'archived' })
    for (const d of IDEA_DECISIONS) expect(IDEA_DECISION_STATUS[d]).not.toBe('reviewing')
  })

  it('ships two decisions and only two — defer writes `reviewing`, a no-op', () => {
    expect([...IDEA_DECISIONS]).toEqual(['approve', 'reject'])
  })
})

describe('the lane guard — ours, because the server has none', () => {
  const cases: Array<[string, { workspace_type?: string | null; campaign_id?: string | null }]> = [
    ['a client workspace', { workspace_type: 'client', campaign_id: null }],
    ['a campaign-scoped row', { workspace_type: null, campaign_id: 'camp-1' }],
    ['both at once', { workspace_type: 'client', campaign_id: 'camp-1' }],
  ]

  for (const [name, scope] of cases) {
    it(`refuses ${name}, and fires NOTHING`, async () => {
      await expect(decideIdea({ id: 'cand-1', ...scope }, 'approve')).rejects.toThrow(IDEA_NOT_OURS)
      expect(calls).toHaveLength(0)
    })
  }

  it('accepts the two shapes an Ivan-lane row actually has: null and "own"', async () => {
    await decideIdea({ id: 'a', workspace_type: null, campaign_id: null }, 'approve')
    await decideIdea({ id: 'b', workspace_type: 'own', campaign_id: null }, 'approve')
    await decideIdea({ id: 'c', workspace_type: ' Own ', campaign_id: null }, 'approve')
    expect(calls).toHaveLength(3)
  })

  it('is the SAME predicate that gates the buttons, so a guarded row is never offered', () => {
    expect(ideaDecidable({ workspace_type: null, campaign_id: null })).toBe(true)
    expect(ideaDecidable({ workspace_type: 'own', campaign_id: null })).toBe(true)
    expect(ideaDecidable({ workspace_type: 'client', campaign_id: null })).toBe(false)
    expect(ideaDecidable({ workspace_type: null, campaign_id: 'camp-1' })).toBe(false)
    // A row read before the columns were added to IDEA_COLS: undefined is the
    // absence of a scope, not a scope.
    expect(ideaDecidable({})).toBe(true)
  })
})

describe('it never fires without an explicit decision', () => {
  for (const bad of [undefined, null, '', 'defer', 'revert', 'rescue', 'APPROVE']) {
    it(`sends nothing for ${JSON.stringify(bad)}`, async () => {
      // @ts-expect-error — the point of the runtime guard is the caller the
      // types do not reach.
      await expect(decideIdea(ours, bad)).rejects.toThrow(/no decision/)
      expect(calls).toHaveLength(0)
    })
  }

  it('checks the row BEFORE the decision — the scope answer is the one Ivan sees', async () => {
    // @ts-expect-error — both guards would trip; the lane message is the one
    // rendered in the card, so it must be the one that wins.
    await expect(decideIdea({ id: 'x', workspace_type: 'client' }, undefined))
      .rejects.toThrow(IDEA_NOT_OURS)
    expect(calls).toHaveLength(0)
  })
})

describe('a failed decision is never reported as a decision', () => {
  it('throws the function’s own error string', async () => {
    reply = json(502, { error: 'promoter_failed:500' })
    await expect(decideIdea(ours, 'approve')).rejects.toThrow('promoter_failed:500')
  })

  it('falls back to the status when the body carries no error', async () => {
    reply = () => new Response('gateway', { status: 504 })
    await expect(decideIdea(ours, 'approve')).rejects.toThrow('decide 504')
  })

  it('a 404 candidate is an error, not a silent success', async () => {
    reply = json(404, { error: 'not_found' })
    await expect(decideIdea(ours, 'reject')).rejects.toThrow('not_found')
  })
})

// ---------------------------------------------------------------------------

describe('draftExcerpt — the at-a-glance line', () => {
  it('is null, never an empty string, when the body has not been generated', () => {
    expect(draftExcerpt(null)).toBeNull()
    expect(draftExcerpt(undefined)).toBeNull()
    expect(draftExcerpt('')).toBeNull()
    expect(draftExcerpt('\n  \n ')).toBeNull()
  })

  it('leads with the HOOK — the first non-empty line, blank lines skipped', () => {
    expect(draftExcerpt('\n\n  The hook.  \n\nThe body.')).toBe('The hook. · The body.')
  })

  it('joins lines with a separator, so two lines never read as one sentence', () => {
    // A space here would manufacture "Stop guessing Here is the rubric", a
    // sentence the draft does not contain.
    expect(draftExcerpt('Stop guessing\nHere is the rubric')).toBe('Stop guessing · Here is the rubric')
  })

  it('marks truncation, and stays inside the budget it was given', () => {
    const out = draftExcerpt('x'.repeat(400))!
    expect(out).toHaveLength(EXCERPT_CHARS)
    expect(out.endsWith('…')).toBe(true)
    const short = draftExcerpt('short enough')!
    expect(short.endsWith('…')).toBe(false)
  })

  it('never clips mid-space before the ellipsis', () => {
    expect(draftExcerpt('aaa bbb ccc', 8)).toBe('aaa bbb…')
  })
})
