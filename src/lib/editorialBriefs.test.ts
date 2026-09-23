/* ==========================================================================
   Contract tests for the BRIEF side of the editorial adapter.

   Test ids map to verification/contract-tests.SPEC.md. The source-side halves
   of T03/T04/T06 (readResearch) live with editorialSources.ts; everything
   asserted here is a brief-side behaviour. The database-level halves of T02,
   T11 and T12 (RLS, tenant isolation in SQL, append-only triggers, read
   side-effect freedom against a real instance) are executed in
   src/sql/editorialBriefContract.pglite.test.ts against db/105.

   No test here opens a socket: every adapter call takes an injected stub.
   ========================================================================== */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  EDITORIAL_GATE,
  assertContentHash, assertEvidenceBodyIntact, assertRegisteredClient,
  canonicalBriefPayload, currencyViolations, evidenceCurrency,
  hasConflictingIndependence, readBrief, readBriefOutcomes, readBriefs,
  readSuggestionRefresh, readinessBlockReasons, recomputeIndependentCount,
  recordEditorialDecision, requestDraft, requestSuggestionRefresh,
  resourceBlockReason, reviewIsIndependent, unknownOutcomeMetrics,
  validateMeasurement, validateMeasurements, verifyContentHash,
} from './editorialBriefs'
import {
  brief, briefStore, evidence, failingClient, measurement, stubClient,
} from './editorialBriefs.fixtures'
import { EDITORIAL_RPCS, EditorialContractError } from './editorialTypes'
import type { EditorialBrief, EditorialRpcResult } from './editorialTypes'

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** A read route that can only answer for the lane it was asked about. Built
    over a per-lane store, so a cross-tenant answer is not merely unlikely —
    there is no code path that produces one. */
function readRoutes(store = briefStore()) {
  const own = (lane: unknown): EditorialBrief[] => store[String(lane)] ?? []
  return {
    [EDITORIAL_RPCS.readBriefs]: (p: Record<string, unknown>): EditorialRpcResult => {
      const items = own(p.p_client_id).filter(b => p.p_batch_id === null
        || p.p_batch_id === undefined || b.batch_id === p.p_batch_id)
      const knownBatch = p.p_batch_id === null || p.p_batch_id === undefined
        || own(p.p_client_id).some(b => b.batch_id === p.p_batch_id)
      return {
        data: knownBatch
          ? {
            client_id: p.p_client_id, batch_id: p.p_batch_id ?? null,
            state: items.length ? 'ready' : 'empty', items, total: items.length,
            next_cursor: null, coverage_gaps: [],
          }
          : {
            client_id: p.p_client_id, batch_id: p.p_batch_id, state: 'empty',
            items: [], total: 0, next_cursor: null, coverage_gaps: [],
            message: 'No batch with that id exists for this lane.',
          },
        error: null,
      }
    },
    [EDITORIAL_RPCS.readBrief]: (p: Record<string, unknown>): EditorialRpcResult => {
      const mine = own(p.p_client_id)
      const anyVersion = mine.some(b => b.identity.brief_id === p.p_brief_id)
      const hit = mine.find(b => b.identity.brief_id === p.p_brief_id
        && b.identity.version === p.p_version)
      return {
        data: hit
          ? { found: true, brief: hit }
          : { found: false, reason: anyVersion ? 'no_such_version' : 'no_such_brief' },
        error: null,
      }
    },
    [EDITORIAL_RPCS.readBriefOutcomes]: (p: Record<string, unknown>): EditorialRpcResult => {
      const mine = own(p.p_client_id)
      const hit = mine.some(b => b.identity.brief_id === p.p_brief_id)
      return {
        data: {
          client_id: p.p_client_id, brief_id: p.p_brief_id,
          state: hit ? 'ready' : 'empty',
          observations: hit
            ? [
              {
                snapshot_id: 'snap-1', artifact_id: null, artifact_role: null,
                metric: 'impressions', observed_value: 1200,
                denominator: 'one post, one account', scope: 'single post',
                window_start: '2026-09-01T00:00:00Z', window_end: '2026-09-18T00:00:00Z',
                captured_at: '2026-09-18T00:00:00Z', event_definition: 'platform impression',
                attribution: 'direct', limitation: 'no age-matched comparison',
              },
              {
                snapshot_id: 'snap-2', artifact_id: null, artifact_role: null,
                metric: 'landing_opt_ins', observed_value: 'unknown',
                denominator: 'unknown', scope: 'route',
                window_start: 'unknown', window_end: 'unknown',
                captured_at: '2026-09-18T00:00:00Z', event_definition: 'opt-in event',
                attribution: 'unknown', limitation: 'telemetry missing, not zero',
              },
            ]
            : [],
          unknowns: hit ? ['no opt-in telemetry exists for this route'] : [],
          attribution_limitations: 'Direct and assisted attribution are distinct.',
          publication_id: null,
        },
        error: null,
      }
    },
  }
}

