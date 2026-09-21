/* ==========================================================================
   Contract tests for the SOURCE side of the editorial adapter (readResearch).

   Test ids map to verification/contract-tests.SPEC.md. T03 is fully this
   seat's; T02/T04/T06/T07/T12 here cover the readResearch HALVES of those
   rows — the brief-side halves live in editorialBriefs.test.ts, and the
   database-level halves (RLS, the SQL provenance assertions in section 7 of
   db/tests/editorial_brief_contract.sql) run in
   src/sql/editorialBriefContract.pglite.test.ts, owned by seat Sol.

   No test here opens a socket: every adapter call takes an injected stub.
   ========================================================================== */
import { describe, expect, it } from 'vitest'
import {
  EDITORIAL_GATE,
  applyPublishedSince, assertRegisteredClient, parseSourceItem,
  readResearch, resolveIndependentCount,
} from './editorialSources'
import {
  daysAgoIso, failingClient, rawCandidateSourceItem, rawGapSourceItem,
  rawRepostSourceItem, rawResearchPage, rawSourceItem, rawStaleSourceItem,
  rawUndatedSourceItem, sourceSnapshot, stubClient,
} from './editorialSources.fixtures'
import { EDITORIAL_RPCS, EditorialContractError } from './editorialTypes'
import type { EditorialRpcResult } from './editorialTypes'

/** A read route that only ever answers for the lane it is asked about — the
    same "no code path can produce a cross-tenant answer" shape
    editorialBriefs.fixtures.ts's readRoutes() uses, built over a per-lane
    item store. */
function researchRoutes(store: Record<string, Record<string, unknown>[]>) {
  return {
    [EDITORIAL_RPCS.readResearch]: (p: Record<string, unknown>): EditorialRpcResult => {
      const items = store[String(p.p_client_id)] ?? []
      return { data: rawResearchPage(String(p.p_client_id), items), error: null }
    },
  }
}

/* ------------------------------------------------------------------ T02 */

describe('T02 tenant isolation (source side)', () => {
  it('rejects an unregistered client id BEFORE any query is issued', async () => {
    const c = stubClient(researchRoutes({}))
    await expect(readResearch(c, 'not-a-client')).rejects.toMatchObject({ code: 'unknown_client' })
    await expect(readResearch(c, '../etc')).rejects.toMatchObject({ code: 'unknown_client' })
    await expect(readResearch(c, '')).rejects.toMatchObject({ code: 'unknown_client' })
    expect(c.calls).toEqual([])
  })

  it('scopes every call to the lane it was given, and presents the operator gate', async () => {
    const c = stubClient(researchRoutes({ arch: [rawSourceItem({ source_id: 'urn:fixture:arch:1' })] }))
    await readResearch(c, 'arch')
    expect(c.calls).toHaveLength(1)
    expect(c.calls[0].fn).toBe(EDITORIAL_RPCS.readResearch)
    expect(c.calls[0].params.p_client_id).toBe('arch')
    expect(c.calls[0].params.p_gate).toBe(EDITORIAL_GATE)
  })

  it('a lane with no rows reads its own empty page, never another lane’s rows', async () => {
    const c = stubClient(researchRoutes({
      ivan: [rawSourceItem({ source_id: 'urn:fixture:ivan:1', owner: 'Ivan-only synthetic owner' })],
    }))
    const page = await readResearch(c, 'arch')
    expect(page.items).toEqual([])
    expect(page.state).toBe('empty')
    expect(JSON.stringify(page)).not.toContain('Ivan-only synthetic owner')
  })

  it('refuses a source the server scoped to a different tenant than requested', () => {
    const raw = rawSourceItem({ source_client_scope: 'risedtc' })
    expect(() => parseSourceItem(raw, 'ivan')).toThrow(EditorialContractError)
    try {
      parseSourceItem(raw, 'ivan')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as EditorialContractError).code).toBe('wrong_client')
    }
  })

  it('refuses a row missing its tenant scope instead of defaulting it to public', () => {
    const raw = rawSourceItem()
    delete raw.source_client_scope
    expect(() => parseSourceItem(raw, 'ivan')).toThrow(EditorialContractError)
  })

  it('accepts a public-scoped source for any lane', () => {
    const raw = rawSourceItem({ source_client_scope: 'public' })
    const r = parseSourceItem(raw, 'arch')
    expect(r.ok).toBe(true)
  })
})

