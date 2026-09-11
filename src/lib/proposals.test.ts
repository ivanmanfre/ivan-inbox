import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Proposal } from './proposals'
import type { OpsDraft } from './ops'

/* ==========================================================================
   AUDIENCE PROPOSALS (Run 06 §2.5).

   The suite exists for four rules, and every case below is one of them:

     1. THE QUERY IS THE CONTRACT. A proposal is an `ops_drafts` row of ONE
        kind, scoped to ONE lane, with NO stamps. Lose any of those four
        filters and this surface shows another lane's rows, an approved row,
        or a Slack card.
     2. A REFUSAL IS SAID IN WORDS. `{ok:false, error:'not_found'}` is a
        sentence about the row on screen, not a generic failure.
     3. AN AUDIENCE PROPOSAL IS NOT AN OPS CARD. `pendingOps` is what every
        Ops surface counts — the cards, the DM lane preview, the Shell badge —
        and this kind must be absent from all of them while every other kind
        still gets through.
     4. THE COPY CARRIES NO PLUMBING. Nothing rendered here may print a
        workflow id or a table name from the outreach stack (Run 03 C1).
   ========================================================================== */

type Q = { table: string; ops: Array<[string, ...unknown[]]> }
type Rpc = { fn: string; args: unknown }

let queries: Q[] = []
let rpcs: Rpc[] = []
let result: { data: unknown; error: { message: string } | null } = { data: [], error: null }
let rpcResult: { data: unknown; error: { message: string } | null } = { data: { ok: true }, error: null }

// The audience suite's builder, extended with the three operations this module
// adds: `is` (the null-stamp filters), `delete`, and the rpc.
function builder(table: string) {
  const q: Q = { table, ops: [] }
  queries.push(q)
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'like', 'order', 'limit', 'delete']) {
    chain[m] = (...args: unknown[]) => { q.ops.push([m, ...args]); return chain }
  }
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
  return chain
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: (fn: string, args: unknown) => {
      rpcs.push({ fn, args })
      return Promise.resolve(rpcResult)
    },
  },
}))

const {
  fetchProposals, publishProposal, dropProposal, evidenceLine, proposalTitle,
  rosterRole, seedNote, changedOverrides, editDraft, textField, shortDate,
  COLUMNS, PROPOSAL_KIND,
} = await import('./proposals')
const { pendingOps, pendingDmLaneOps, isAudnKind } = await import('./ops')
const { ProposalsList, ProposalRow, ProposalsView } = await import('../wb/content/ProposalsBlock')

beforeEach(() => {
  queries = []
  rpcs = []
  result = { data: [], error: null }
  rpcResult = { data: { ok: true, already: false, table: 'client_ideas', id: 'i-1', ref: 'audn-rec:p-1' }, error: null }
})

// ---------------------------------------------------------------------------

const proposal = (o: Partial<Proposal> = {}): Proposal => ({
  id: 'p-1',
  client_id: 'risedtc',
  kind: PROPOSAL_KIND,
  body: 'Three of the four accounts stopped naming a client in their proof lines.',
  created_at: '2026-09-08T09:00:00Z',
  context: {
    audn: {
      title: 'Post the placement rule',
      what_changed: 'Three of the four accounts stopped naming a client in their proof lines.',
      why_it_matters: 'Your own proof lines still open with a client name.',
      could_publish: 'A post that walks the rule through the two misses it came from.',
      proof_needed: 'The two dates and the reaction counts, taken from the posts themselves.',
      evidence: {
        source_ids: ['cp-1', 'cp-2', 'cp-3'],
        source_dates: ['2026-08-19', '2026-08-24', '2026-08-30'],
        sample_n: 3,
        unknowns: 'no reach figure on two of the three',
      },
      roster_role: 'direct_competitor',
      roster_accounts: ['Northwind Studio'],
      asset_required: false,
      asset_state: 'none',
      pillar: null,
      format: null,
    },
    source_rows: [
      { table: 'competitor_posts', id: 'cp-1', author: 'Northwind Studio', date: '2026-08-19', reactions: 41, url: 'https://example.com/p/1' },
      { table: 'competitor_posts', id: 'cp-2', author: 'Belmar Growth', date: '2026-08-24', reactions: 12, url: 'https://example.com/p/2' },
      { table: 'competitor_posts', id: 'cp-3', author: 'Northwind Studio', date: '2026-08-30', reactions: 58, url: 'https://example.com/p/3' },
    ],
    author_baseline: null,
    proposed_at: '2026-09-08T09:00:00Z',
    prompt: 'audn-recommendation-writer@v1',
    seed: null,
    published: null,
  },
  ...o,
})