/* ------------------------------------------------------------------ T01 */

describe('T01 typed identity', () => {
  it('returns the requested version with its own hash, stable across two reads', async () => {
    const c = stubClient(readRoutes())
    const a = await readBrief(c, 'ivan', 'brief-fixture-01', 1)
    const b = await readBrief(c, 'ivan', 'brief-fixture-01', 1)
    expect(a.found).toBe(true)
    if (!a.found || !b.found || !('brief' in a) || !('brief' in b)) throw new Error('unreachable')
    expect(a.brief.identity.version).toBe(1)
    expect(a.brief.identity.content_hash).toBe(b.brief.identity.content_hash)
    // Every field group is present.
    for (const k of ['identity', 'purpose', 'editorial_direction', 'evidence', 'measurements',
      'claim_ledger', 'calls', 'resource', 'distribution', 'production', 'evaluation',
      'decisions_links', 'review']) {
      expect(a.brief).toHaveProperty(k)
    }
  })

  it('a version that does not exist is not-found, never the newest version', async () => {
    const c = stubClient(readRoutes())
    const r = await readBrief(c, 'ivan', 'brief-fixture-01', 7)
    expect(r.found).toBe(false)
    if (r.found) throw new Error('unreachable')
    expect(r.reason).toBe('no_such_version')
  })

  it('refuses a server answer that substitutes a different version', async () => {
    const c = stubClient({
      [EDITORIAL_RPCS.readBrief]: () => ({ data: { found: true, brief: brief() }, error: null }),
    })
    await expect(readBrief(c, 'ivan', 'brief-fixture-01', 4)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('verifies a brief against its own content hash and catches a body edit', async () => {
    const b = brief()
    b.identity.content_hash = sha256(canonicalBriefPayload(b))
    await expect(assertContentHash(b, sha256)).resolves.toBeUndefined()

    const tampered = brief({ ...b, editorial_direction: { ...b.editorial_direction, angle: 'changed' } })
    tampered.identity.content_hash = b.identity.content_hash
    const r = await verifyContentHash(tampered, sha256)
    expect(r.ok).toBe(false)
    await expect(assertContentHash(tampered, sha256)).rejects.toMatchObject({
      code: 'content_hash_mismatch',
    })
  })

  it('canonicalizes key order so an equal brief hashes equal', () => {
    const a = brief()
    // Same brief, keys emitted in a different order.
    const shuffled: Record<string, unknown> = {}
    for (const k of Object.keys(a).sort().reverse()) shuffled[k] = (a as Record<string, unknown>)[k]
    const reordered = JSON.parse(JSON.stringify(shuffled)) as EditorialBrief
    expect(canonicalBriefPayload(reordered)).toBe(canonicalBriefPayload(a))
  })
})

/* ------------------------------------------------------------------ T02 */

describe('T02 tenant isolation', () => {
  it('rejects an unregistered client id BEFORE any query is issued', async () => {
    const c = stubClient(readRoutes())
    await expect(readBriefs(c, 'not-a-client')).rejects.toMatchObject({ code: 'unknown_client' })
    await expect(readBrief(c, '../etc', 'brief-fixture-01', 1)).rejects.toMatchObject({
      code: 'unknown_client',
    })
    await expect(readBriefOutcomes(c, '', 'brief-fixture-01')).rejects.toMatchObject({
      code: 'unknown_client',
    })
    await expect(recordEditorialDecision(
      c, 'nope', { kind: 'brief', id: 'x', version: 1 }, 1, 'shortlist', 'r', 'candidate', 'rq',
    )).rejects.toMatchObject({ code: 'unknown_client' })
    expect(c.calls).toEqual([])
  })

  it('never returns another tenant’s brief and never leaks its content', async () => {
    const c = stubClient(readRoutes())
    const r = await readBrief(c, 'arch', 'brief-fixture-01', 1)
    expect(r.found).toBe(false)
    if (r.found) throw new Error('unreachable')
    expect(r.reason).toBe('no_such_brief')
    expect(JSON.stringify(r)).not.toContain('A synthetic topic')
    expect(JSON.stringify(r)).not.toContain('ivan')
  })

  it('scopes every read call to the lane it was given', async () => {
    const c = stubClient(readRoutes())
    await readBriefs(c, 'arch')
    await readBriefOutcomes(c, 'arch', 'brief-fixture-01')
    for (const call of c.calls) expect(call.params.p_client_id).toBe('arch')
    const outcomes = await readBriefOutcomes(c, 'arch', 'brief-fixture-01')
    expect(outcomes.state).toBe('empty')
    expect(outcomes.observations).toEqual([])
  })

  it('presents the operator gate on every call rather than trusting the client id alone', async () => {
    const c = stubClient(readRoutes())
    await readBriefs(c, 'ivan')
    expect(c.calls[0].params.p_gate).toBe(EDITORIAL_GATE)
  })

  it('recomputes the evidence count instead of trusting the number on the wire', async () => {
    const lying = brief({ independent_source_count: 99 })
    const c = stubClient({
      [EDITORIAL_RPCS.readBriefs]: () => ({
        data: {
          client_id: 'ivan', batch_id: null, state: 'ready', items: [lying], total: 1,
          next_cursor: null, coverage_gaps: [],
        },
        error: null,
      }),
    })
    const page = await readBriefs(c, 'ivan')
    if ('access' in page.items[0]) throw new Error('unexpected access gap')
    expect(page.items[0].independent_source_count).toBe(1)
  })
})

/* ------------------------------------------------------------------ T04 */

describe('T04 source fact vs derived summary', () => {
  it('a derived item is never independent and names its origin', () => {
    const derived = evidence({
      evidence_id: 'ev-02', independent: false, derived_from: 'urn:fixture:source:1',
      source_id: 'urn:fixture:source:1-summary',
    })
    const b = brief({ evidence: [evidence(), derived] })
    expect(recomputeIndependentCount(b)).toBe(1)
    expect(derived.derived_from).toBeTruthy()
  })

  it('a source carried with conflicting independence is named', () => {
    const b = brief({
      evidence: [
        evidence({ evidence_id: 'ev-01', independent: true }),
        evidence({ evidence_id: 'ev-02', independent: false, derived_from: 'x' }),
      ],
    })
    expect(hasConflictingIndependence(b)).toBe('urn:fixture:source:1')
  })

  it('a truncated supporting passage is an error, not a shortening', () => {
    const clipped = { ...evidence({ evidence_id: 'ev-03' }), passage_truncated: true }
    const b = brief({ evidence: [clipped as unknown as ReturnType<typeof evidence>] })
    expect(() => assertEvidenceBodyIntact(b)).toThrow(EditorialContractError)
    try {
      assertEvidenceBodyIntact(b)
    } catch (e) {
      expect((e as EditorialContractError).code).toBe('truncated_passage')
    }
  })

  it('a missing body with no gap state is refused', () => {
    const b = brief({ evidence: [evidence({ passage: null, source_content_hash: null })] })
    try {
      assertEvidenceBodyIntact(b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as EditorialContractError).code).toBe('permission_gap')
    }
  })
})

/* ------------------------------------------------------------------ T05 */

describe('T05 duplicate evidence', () => {
  it('counts one source once however many claims cite it', () => {
    const b = brief({
      evidence: [
        evidence({ evidence_id: 'ev-01', relation: 'supports_claim' }),
        evidence({ evidence_id: 'ev-02', relation: 'supports_buyer_concern' }),
        evidence({ evidence_id: 'ev-03', relation: 'observed_market_performance' }),
      ],
    })
    expect(recomputeIndependentCount(b)).toBe(1)
  })

  it('a repost under a different row id adds nothing', () => {
    const b = brief({
      evidence: [
        evidence(),
        evidence({
          evidence_id: 'ev-02', source_id: 'urn:fixture:source:1-repost',
          independent: false, derived_from: 'urn:fixture:source:1',
        }),
      ],
    })
    expect(recomputeIndependentCount(b)).toBe(1)
  })

  it('a gapped source is not counted as corroboration', () => {
    const b = brief({
      evidence: [
        evidence(),
        evidence({
          evidence_id: 'ev-02', source_id: 'urn:fixture:source:2',
          passage: null, source_content_hash: null,
          gap_state: { reason: 'permission_denied', detail: 'the owner refused the excerpt' },
        }),
      ],
    })
    expect(recomputeIndependentCount(b)).toBe(1)
  })

  it('reports a stated count that the evidence does not support', () => {
    const b = brief({ independent_source_count: 3 })
    expect(readinessBlockReasons(b).join(' ')).toContain('the evidence supports 1')
  })
})

/* ------------------------------------------------------------------ T06 */

describe('T06 empty / missing corpus', () => {
  it('a batch id that does not exist is an explicit empty page, not a throw', async () => {
    const store = briefStore()
    store.ivan = [brief({ batch_id: 'cb01-ivan-b1' })]
    const c = stubClient(readRoutes(store))
    const page = await readBriefs(c, 'ivan', 'no-such-batch')
    expect(page.state).toBe('empty')
    expect(page.items).toEqual([])
    expect(page.total).toBe(0)
    expect(page.message).toBeTruthy()
  })

  it('never silently falls back to another lane’s data', async () => {
    const c = stubClient(readRoutes())
    const page = await readBriefs(c, 'risedtc')
    expect(page.items).toEqual([])
    expect(page.state).toBe('empty')
    expect(JSON.stringify(page)).not.toContain('brief-fixture-01')
  })

  it('a failed transport is ‘failed’ and never ‘empty’', async () => {
    const c = failingClient('connection refused')
    const page = await readBriefs(c, 'ivan')
    expect(page.state).toBe('failed')
    expect(page.message).toContain('connection refused')

    const outcomes = await readBriefOutcomes(c, 'ivan', 'brief-fixture-01')
    expect(outcomes.state).toBe('failed')
    expect(outcomes.observations).toEqual([])

    await expect(readBrief(c, 'ivan', 'brief-fixture-01', 1)).rejects.toMatchObject({
      code: 'read_failed',
    })
  })

  it('a thrown transport is caught and reported, never a hang', async () => {
    const c = {
      async rpc(): Promise<EditorialRpcResult> { throw new Error('auth refresh exploded') },
    }
    const page = await readBriefs(c, 'ivan')
    expect(page.state).toBe('failed')
    expect(page.message).toContain('auth refresh exploded')
  })
})

/* ------------------------------------------------------------------ T07 */

describe('T07 stale evidence', () => {
  const OLD = '2026-03-01T00:00:00Z'   // 203 days before the fixture brief date

  it('reports the publication date and the computed age, and refuses ‘current’', () => {
    const b = brief({
      evidence: [evidence({ source_published_date: OLD, captured_date: '2026-09-19T00:00:00Z' })],
    })
    expect(evidenceCurrency(b, 'ev-01')).toBe('historical')
    const violations = currencyViolations(b)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('203 days')
  })

  it('a fresh capture alone never refreshes currency', () => {
    const b = brief({
      evidence: [evidence({
        source_published_date: OLD, captured_date: '2026-09-20T08:59:00Z',
        currency_state: 'current',
      })],
    })
    expect(currencyViolations(b)).toHaveLength(1)
    expect(evidenceCurrency(b, 'ev-01')).toBe('historical')
  })

  it('an unknown publication date cannot be claimed as current', () => {
    const b = brief({
      evidence: [evidence({ source_published_date: 'unknown', currency_state: 'current' })],
    })
    expect(currencyViolations(b)[0]).toContain('unknown publication date')
    expect(evidenceCurrency(b, 'ev-01')).toBe('unknown')
  })

  it('leaves a genuinely recent source alone', () => {
    expect(currencyViolations(brief())).toEqual([])
  })
})

/* ------------------------------------------------------------------ T08 */

describe('T08 invalid metric baseline', () => {
  it('rejects a measurement with no denominator, naming the missing part', () => {
    const b = brief({ measurements: [measurement({ denominator: '' })] })
    try {
      validateMeasurements(b)
      throw new Error('should have thrown')
    } catch (e) {
      const err = e as EditorialContractError
      expect(err.code).toBe('invalid_measurement')
      expect(err.detail).toContain('denominator')
    }
  })

  it('rejects a measurement whose source ref resolves to nothing in this brief', () => {
    const b = brief({ measurements: [measurement({ source_ref: 'ev-does-not-exist' })] })
    try {
      validateMeasurement(b, b.measurements[0])
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as EditorialContractError).detail).toContain('ev-does-not-exist')
    }
  })

  it('refuses a call-sourced value written into a performance metric', () => {
    const b = brief({
      evidence: [evidence({ relation: 'supports_buyer_concern', source_kind: 'call' })],
      measurements: [measurement({ metric_family: 'own_performance' })],
    })
    try {
      validateMeasurements(b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as EditorialContractError).message).toContain('cannot populate')
    }
  })

  it('refuses a market metric populating a conversion field', () => {
    const b = brief({
      evidence: [evidence({ relation: 'observed_market_performance' })],
      measurements: [measurement({ metric_family: 'conversion' })],
    })
    expect(() => validateMeasurements(b)).toThrow(EditorialContractError)
  })

  it('never defaults a missing value to 0', () => {
    const m = measurement()
    delete (m as Partial<typeof m>).observed_value
    const b = brief({ measurements: [m] })
    try {
      validateMeasurements(b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as EditorialContractError).detail).toContain('observed_value')
    }
  })

  it('an empty measurement list needs a stated reason', () => {
    expect(() => validateMeasurements(brief({ measurements: [], measurements_none_reason: null })))
      .toThrow(EditorialContractError)
    expect(() => validateMeasurements(brief({
      measurements: [], measurements_none_reason: 'A call excerpt justifies this topic with no market metric.',
    }))).not.toThrow()
  })
})

