// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { ContentLane } from './content'
// `./contentEvidence` imports `./supabase`, which throws at module load with
// no VITE_SUPABASE_URL in this test environment (the same reason every other
// lib test on this surface, e.g. proposals.test.ts, mocks this module before
// importing anything that touches it).
vi.mock('./supabase', () => ({ supabase: { rpc: () => Promise.resolve({ data: null, error: null }) } }))
import { fixturePack } from './contentEvidence.fixtures'
import {
  LOW_SAMPLE_BASELINE_N, buildInputs, buildResults, buildThisWeek, buildWinners,
  choiceStatusLabel, evidenceFixtureBypassActive, isLowSample, laneDisplayName, objectiveLabel,
  thisWeekWordCount,
  type ContentEvidencePack,
} from './contentEvidence'

const LANES: ContentLane[] = ['ivan', 'risedtc', 'arch']

// A bare-bones pack builder for the edge cases the shipped fixtures do not
// need to carry (unrecognized enum values, the exact empty/non-empty inputs
// boundary). Every field is present so a test only overrides what it tests.
function pack(over: Partial<ContentEvidencePack> = {}): ContentEvidencePack {
  return {
    schema_version: 1,
    client_id: 'ivan',
    week_start: '2026-09-28',
    freshness: { as_of: '2026-09-19T08:00:00Z', stale_after_days: 14, is_stale: false },
    this_week: { coverage_line: 'Coverage line.', candidates: [], missing_inputs: [] },
    winners: { market: [], own: [] },
    inputs: {
      study_state: 'validated', stored_posts: 100, eligible_posts: 100, eligible_authors: 10,
      publication_window: { from: '2025-01-01', to: '2026-01-01' }, last_successful_collection: '2026-09-19T00:00:00Z',
      connected_consumers: [], sufficient_for_this_question: true, sufficiency_reason: null, gaps: [],
    },
    results: { choices: [], prior_failures: [] },
    ...over,
  }
}

describe('content evidence, complete/sparse/zero/stale fixtures, all three clients', () => {
  for (const lane of LANES) {
    it(`${lane}: complete (ready) fixture reads ready on every view`, () => {
      const p = fixturePack(lane, 'ready')
      expect(buildThisWeek(p).state).toBe('ready')
      expect(buildWinners(p).state).toBe('ready')
      expect(buildInputs(p).state).toBe('ready')
      expect(buildResults(p).state).toBe('ready')
    })

    it(`${lane}: sparse (partial) fixture reads partial on every view`, () => {
      const p = fixturePack(lane, 'partial')
      expect(buildThisWeek(p).state).toBe('partial')
      expect(buildWinners(p).state).toBe('partial')
      expect(buildInputs(p).state).toBe('partial')
      expect(buildResults(p).state).toBe('partial')
    })

    it(`${lane}: zero fixture reads empty on every view, never failed`, () => {
      const p = fixturePack(lane, 'empty')
      expect(buildThisWeek(p).state).toBe('empty')
      expect(buildWinners(p).state).toBe('empty')
      expect(buildInputs(p).state).toBe('empty')
      expect(buildResults(p).state).toBe('empty')
    })

    it(`${lane}: stale fixture reads stale on every view even with full data`, () => {
      const p = fixturePack(lane, 'stale')
      expect(buildThisWeek(p).state).toBe('stale')
      expect(buildWinners(p).state).toBe('stale')
      expect(buildInputs(p).state).toBe('stale')
      expect(buildResults(p).state).toBe('stale')
      // stale still carries the full candidate/winner/choice rows: staleness
      // is a freshness fact, not a reason to hide what was last computed.
      expect(buildThisWeek(p).candidates.length).toBeGreaterThan(0)
      expect(buildWinners(p).market.length).toBeGreaterThan(0)
    })
  }
})

describe('failed is never empty', () => {
  it('a network failure yields state failed with a message, not an empty read', async () => {
    vi.resetModules()
    vi.doMock('./supabase', () => ({
      supabase: { rpc: () => Promise.resolve({ data: null, error: { message: 'connection refused' } }) },
    }))
    const mod = await import('./contentEvidence')
    const thisWeek = await mod.fetchThisWeek('ivan')
    const winners = await mod.fetchWinners('ivan')
    const inputs = await mod.fetchInputs('ivan')
    const results = await mod.fetchResults('ivan')
    for (const r of [thisWeek, winners, inputs, results]) {
      expect(r.state).toBe('failed')
      expect(r.state).not.toBe('empty')
      expect(r.message).toContain('connection refused')
    }
    vi.doUnmock('./supabase')
  })

  it('a payload the reader cannot use also fails rather than reading as empty', async () => {
    vi.resetModules()
    vi.doMock('./supabase', () => ({
      supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
    }))
    const mod = await import('./contentEvidence')
    const r = await mod.fetchThisWeek('ivan')
    expect(r.state).toBe('failed')
    expect(r.message).toBeTruthy()
    vi.doUnmock('./supabase')
  })
})