describe('source evidence projection', () => {
  it('preserves public-post metrics, denominator and capture dates outside candidate-only fields', () => {
    const raw = rawSourceItem({
      candidate_fields: {
        observed_metrics: { impressions: 271, reaction_counter: 9, comment_counter: 5 },
        observation_window: { published_at: '2026-09-15T14:00:32.173Z', captured_at: '2026-09-20T13:34:31.885Z' },
        metric_source: 'client_post_metrics',
        metric_denominator: 'one exact public post',
        body_state: 'unknown',
        source_identity: { platform: 'linkedin', native_id: 'urn:li:activity:7505626612307038208', collector_row_id: '6cdd1e61-9693-4b0a-9963-4696b7f6b7d0' },
      },
    })

    const parsed = parseSourceItem(raw, 'risedtc')
    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) throw new Error('expected source')
    expect(parsed.item.observed_metrics).toEqual({ impressions: 271, reaction_counter: 9, comment_counter: 5 })
    expect(parsed.item.metric_provenance).toEqual({
      source: 'client_post_metrics', denominator: 'one exact public post',
      observation_window: { published_at: '2026-09-15T14:00:32.173Z', captured_at: '2026-09-20T13:34:31.885Z' },
    })
    expect(parsed.item.body_state).toBe('unknown')
    expect(parsed.item.source_identity).toEqual({
      platform: 'linkedin', native_id: 'urn:li:activity:7505626612307038208', collector_row_id: '6cdd1e61-9693-4b0a-9963-4696b7f6b7d0',
    })
  })
})

/* ------------------------------------------------------------------ T03 */

describe('T03 source snapshot provenance', () => {
  it('carries publication date, capture date, owner, native id and body hash', async () => {
    const item = rawSourceItem({
      source_id: 'urn:fixture:provenance:1', owner: 'Synthetic Provenance Owner',
      source_content_hash: 'f'.repeat(64),
    })
    const c = stubClient(researchRoutes({ ivan: [item] }))
    const page = await readResearch(c, 'ivan')
    expect(page.items).toHaveLength(1)
    const s = page.items[0]
    expect(s.source_id).toBe('urn:fixture:provenance:1')
    expect(s.owner).toBe('Synthetic Provenance Owner')
    expect(s.source_content_hash).toBe('f'.repeat(64))
    expect(typeof s.source_published_date).toBe('string')
    expect(typeof s.captured_date).toBe('string')
  })

  it('a record with no publication date surfaces "unknown", never the ingest timestamp and never null', async () => {
    const c = stubClient(researchRoutes({ ivan: [rawUndatedSourceItem()] }))
    const page = await readResearch(c, 'ivan')
    const s = page.items.find((i) => i.source_id === 'urn:fixture:source:nodate')!
    expect(s.source_published_date).toBe('unknown')
    expect(s.source_published_date).not.toBeNull()
    expect(s.source_published_date).not.toBe(s.captured_date)
    expect(s.age_days).toBeNull()
  })

  it('the capture date never substitutes for the publication date when both are known', async () => {
    const item = rawSourceItem({
      source_published_date: daysAgoIso(30), captured_date: daysAgoIso(1),
    })
    const c = stubClient(researchRoutes({ ivan: [item] }))
    const page = await readResearch(c, 'ivan')
    const s = page.items[0]
    expect(s.source_published_date).not.toBe(s.captured_date)
  })

  it('re-reading the same source returns the same snapshot hash', async () => {
    const item = rawSourceItem({ snapshot_hash: 'snap-stable-v3' })
    const c = stubClient(researchRoutes({ ivan: [item] }))
    const a = await readResearch(c, 'ivan')
    const b = await readResearch(c, 'ivan')
    expect(a.items[0].snapshot_hash).toBe('snap-stable-v3')
    expect(a.items[0].snapshot_hash).toBe(b.items[0].snapshot_hash)
  })

  it('a malformed row with no source_id is an explicit gap, not a silent drop', async () => {
    const bad = rawSourceItem({ source_id: null })
    const good = rawSourceItem({ source_id: 'urn:fixture:good:1' })
    const c = stubClient(researchRoutes({ ivan: [bad, good] }))
    const page = await readResearch(c, 'ivan')
    expect(page.items).toHaveLength(1)
    expect(page.gaps.some((g) => g.reason === 'unavailable')).toBe(true)
  })
})