/* ------------------------------------------------------------------ T09 */

describe('T09 source permission', () => {
  it('a denied excerpt keeps its pointer and withholds its body', () => {
    const gapped = evidence({
      evidence_id: 'ev-02', source_id: 'urn:fixture:asset:1', source_kind: 'asset',
      source_ref: { excerpt_pointer: 'editorial_sources:urn:fixture:asset:1:passage@1' },
      passage: null, source_content_hash: null,
      gap_state: { reason: 'permission_denied', detail: 'the owner refused the excerpt' },
      permission_state: 'denied',
    })
    const b = brief({ evidence: [evidence(), gapped] })
    expect(() => assertEvidenceBodyIntact(b)).not.toThrow()
    expect(gapped.source_ref).toHaveProperty('excerpt_pointer')
    expect(gapped.passage).toBeNull()
  })

  it('a resource cannot be ‘ready’ without id, version, route and permission basis', () => {
    const b = brief({
      resource: {
        asset_id: '', version: '', artifact_role: 'lm_asset', readiness: 'ready',
        access_route: '', permission_basis: '', required_missing_material: [],
        draft_state: 'draft', public_catalog_state: 'not listed',
      },
    })
    const reason = resourceBlockReason(b)
    expect(reason).toContain('asset_id')
    expect(reason).toContain('permission_basis')
  })

  it('a ready resource with outstanding material is blocked', () => {
    const b = brief({
      resource: {
        asset_id: 'asset-1', version: 'v1', artifact_role: 'lm_asset', readiness: 'ready',
        access_route: 'a synthetic route', permission_basis: 'public source',
        required_missing_material: ['a screenshot'], draft_state: 'draft',
        public_catalog_state: 'listed',
      },
    })
    expect(resourceBlockReason(b)).toContain('required_missing_material')
  })

  it('blocks only the brief it belongs to', async () => {
    const store = briefStore()
    store.ivan = [brief({ readiness: 'needs_material', missing_material: ['permission'] })]
    const c = stubClient(readRoutes(store))
    const arch = await readBriefs(c, 'arch')
    expect(arch.state).toBe('ready')
  })
})