// MUST-FIX 1 (Phase-2 review): before this fix, `readPack` had no try/catch
// and the four `EvidenceBlock` hooks called `.then(...)` with no `.catch`.
// A REJECTING rpc call (not a returned `{error}`, an actual thrown/rejected
// promise) propagated straight through the `await` chain: `fetchThisWeek`
// etc. returned a rejected promise instead of resolving to `{state:
// 'failed', ...}`, and in the real component that left `view` at `null`
// forever — a spinner with no failure path. These two tests are the
// red-first proof: run against the pre-fix `readPack` (no try/catch) they
// throw out of the `await mod.fetchThisWeek(...)` call below instead of
// resolving, which fails the test with an uncaught rejection rather than a
// clean assertion failure — that IS the bug, reproduced. Against the fixed
// `readPack` (this file, wrapped in try/catch) both resolve to
// `state: 'failed'`.
describe('a rejected/thrown read fails, it never hangs (must-fix 1)', () => {
  it('a rejecting (not just erroring) rpc call yields state failed on all four reads', async () => {
    vi.resetModules()
    vi.doMock('./supabase', () => ({
      supabase: { rpc: () => Promise.reject(new Error('boom')) },
    }))
    const mod = await import('./contentEvidence')
    const thisWeek = await mod.fetchThisWeek('ivan')
    const winners = await mod.fetchWinners('ivan')
    const inputs = await mod.fetchInputs('ivan')
    const results = await mod.fetchResults('ivan')
    for (const r of [thisWeek, winners, inputs, results]) {
      expect(r.state).toBe('failed')
      expect(r.message).toContain('boom')
    }
    vi.doUnmock('./supabase')
  })

  it('a failed dynamic import of the fixture chunk also yields state failed, not a hang', async () => {
    vi.resetModules()
    vi.doMock('./contentEvidence.fixtures', () => {
      throw new Error('fixture chunk failed to load')
    })
    const mod = await import('./contentEvidence')
    // Routes through the DEV fixture branch: vitest's own `import.meta.env.DEV`
    // is true by default, and this file already runs under jsdom-compatible
    // globals, so `window` exists.
    window.history.pushState(null, '', '/?evidenceFixture=ready')
    const r = await mod.fetchThisWeek('ivan')
    expect(r.state).toBe('failed')
    window.history.pushState(null, '', '/')
    vi.doUnmock('./contentEvidence.fixtures')
  })
})

describe('the W5 login-gate bypass is DEV-only (must-fix 2)', () => {
  it('never activates when isDev is false, regardless of the query string', () => {
    expect(evidenceFixtureBypassActive(false, '?evidenceFixture=ready')).toBe(false)
    expect(evidenceFixtureBypassActive(false, '?evidenceFixture=failed')).toBe(false)
    expect(evidenceFixtureBypassActive(false, '')).toBe(false)
  })

  it('activates only for a recognized fixture state when isDev is true', () => {
    for (const state of ['ready', 'partial', 'empty', 'stale', 'failed']) {
      expect(evidenceFixtureBypassActive(true, `?evidenceFixture=${state}`)).toBe(true)
    }
    expect(evidenceFixtureBypassActive(true, '?evidenceFixture=bogus')).toBe(false)
    expect(evidenceFixtureBypassActive(true, '')).toBe(false)
  })
})

describe('client ids are never printed raw on screen (must-fix 3)', () => {
  it('maps every registered lane to its LANE_LABEL display name', () => {
    expect(laneDisplayName('ivan')).toBe('Ivan')
    expect(laneDisplayName('risedtc')).toBe('Mattan Danino')
    expect(laneDisplayName('arch')).toBe('Davorin Smit')
  })

  it('falls back to the raw id for an unknown lane rather than throwing', () => {
    expect(laneDisplayName('some-future-lane')).toBe('some-future-lane')
  })
})