const noop = async () => { throw new Error('not called in this test') }
const listHtml = (rows: Proposal[]) =>
  renderToStaticMarkup(createElement(ProposalsList, {
    rows,
    onApprove: noop as never,
    onDrop: noop as never,
  }))
const rowHtml = (p: Proposal) =>
  renderToStaticMarkup(createElement(ProposalRow, {
    p, onApprove: noop as never, onDrop: noop as never,
  }))
const strip = (h: string) => h.replace(/<[^>]*>/g, '')

// ---------------------------------------------------------------------------

describe('the read is the contract', () => {
  it('asks ops_drafts for ONE kind, ONE lane, and no stamps', async () => {
    const s = await fetchProposals('risedtc')
    expect(s.ok).toBe(true)
    expect(queries).toHaveLength(1)
    expect(queries[0].table).toBe('ops_drafts')
    expect(queries[0].ops).toContainEqual(['select', COLUMNS])
    expect(queries[0].ops).toContainEqual(['eq', 'kind', 'audn_recommendation'])
    expect(queries[0].ops).toContainEqual(['eq', 'client_id', 'risedtc'])
    // The two stamps. A row carrying either is published, not open, and it
    // must never come back to a screen offering to approve it again.
    expect(queries[0].ops).toContainEqual(['is', 'approved_at', null])
    expect(queries[0].ops).toContainEqual(['is', 'sent_at', null])
    expect(queries[0].ops).toContainEqual(['order', 'created_at', { ascending: true }])
    expect(queries[0].ops).toContainEqual(['limit', 50])
  })

  it('scopes by the lane it was PASSED, never by anything it derived', async () => {
    for (const lane of ['ivan', 'arch'] as const) {
      queries = []
      await fetchProposals(lane)
      expect(queries[0].ops).toContainEqual(['eq', 'client_id', lane])
    }
  })

  it('turns a PostgREST error into a soft failure that names the read', async () => {
    result = { data: null, error: { message: 'permission denied for table ops_drafts' } }
    const s = await fetchProposals('risedtc')
    expect(s.ok).toBe(false)
    if (!s.ok) expect(s.error).toBe('proposals: permission denied for table ops_drafts')
  })
})

describe('publish — the one path to an idea bank', () => {
  it('calls the RPC by name, with the lane, the id and the overrides', async () => {
    const r = await publishProposal('risedtc', 'p-1', { title: 'A shorter title' })
    expect(rpcs).toHaveLength(1)
    expect(rpcs[0].fn).toBe('audn_recommendation_publish')
    expect(rpcs[0].args).toEqual({
      p_client_id: 'risedtc',
      p_proposal_id: 'p-1',
      p_text_overrides: { title: 'A shorter title' },
    })
    expect(r).toEqual({ already: false, table: 'client_ideas', id: 'i-1', ref: 'audn-rec:p-1' })
  })

  it('sends an EMPTY override bag when nothing was edited', async () => {
    await publishProposal('ivan', 'p-9')
    expect(rpcs[0].args).toMatchObject({ p_text_overrides: {} })
  })

  it('says a second approve wrote nothing, instead of claiming a new row', async () => {
    rpcResult = {
      data: { ok: true, already: true, table: 'lm_idea_candidates', id: 'c-2', ref: 'audn-rec:p-1' },
      error: null,
    }
    const r = await publishProposal('ivan', 'p-1')
    expect(r.already).toBe(true)
    expect(r.table).toBe('lm_idea_candidates')
  })

  it('throws the MAPPED sentence on not_found, carrying the server code', async () => {
    rpcResult = { data: { ok: false, error: 'not_found' }, error: null }
    await expect(publishProposal('risedtc', 'gone')).rejects.toThrow(
      'That proposal is gone: dropped or already approved elsewhere.',
    )
    rpcResult = { data: { ok: false, error: 'not_found' }, error: null }
    const err = await publishProposal('risedtc', 'gone').catch((e: unknown) => e)
    expect((err as { code: string }).code).toBe('not_found')
  })

  it('names the other two refusals rather than smoothing them into one', async () => {
    for (const [code, phrase] of [
      ['unknown_client', 'no client registry row'],
      ['no_text', 'nothing to publish'],
    ] as const) {
      rpcResult = { data: { ok: false, error: code }, error: null }
      await expect(publishProposal('risedtc', 'p-1')).rejects.toThrow(phrase)
    }
  })

  it('keeps an UNMAPPED code visible instead of hiding it behind a generic line', async () => {
    rpcResult = { data: { ok: false, error: 'some_new_rule' }, error: null }
    await expect(publishProposal('risedtc', 'p-1')).rejects.toThrow('some_new_rule')
  })

  it('raises a transport error as itself', async () => {
    rpcResult = { data: null, error: { message: 'network error' } }
    await expect(publishProposal('risedtc', 'p-1')).rejects.toThrow('network error')
  })
})