/* ------------------------------------------------------------------ T10 */

describe('T10 independent review', () => {
  it('a self-review is not a review', () => {
    const b = brief()
    expect(reviewIsIndependent(b, 'Reviewer Seat')).toBe(false)
    expect(reviewIsIndependent(b, 'Some Other Seat')).toBe(true)
  })

  it('no review at all is un-reviewed', () => {
    expect(reviewIsIndependent(brief({ review: null }), 'Author Seat')).toBe(false)
  })

  it('a ready_to_draft brief with a self-reviewed pass is blocked', () => {
    const reasons = readinessBlockReasons(brief(), 'Reviewer Seat')
    expect(reasons.join(' ')).toContain('its own author')
  })

  it('a ready_to_draft brief that still lists missing material is blocked', () => {
    const reasons = readinessBlockReasons(
      brief({ readiness: 'ready_to_draft', missing_material: ['an asset'] }), 'Author Seat')
    expect(reasons.join(' ')).toContain('missing_material is not empty')
  })

  it('an independently reviewed complete brief has no blocking reason', () => {
    expect(readinessBlockReasons(brief(), 'Author Seat')).toEqual([])
  })
})

/* ------------------------------------------------------------------ T11 */

describe('T11 decision append-only and concurrency', () => {
  /** A ledger stub with the real idempotency and concurrency rules. */
  function ledger(headVersion = 2) {
    const rows = new Map<string, Record<string, unknown>>()
    return {
      rows,
      routes: {
        [EDITORIAL_RPCS.recordEditorialDecision]: (p: Record<string, unknown>): EditorialRpcResult => {
          const key = `${p.p_client_id}|${p.p_request_id}`
          const existing = rows.get(key)
          if (existing) {
            return { data: { ...existing, outcome: 'duplicate' }, error: null }
          }
          const stale = p.p_expected_version !== null && p.p_expected_version !== headVersion
          const row = {
            decision_id: `dec-${rows.size + 1}`, client_id: p.p_client_id,
            request_id: p.p_request_id,
            target: { kind: p.p_target_kind, id: p.p_target_id, version: p.p_target_version },
            action: p.p_action, scope: p.p_scope, reason: p.p_reason,
            expected_version: p.p_expected_version, observed_version: headVersion,
            outcome: stale ? 'conflict' : 'recorded',
            recorded_at: '2026-09-20T12:00:00Z',
            conflict: stale
              ? { reason: `version ${headVersion} is now current`, newer_decision_id: null }
              : null,
            promoted: false,
          }
          rows.set(key, row)
          return { data: row, error: null }
        },
      },
    }
  }

  it('a replayed request returns the same receipt and writes one row', async () => {
    const l = ledger()
    const c = stubClient(l.routes)
    const first = await recordEditorialDecision(
      c, 'ivan', { kind: 'brief', id: 'brief-fixture-01', version: 2 }, 2,
      'shortlist', 'the strongest option this week', 'candidate', 'req-001')
    const replay = await recordEditorialDecision(
      c, 'ivan', { kind: 'brief', id: 'brief-fixture-01', version: 2 }, 2,
      'shortlist', 'the strongest option this week', 'candidate', 'req-001')
    expect(first.outcome).toBe('recorded')
    expect(replay.decision_id).toBe(first.decision_id)
    expect(replay.outcome).toBe('duplicate')
    expect(l.rows.size).toBe(1)
  })

  it('a stale expectedVersion returns a conflict carrying the current version', async () => {
    const l = ledger(2)
    const c = stubClient(l.routes)
    const r = await recordEditorialDecision(
      c, 'ivan', { kind: 'brief', id: 'brief-fixture-01', version: 1 }, 1,
      'reject', 'taken against the old version', 'angle', 'req-002')
    expect(r.outcome).toBe('conflict')
    expect(r.observed_version).toBe(2)
    expect(r.conflict?.reason).toContain('2')
  })

  it('a decision never promotes anything', async () => {
    const c = stubClient(ledger().routes)
    const r = await recordEditorialDecision(
      c, 'ivan', { kind: 'brief', id: 'brief-fixture-01', version: 2 }, 2,
      'shortlist', 'a reason', 'candidate', 'req-003')
    expect(r.promoted).toBe(false)
    expect(c.calls.map(x => x.fn)).toEqual([EDITORIAL_RPCS.recordEditorialDecision])
  })

  it('a skipped card produces no decision row', async () => {
    const l = ledger()
    const c = stubClient(l.routes)
    // A skip is the absence of a call. Nothing is recorded, by construction.
    expect(c.calls).toEqual([])
    expect(l.rows.size).toBe(0)
  })

  it('refuses a decision with no reason and no request id', async () => {
    const c = stubClient(ledger().routes)
    await expect(recordEditorialDecision(
      c, 'ivan', { kind: 'brief', id: 'b', version: 1 }, 1, 'reject', '  ', 'angle', 'req',
    )).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(recordEditorialDecision(
      c, 'ivan', { kind: 'brief', id: 'b', version: 1 }, 1, 'reject', 'a reason', 'angle', '',
    )).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(c.calls).toEqual([])
  })
})