describe('low-sample and legacy rows are retained and labeled, never dropped', () => {
  it('a market finding below the baseline_n floor is flagged, not silently ranked as normal', () => {
    const p = fixturePack('ivan', 'partial')
    const [row] = buildWinners(p).market
    expect(row.baseline_n).toBeLessThan(LOW_SAMPLE_BASELINE_N)
    expect(isLowSample(row.baseline_n)).toBe(true)
    expect(row.legacy).toBe(true)
  })

  it('isLowSample is null-safe and only flags a real numeric baseline under the floor', () => {
    expect(isLowSample(null)).toBe(false)
    expect(isLowSample(19)).toBe(true)
    expect(isLowSample(20)).toBe(false)
    expect(isLowSample(25)).toBe(false)
  })

  it('a legacy-method row is still returned by the pure builder, not filtered out', () => {
    const p = fixturePack('ivan', 'ready')
    const legacyRows = buildWinners(p).market.filter(w => w.legacy)
    expect(legacyRows.length).toBeGreaterThan(0)
  })
})

describe('client controls never enter the market population', () => {
  it('own-account rows and market rows are disjoint arrays with disjoint ids', () => {
    for (const lane of LANES) {
      const p = fixturePack(lane, 'ready')
      const w = buildWinners(p)
      const marketIds = new Set(w.market.map(m => m.finding_id))
      const ownIds = new Set(w.own.map(o => o.post_id))
      for (const id of ownIds) expect(marketIds.has(id)).toBe(false)
      // An own row carries no baseline/lift fields at all, so it structurally
      // cannot be rendered beside a market lift as if it were a source find.
      for (const o of w.own) expect((o as unknown as { lift?: unknown }).lift).toBeUndefined()
    }
  })
})

describe('unknown vocabulary renders a plain line, never raw JSON off the wire', () => {
  it('an objective this reader does not recognize becomes "Unrecognized item"', () => {
    expect(objectiveLabel('attention')).not.toBe('Unrecognized item')
    expect(objectiveLabel('some_future_objective_v9')).toBe('Unrecognized item')
    expect(objectiveLabel(null)).not.toBe('Unrecognized item')
  })

  it('a choice status this reader does not recognize becomes "Unrecognized item"', () => {
    expect(choiceStatusLabel('evaluated')).not.toBe('Unrecognized item')
    expect(choiceStatusLabel('some_future_status')).toBe('Unrecognized item')
    expect(choiceStatusLabel(undefined)).toBe('Unrecognized item')
  })
})

describe('the ARCH minimal-coverage shape: stored posts with no validated study', () => {
  it('is a coverage gap (partial), not an empty lane, matching the plan InputsPanel fixture', () => {
    const p = pack({
      client_id: 'arch',
      inputs: {
        study_state: 'missing', stored_posts: 439, eligible_posts: null, eligible_authors: null,
        publication_window: null, last_successful_collection: null, connected_consumers: [],
        sufficient_for_this_question: false, sufficiency_reason: null,
        gaps: ['Author baselines have not been reviewed.'],
      },
    })
    const view = buildInputs(p)
    expect(view.state).toBe('partial')
    expect(view.storedPosts).toBe(439)
    expect(view.studyState).toBe('missing')
    expect(view.gaps).toContain('Author baselines have not been reviewed.')
  })

  it('truly zero stored posts and a missing study reads empty', () => {
    const p = pack({
      inputs: {
        study_state: 'missing', stored_posts: null, eligible_posts: null, eligible_authors: null,
        publication_window: null, last_successful_collection: null, connected_consumers: [],
        sufficient_for_this_question: false, sufficiency_reason: null, gaps: [],
      },
    })
    expect(buildInputs(p).state).toBe('empty')
  })
})

describe('word count on the default This week fixture', () => {
  it('stays at or under 300 visible words on the ready fixture, every client', () => {
    for (const lane of LANES) {
      const n = thisWeekWordCount(buildThisWeek(fixturePack(lane, 'ready')))
      expect(n).toBeLessThanOrEqual(300)
    }
  })
})

describe('coverage line and gaps never surface an internal codename', () => {
  it('no visible copy contains "schema_version" or "evidence_package"', () => {
    for (const lane of LANES) {
      for (const scenario of ['ready', 'partial', 'empty', 'stale'] as const) {
        const p = fixturePack(lane, scenario)
        const tw = buildThisWeek(p)
        const blob = [tw.coverageLine, ...tw.missingInputs, ...tw.candidates.map(c => c.topic)].join(' ')
        expect(blob).not.toContain('schema_version')
        expect(blob).not.toContain('evidence_package')
      }
    }
  })
})