describe('drop — delete means delete, and only while it is open', () => {
  it('deletes by id AND kind AND the open guard', async () => {
    result = { data: [{ id: 'p-1' }], error: null }
    const { deleted } = await dropProposal('p-1')
    expect(queries[0].table).toBe('ops_drafts')
    expect(queries[0].ops[0][0]).toBe('delete')
    expect(queries[0].ops).toContainEqual(['eq', 'id', 'p-1'])
    expect(queries[0].ops).toContainEqual(['eq', 'kind', 'audn_recommendation'])
    // The race guard: a proposal approved in another tab is an idea row now,
    // and deleting it out from under that row would orphan the idea.
    expect(queries[0].ops).toContainEqual(['is', 'approved_at', null])
    expect(deleted).toBe(1)
  })

  it('reports a delete that removed nothing, rather than reporting success', async () => {
    result = { data: [], error: null }
    expect(await dropProposal('p-1')).toEqual({ deleted: 0 })
  })

  it('raises the database error instead of swallowing it', async () => {
    result = { data: null, error: { message: 'permission denied' } }
    await expect(dropProposal('p-1')).rejects.toThrow('permission denied')
  })
})

describe('an audience proposal is not an ops card (CONTRACTS B2)', () => {
  const base: OpsDraft = {
    id: 'e', client_id: 'risedtc', kind: 'escalation', slack_channel: '#rise-ops',
    body: 'hey', context: null, created_at: '2026-09-08T10:00:00Z',
    approved_at: null, sent_at: null, send_blocked_reason: null,
  }

  it('drops the kind from pendingOps and keeps every other pending kind', () => {
    const rows: OpsDraft[] = [
      { ...base, id: 'esc' },
      { ...base, id: 'audn', kind: 'audn_recommendation', slack_channel: '' },
      { ...base, id: 'task', kind: 'task' },
    ]
    expect(pendingOps(rows).map(r => r.id)).toEqual(['esc', 'task'])
    // And the DM lane preview, which is built on the same filter.
    expect(pendingDmLaneOps(rows).map(r => r.id)).toEqual(['esc', 'task'])
    expect(isAudnKind('audn_recommendation')).toBe(true)
    expect(isAudnKind('escalation')).toBe(false)
  })
})

describe('the pure lines', () => {
  it('writes the evidence line as count, window and unknowns', () => {
    expect(evidenceLine(proposal())).toBe(
      '3 sources · 19 Aug – 30 Aug · unknowns: no reach figure on two of the three',
    )
  })

  it('says `1 source` and one date when there is one of each', () => {
    const p = proposal()
    const line = evidenceLine({
      ...p,
      context: {
        ...p.context,
        audn: {
          ...p.context?.audn,
          evidence: { source_ids: ['cp-1'], source_dates: ['2026-08-19'], sample_n: 1, unknowns: 'none' },
        },
      },
    })
    expect(line).toBe('1 source · 19 Aug · unknowns: none')
  })

  it('says the unknowns were not stated rather than inventing "none"', () => {
    const p = proposal()
    const line = evidenceLine({
      ...p,
      context: { ...p.context, audn: { ...p.context?.audn, evidence: { source_ids: ['cp-1'] } } },
    })
    expect(line).toContain('unknowns: not stated')
    // And a proposal citing nothing does not claim "0 sources".
    const bare = evidenceLine({ ...p, context: { audn: {}, source_rows: [] } })
    expect(bare).toBe('unknowns: not stated')
  })

  it('keeps an unreadable date as itself instead of dropping it', () => {
    expect(shortDate('2026-08-19')).toBe('19 Aug')
    expect(shortDate('last week')).toBe('last week')
  })

  it('falls back from the audn title to the body, then says it is untitled', () => {
    expect(proposalTitle(proposal())).toBe('Post the placement rule')
    const p = proposal({ context: { audn: {}, source_rows: [] } })
    expect(proposalTitle(p)).toBe(p.body)
    expect(proposalTitle({ ...p, body: '' })).toBe('(untitled proposal)')
  })

  it('names the roster role in words, and says so when there is none', () => {
    expect(rosterRole(proposal())).toBe('direct competitor')
    expect(rosterRole(proposal({ context: { audn: {} } }))).toBe('role not stated')
  })

  it('marks a seeded proposal and leaves a fresh one unmarked', () => {
    expect(seedNote(proposal())).toBeNull()
    const p = proposal()
    const seeded = { ...p, context: { ...p.context, seed: { run: 'audience-learning-03', refreshed: ['why_it_matters'] } } }
    expect(seedNote(seeded)).toBe('carried from an earlier review · refreshed: why it matters')
    // The key never reaches the screen as a key.
    expect(seedNote(seeded)).not.toContain('why_it_matters')
  })

  it('sends ONLY the fields the human actually changed', () => {
    const p = proposal()
    const draft = editDraft(p)
    expect(changedOverrides(p, draft)).toEqual({})
    expect(changedOverrides(p, { ...draft, title: 'A shorter title' }))
      .toEqual({ title: 'A shorter title' })
    // Whitespace is not an edit.
    expect(changedOverrides(p, { ...draft, proof_needed: `  ${textField(p, 'proof_needed')}  ` }))
      .toEqual({})
  })
})