/* ------------------------------------------------------------------ T12 */

describe('T12 read calls are side-effect free', () => {
  it('no read issues a write RPC', async () => {
    const c = stubClient(readRoutes())
    await readBriefs(c, 'ivan')
    await readBrief(c, 'ivan', 'brief-fixture-01', 1)
    await readBriefOutcomes(c, 'ivan', 'brief-fixture-01')
    const writes = [
      EDITORIAL_RPCS.recordEditorialDecision,
      EDITORIAL_RPCS.setSourceCuration,
      EDITORIAL_RPCS.linkArtifact,
      EDITORIAL_RPCS.promoteBatch,
    ]
    for (const call of c.calls) expect(writes).not.toContain(call.fn)
    expect(c.calls.map(x => x.fn)).toEqual([
      EDITORIAL_RPCS.readBriefs, EDITORIAL_RPCS.readBrief, EDITORIAL_RPCS.readBriefOutcomes,
    ])
  })

  it('reports an unknown outcome as unknown, never as zero', async () => {
    const c = stubClient(readRoutes())
    const read = await readBriefOutcomes(c, 'ivan', 'brief-fixture-01')
    expect(unknownOutcomeMetrics(read)).toEqual(['landing_opt_ins'])
    expect(read.observations.find(o => o.metric === 'landing_opt_ins')?.observed_value)
      .toBe('unknown')
    expect(read.unknowns).toHaveLength(1)
  })
})