/* ------------------------------------------------------------------ T04 */

describe('T04 source fact vs derived summary (source side)', () => {
  it('preserves all five candidate fields and labels the three derived ones', async () => {
    const c = stubClient(researchRoutes({ ivan: [rawCandidateSourceItem()] }))
    const page = await readResearch(c, 'ivan')
    const s = page.items[0]
    expect(s.candidate_fields).not.toBeNull()
    expect(s.candidate_fields).toMatchObject({
      evidence: expect.any(String),
      raw_context: expect.any(String),
      editorial_assessment: expect.any(String),
      editorial_strength: expect.any(String),
      angle_options: expect.any(Array),
    })
    expect(s.derived_field_names).toEqual(
      expect.arrayContaining(['editorial_assessment', 'editorial_strength', 'angle_options']),
    )
    expect(s.derived_field_names).not.toContain('evidence')
    expect(s.derived_field_names).not.toContain('raw_context')
  })

  it('a derived item is independent:false and names its origin', async () => {
    const c = stubClient(researchRoutes({
      ivan: [rawSourceItem(), rawRepostSourceItem()],
    }))
    const page = await readResearch(c, 'ivan')
    const repost = page.items.find((i) => i.source_id === 'urn:fixture:source:1-repost')!
    expect(repost.independent).toBe(false)
    expect(repost.derived_from).toBe('urn:fixture:source:1')
  })

  it('a derived item with no derived_from becomes an explicit gap, not a thrown error and not a silent drop', async () => {
    const brokenRepost = rawSourceItem({
      source_id: 'urn:fixture:source:broken-repost', independent: false, derived_from: null,
    })
    const c = stubClient(researchRoutes({ ivan: [brokenRepost] }))
    const page = await readResearch(c, 'ivan')
    expect(page.items).toEqual([])
    expect(page.gaps.some((g) => g.source_id === 'urn:fixture:source:broken-repost')).toBe(true)
  })

  it('a source flagged truncated on the wire throws, rather than shortening silently', () => {
    const clipped = rawSourceItem({ passage_truncated: true })
    expect(() => parseSourceItem(clipped, 'ivan')).toThrow(EditorialContractError)
    try {
      parseSourceItem(clipped, 'ivan')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as EditorialContractError).code).toBe('truncated_passage')
    }
  })

  it('a body with neither a retained passage nor an explicit gap is refused', () => {
    const broken = rawSourceItem({ passage: null, source_content_hash: null, gap_state: null })
    try {
      parseSourceItem(broken, 'ivan')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as EditorialContractError).code).toBe('permission_gap')
    }
  })

  it('a candidate source missing one of its five fields is an explicit gap', async () => {
    const partial = rawSourceItem({
      source_kind: 'candidate',
      source_ref: { excerpt_pointer: 'editorial_sources:urn:fixture:partial:1@1' },
      candidate_fields: { evidence: 'only one field present' },
    })
    const c = stubClient(researchRoutes({ ivan: [partial] }))
    const page = await readResearch(c, 'ivan')
    expect(page.items).toEqual([])
    expect(page.gaps.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ T05 (adjacent) */

describe('T05-adjacent: population vs page independent count', () => {
  it('recomputes from items when the whole filtered population fit on one page', () => {
    const items = [
      sourceSnapshot({ source_id: 'a', independent: true }),
      sourceSnapshot({ source_id: 'a-repost', independent: false, derived_from: 'a' }),
    ]
    // The server LIES and says 99; the whole population (total=2, no cursor) is in hand, so the
    // adapter trusts the evidence it can see over the wire count.
    expect(resolveIndependentCount(items, 2, null, 99)).toBe(1)
  })

  it('trusts the server’s population aggregate when the page is only a slice', () => {
    const items = [sourceSnapshot({ source_id: 'a', independent: true })]
    // total=50, a next_cursor exists: this page cannot see the other 49 rows, so a page-local
    // recompute would under-count. The server's aggregate (12) is reported instead.
    expect(resolveIndependentCount(items, 50, 'a', 12)).toBe(12)
  })

  it('never reports a negative count from a malformed server value', () => {
    const items = [sourceSnapshot({ source_id: 'a' })]
    expect(resolveIndependentCount(items, 50, 'cursor-x', -5)).toBe(0)
  })
})

/* ------------------------------------------------------------------ T06 */

describe('T06 empty / missing corpus (source side)', () => {
  it('a client with zero sources gets an explicit empty page, never a throw', async () => {
    const c = stubClient(researchRoutes({}))
    const page = await readResearch(c, 'ivan')
    expect(page.state).toBe('empty')
    expect(page.items).toEqual([])
    expect(page.total).toBe(0)
    expect(page.health).toBeDefined()
  })

  it('never falls back to another lane’s data when this lane is empty', async () => {
    const c = stubClient(researchRoutes({ arch: [rawSourceItem({ owner: 'Arch-only synthetic owner' })] }))
    const page = await readResearch(c, 'risedtc')
    expect(page.items).toEqual([])
    expect(JSON.stringify(page)).not.toContain('Arch-only synthetic owner')
  })

  it('a row with an unrecognized source_kind is an explicit gap, not dropped', async () => {
    const weird = rawSourceItem({ source_id: 'urn:fixture:weird:1', source_kind: 'tweet_thread' })
    const good = rawSourceItem({ source_id: 'urn:fixture:good:1' })
    const c = stubClient(researchRoutes({ ivan: [weird, good] }))
    const page = await readResearch(c, 'ivan')
    expect(page.items).toHaveLength(1)
    expect(page.items[0].source_id).toBe('urn:fixture:good:1')
    const gap = page.gaps.find((g) => g.source_id === 'urn:fixture:weird:1')
    expect(gap).toBeDefined()
    expect(gap!.reason).toBe('unsupported_kind')
    expect(page.state).toBe('partial')
  })

  it('an unsupported requested kind is dropped from the filter sent to the RPC and listed as a gap', async () => {
    const c = stubClient(researchRoutes({ ivan: [rawSourceItem()] }))
    const page = await readResearch(c, 'ivan', { kinds: ['candidate', 'tweet_thread' as never] })
    expect(c.calls[0].params.p_filters).toMatchObject({ kinds: ['candidate'] })
    expect(page.gaps.some((g) => g.reason === 'unsupported_kind' && g.detail.includes('tweet_thread'))).toBe(true)
  })

  it('a transport failure is reported as "failed", never collapsed into "empty"', async () => {
    const c = failingClient('the research read failed')
    const page = await readResearch(c, 'ivan')
    expect(page.state).toBe('failed')
    expect(page.message).toBe('the research read failed')
    expect(page.items).toEqual([])
  })

  it('a server-reported permission gap is carried through, not merged away', async () => {
    const c = stubClient(researchRoutes({ ivan: [rawGapSourceItem()] }))
    const page = await readResearch(c, 'ivan')
    const item = page.items.find((i) => i.source_id === 'urn:fixture:source:denied')!
    expect(item.gap_state).toEqual({
      reason: 'permission_denied', detail: 'The asset owner has not granted republication.',
    })
    expect(item.passage).toBeNull()
    expect(item.permission_state).toBe('denied')
  })
})

/* ------------------------------------------------------------------ T07 */

describe('T07 stale evidence (source side)', () => {
  it('recomputes currency from the publication date, ignoring a stale-but-lying server value', async () => {
    const c = stubClient(researchRoutes({ ivan: [rawStaleSourceItem()] }))
    const page = await readResearch(c, 'ivan')
    const s = page.items[0]
    // The fixture's wire payload says currency_state:'current', age_days:1 — both wrong. The
    // adapter must report the honest, recomputed values.
    expect(s.currency_state).toBe('historical')
    expect(s.age_days).toBeGreaterThanOrEqual(199)
  })

  it('a fresh capture of an old post never reports "current"', async () => {
    const item = rawSourceItem({
      source_published_date: daysAgoIso(365), captured_date: daysAgoIso(0),
      currency_state: 'current', age_days: 0,
    })
    const c = stubClient(researchRoutes({ ivan: [item] }))
    const page = await readResearch(c, 'ivan')
    expect(page.items[0].currency_state).not.toBe('current')
  })

  it('a source published within the stale bound reports current', async () => {
    const item = rawSourceItem({ source_published_date: daysAgoIso(5) })
    const c = stubClient(researchRoutes({ ivan: [item] }))
    const page = await readResearch(c, 'ivan')
    expect(page.items[0].currency_state).toBe('current')
  })
})

/* ------------------------------------------------------------------ T12 */

describe('T12 read calls are side-effect free (source side)', () => {
  it('issues exactly one call, to the read RPC only — never a curation or promotion route', async () => {
    const c = stubClient(researchRoutes({ ivan: [rawSourceItem()] }))
    await readResearch(c, 'ivan')
    expect(c.calls).toHaveLength(1)
    expect(c.calls[0].fn).toBe('editorial_read_research')
    for (const forbidden of [
      EDITORIAL_RPCS.setSourceCuration, EDITORIAL_RPCS.linkArtifact,
      EDITORIAL_RPCS.promoteBatch, EDITORIAL_RPCS.recordEditorialDecision,
    ]) {
      expect(c.calls.some((call) => call.fn === forbidden)).toBe(false)
    }
  })

  it('repeated reads make repeated calls and never mutate the store between them', async () => {
    const store = { ivan: [rawSourceItem({ curation_state: 'unseen' })] }
    const c = stubClient(researchRoutes(store))
    const a = await readResearch(c, 'ivan')
    const b = await readResearch(c, 'ivan')
    expect(a.items[0].curation_state).toBe('unseen')
    expect(b.items[0].curation_state).toBe('unseen')
    expect(c.calls).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ misc: publishedSince, guards */

describe('applyPublishedSince', () => {
  it('drops items published before the cutoff and keeps items on or after it', () => {
    const items = [
      sourceSnapshot({ source_id: 'old', source_published_date: daysAgoIso(400) }),
      sourceSnapshot({ source_id: 'new', source_published_date: daysAgoIso(2) }),
    ]
    const kept = applyPublishedSince(items, daysAgoIso(30))
    expect(kept.map((i) => i.source_id)).toEqual(['new'])
  })

  it('never drops a source with an unknown publication date', () => {
    const items = [sourceSnapshot({ source_id: 'undated', source_published_date: 'unknown' })]
    const kept = applyPublishedSince(items, daysAgoIso(1))
    expect(kept).toHaveLength(1)
  })

  it('is a no-op when publishedSince is not provided', () => {
    const items = [sourceSnapshot({ source_id: 'a' }), sourceSnapshot({ source_id: 'b' })]
    expect(applyPublishedSince(items, undefined)).toHaveLength(2)
  })
})

describe('assertRegisteredClient', () => {
  it('accepts every registered lane and refuses everything else', () => {
    for (const lane of ['ivan', 'risedtc', 'arch']) {
      expect(assertRegisteredClient(lane)).toBe(lane)
    }
    for (const bad of ['zz-selftest', '', null, undefined, 42, 'IVAN']) {
      expect(() => assertRegisteredClient(bad)).toThrow(EditorialContractError)
    }
  })
})