describe('the three states, as they actually render', () => {
  it('shows the title, the four fields, the evidence line, the role and the links', () => {
    const h = listHtml([proposal()])
    const t = strip(h)
    expect(t).toContain('Post the placement rule')
    expect(t).toContain('What changed')
    expect(t).toContain('Why it matters')
    expect(t).toContain('Could publish')
    expect(t).toContain('Proof needed')
    expect(t).toContain('3 sources · 19 Aug – 30 Aug · unknowns:')
    // The role badge, neutral: this is a record, not a live signal.
    expect(h).toMatch(/data-ds="Badge"[^>]*data-tone="neutral"/)
    expect(t).toContain('direct competitor')
    // The citations open, in a new tab, without leaking a referrer.
    expect(h).toContain('href="https://example.com/p/1"')
    expect(h).toContain('target="_blank"')
    expect(h).toContain('rel="noreferrer"')
    expect(t).toContain('Northwind Studio')
    // And the three actions.
    for (const label of ['Send to ideas', 'Edit', 'Delete']) expect(t).toContain(label)
  })

  it('names the asset when one is required, and stays silent when none is', () => {
    const p = proposal()
    const withAsset = {
      ...p,
      context: { ...p.context, audn: { ...p.context?.audn, asset_required: 'A screenshot of the two proof lines', asset_state: 'missing' } },
    }
    expect(strip(rowHtml(withAsset))).toContain('Asset needed: A screenshot of the two proof lines')
    expect(strip(rowHtml(p))).not.toContain('Asset needed')
  })

  it('renders the three states, and says what failed rather than showing nothing', () => {
    const view = (state: Parameters<typeof ProposalsView>[0]['state']) =>
      strip(renderToStaticMarkup(createElement(ProposalsView, {
        lane: 'risedtc', state, loadedAt: null,
        onApprove: noop as never, onDrop: noop as never,
      })))

    // EMPTY — the calm one, in those words.
    expect(view({ kind: 'empty' })).toContain('No proposal is waiting for this lane.')

    // FAILED — and the sentence carries the name of the read that broke, so
    // an unread table can never be mistaken for an empty one.
    const failed = view({ kind: 'failed', error: 'proposals: permission denied for table ops_drafts' })
    expect(failed).toContain('proposals: permission denied for table ops_drafts')
    expect(failed).not.toContain('No proposal is waiting for this lane.')

    // LIST — the title and the actions, through the same component the app
    // mounts.
    const list = view({ kind: 'list', rows: [proposal()] })
    expect(list).toContain('Post the placement rule')
    expect(list).toContain('Send to ideas')
    expect(list).toContain('1 open')
  })

  it('carries no workflow id and no outreach table name (copy hygiene, Run 03 C1)', () => {
    const t = strip(listHtml([proposal()]))
    expect(t).not.toMatch(/\b[A-Za-z0-9]{16}\b/)
    expect(t).not.toMatch(/post_engagers|client_post_engagers|outreach_prospects/)
  })
})