/* ------------------------------------------- Run-2 authenticated boundaries */

describe('Run 2 authenticated boundaries', () => {
  it('binds refresh to the selected saved plan and refuses malformed identity before invoke', async () => {
    const c=stubClient({}); const invokes: unknown[]=[]
    c.functions={async invoke(_name, options){invokes.push(options.body);return {data:{status:'running'},error:null}}}
    const weekly={week_start:'2026-09-28',expected_manifest_hash:'a'.repeat(64),provisional_policy_suggestion_id:'proposal:ivan:09'}
    await requestSuggestionRefresh(c,'ivan','direction-9','request-9',weekly)
    expect(invokes).toEqual([{client_id:'ivan',expected_direction_version:'direction-9',request_id:'request-9',...weekly}])
    await expect(requestSuggestionRefresh(c,'ivan','direction-9','request-10',{...weekly,expected_manifest_hash:'wrong'})).rejects.toThrow()
    expect(invokes).toHaveLength(1)
  })

  it('routes explicit refresh/draft requests and polls the exact refresh id', async () => {
    const c = stubClient({ editorial_read_refresh: p => ({ data: {
      refresh_id: p.p_refresh_id, client_id: p.p_client_id, status: 'failed', batch_id: null,
      last_usable_batch_id: 'old-batch', coverage_gaps: [], awaiting_reconciliation: false,
      collection_health: { last_successful_collection: null, new_evidence_awaiting_refresh: 0, stale_inputs: 0 },
      synthesis_health: { last_successful_synthesis: null, last_failure_reason: 'provider failed' },
      updated_at: '2026-09-21T00:00:00Z',
    }, error: null }) })
    const invokes: { name: string; body: Record<string, unknown> }[] = []
    c.functions = { async invoke(name, options) {
      invokes.push({ name, body: options.body })
      return { data: name === 'editorial-refresh'
        ? { refresh_id: 'rf-1', client_id: 'ivan', request_id: 'r1', status: 'running' }
        : { request_id: 'd1', client_id: 'ivan', brief_id: 'b1', brief_version: 2,
          artifact_id: null, state: 'blocked', blocked_reason: 'generation_router_not_deployed' }, error: null }
    } }
    const refresh = await requestSuggestionRefresh(c, 'ivan', 'dir-v1', 'r1')
    expect(refresh.refresh_id).toBe('rf-1')
    const state = await readSuggestionRefresh(c, 'ivan', 'rf-1')
    expect(state.last_usable_batch_id).toBe('old-batch')
    const draft = await requestDraft(c, 'ivan', 'b1', 2, 'a'.repeat(64), 'd1', 'post')
    expect(draft.state).toBe('blocked')
    expect(invokes.map(x => x.name)).toEqual(['editorial-refresh', 'editorial-draft'])
    expect(invokes[1].body).toMatchObject({ client_id: 'ivan', brief_id: 'b1', version: 2,
      expected_hash: 'a'.repeat(64), request_id: 'd1' })
  })
})

/* ------------------------------------------------------ registry guard */

describe('the client registry is the only source of scope', () => {
  it('accepts exactly the three registered lanes', () => {
    for (const lane of ['ivan', 'risedtc', 'arch']) {
      expect(assertRegisteredClient(lane)).toBe(lane)
    }
    for (const bad of ['IVAN', 'ivan ', 'Ivan', null, undefined, 1, {}, 'zz-selftest']) {
      expect(() => assertRegisteredClient(bad)).toThrow(EditorialContractError)
    }
  })
})
