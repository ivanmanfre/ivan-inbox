import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SynthesisHistoryRow } from './editorialSynthesis'
import { assertWeekCohort, buildSynthesisBriefs } from './editorialSynthesis'

/** Seven real prior failures, each reproduced as its own negative control, plus one
 * fully grounded direction that must still pass. Every fixture below is synthetic
 * text shaped like the actual defect; no client body is copied into the suite. */

const REQUESTED_AT = '2026-09-21T20:00:00Z'
const DIRECTION_TEXT = JSON.stringify({ client_id: 'risedtc', active_version: 'a2-local-risedtc-v1',
  direction: { audience: 'DTC brand owners spending on paid social',
    priorities: ['Show the pre-scale diagnostic work', 'Name the order of operations'] } })

const ownPost = {
  source_id: 'own:rise-checklist', seen_version: 1, source_kind: 'own_post',
  source_client_scope: 'risedtc', source_url: 'https://example.invalid/posts/checklist',
  excerpt_pointer: null, owner: 'Mattan Danino',
  source_published_at: '2026-09-17T00:00:00Z', captured_at: '2026-09-20T00:00:00Z',
  body_sha256: 'a'.repeat(64),
  passage: 'Most owners ask me to scale ads before the offer converts. I wrote down the eight checks I run on a store before I will touch an ad account, and the order I run them in, since the order is what protects the budget.',
  retained_context: 'observed_metrics: impressions=238 reactions=0 comments=1',
  limitation: 'Own post. Impressions are not unique readers.',
  independent: false, derived_from: null, permission_state: 'granted', gap_state: null,
  candidate_fields: { observed_metrics: { impressions: 238, comments: 1 }, body_state: 'full',
    contract: { supports_causality: false, supports_commercial_outcome: false } },
}

const grounded = {
  source_ids: [ownPost.source_id],
  topic: 'Order of operations before an ad account gets touched',
  angle: 'Walk through the sequence of store checks that precede any budget decision',
  hook: 'Eight checks run in a fixed order before an ad account is opened.',
  format: 'text',
  objective: 'Give owners a repeatable pre-scale sequence they can run themselves',
  intended_audience: 'DTC brand owners spending on paid social',
  why_now: 'The dated 2026-09-17 post recorded the checklist without its ordering rationale',
  structural_beats: ['Name the sequence', 'Explain why order matters', 'Close on the first two checks'],
  missing_material: [],
  tone: 'Direct and operational',
  overlap_with_existing_content: 'Shares the checklist subject with the dated 2026-09-17 post',
  novelty_reason: 'Supplies the ordering rationale the earlier post left out; historical feed overlap beyond the supplied set is unknown',
  direction_alignment: 'Matches the recorded priority to name the order of operations for the paid-social owner audience',
  direction_quote: 'Name the order of operations',
  recent_duplicate: true,
  followup_difference: 'The earlier post listed the checks; this one supplies only the ordering rationale and stops at the first two checks',
  causal_claims: [],
  commercial_claims: [],
  excluded_alternatives: [],
  positive_precedent_native_ids: ['native:published-checklist'],
  claims: [{ source_id: ownPost.source_id,
    supporting_quote: 'the order is what protects the budget',
    statement: 'The author records that the order of the checks is what protects the budget',
    allowed_phrasing: 'On 2026-09-17 the author wrote that the order of the checks protects the budget',
    prohibited_inference: 'Do not state that any brand achieved a budget saving',
    status: 'interpretation' }],
  measurements: [{ source_id: ownPost.source_id, metric_name: 'impressions', observed_value: 238,
    formula: 'raw platform impressions count for one exact own post',
    denominator: 'one exact own post', comparison_population: 'No comparable population supplied',
    observation_window: 'captured 2026-09-20; published 2026-09-17; window start unknown',
    comparison_method_version: '', unknowns: ['unique readers', 'audience composition'] }],
  resource: { asset_id: '', version: '', artifact_role: '', readiness: 'not_needed',
    access_route: '', permission_basis: '', required_missing_material: [],
    draft_state: '', public_catalog_state: '' },
  distribution: { channel: 'linkedin', cta: 'No CTA proposed', route: 'ungated', fulfillment_requirements: [] },
  production: { structure: 'Short ordered list with a closing note', required_materials: [],
    critical_constraints: ['Keep every beat inside the dated passage'], effort_category: 'low' },
  evaluation: { primary_metric: 'impressions', secondary_metrics: ['comments'],
    comparator: 'unknown', window: '7 days after publication',
    earliest_valid_observation: '2026-09-29T00:00:00Z',
    event_source_availability: 'client_post_metrics refresh', attribution_limitations: 'No post-level conversion identity exists' },
}

const history: SynthesisHistoryRow[] = [
  { native_id: 'native:published-checklist', role: 'published', status: 'published',
    published_at: '2026-09-17T00:00:00Z', created_at: '2026-09-16T00:00:00Z', qa_failed: false, is_test: false,
    topic_text: 'Eight checks before hiring an agency in 2026 order of operations ad account' },
  { native_id: 'native:review-draft', role: 'duplicate_only', status: 'review',
    published_at: null, created_at: '2026-09-19T00:00:00Z', qa_failed: false, is_test: false,
    topic_text: 'Small US budget about three creators two year unsolved distribution problem' },
  { native_id: 'native:failed-test', role: 'negative_only', status: 'review',
    published_at: null, created_at: '2026-09-18T00:00:00Z', qa_failed: true, is_test: true,
    topic_text: 'Rebooking creators every thirty days keeps performance from decaying' },
]

const decisions = [
  { decision_id: 'dec-piece-1', scope: 'piece', action: 'reject', target_kind: 'brief', target_id: 'brief-risedtc-x' },
  { decision_id: 'dec-topic-1', scope: 'topic', action: 'reject', target_kind: 'topic', target_id: 'giveaways' },
]

const base = { clientId: 'risedtc' as const, batchId: 'b1-fixture', directionVersion: 'a2-local-risedtc-v1',
  sourceCutoff: '2026-09-21T00:00:00Z', requestedAt: REQUESTED_AT, directionText: DIRECTION_TEXT,
  history, decisions }

const run = (sources: unknown[], suggestions: unknown[], extra: Record<string, unknown> = {}) =>
  buildSynthesisBriefs({ ...base, sources: sources as never, suggestions: suggestions as never, ...extra })

describe('grounded direction still passes every semantic check', () => {
  it('accepts a complete, source-supported, future-dated, disclosed-duplicate direction', async () => {
    const briefs = await run([ownPost], [grounded])

    expect(briefs).toHaveLength(1)
    expect(briefs[0].claim_ledger[0].statement).toContain('order of the checks')
    expect(briefs[0].measurements[0].observed_value).toBe(238)
  })
})

describe('prior real failure 1: 37-character unadaptable source', () => {
  it('refuses a complete direction built only on a source too short to adapt', async () => {
    const tiny = { ...ownPost, source_id: 'own:rise-tiny',
      passage: 'Agencies keep missing the first week.', retained_context: '',
      candidate_fields: { ...ownPost.candidate_fields, observed_metrics: {} } }
    const suggestion = { ...grounded, source_ids: [tiny.source_id], measurements: [],
      claims: [{ ...grounded.claims[0], source_id: tiny.source_id,
        supporting_quote: 'Agencies keep missing the first week.',
        statement: 'The author records that agencies miss the first week' }] }

    await expect(run([tiny], [suggestion])).rejects.toThrow(/cannot support a complete direction/)
  })
})

describe('prior real failure 2: invented resource / comment gate', () => {
  it('refuses a gated route with no verified catalog asset', async () => {
    const suggestion = { ...grounded,
      distribution: { ...grounded.distribution, route: 'gated', cta: 'Comment CHECKS and I will send the list' } }

    await expect(run([ownPost], [suggestion])).rejects.toThrow(/gated|verified/i)
  })

  it('refuses an asset identity that is not in the inspected catalog', async () => {
    const suggestion = { ...grounded, format: 'lm_promo',
      resource: { asset_id: 'invented-asset', version: '1', artifact_role: 'lead magnet',
        readiness: 'ready', access_route: '/invented', permission_basis: 'client-owned catalog',
        required_missing_material: [], draft_state: 'published', public_catalog_state: 'published' } }

    await expect(run([ownPost], [suggestion], { assets: [] })).rejects.toThrow(/resource identity\/readiness is not verified/)
  })
})

describe('prior real failure 3: wrong-source ARCH quotation', () => {
  it('refuses a rebooking quote attributed to the early-CTA timing source', async () => {
    const earlyCta = { ...ownPost, source_id: 'client_ideas:early-cta', source_client_scope: 'arch',
      passage: 'Put the call to action in the first fifteen seconds. The early CTA placement is the only thing the edit test changed, and the account only ran that single edit variant against the original cut for one week before the review.',
      retained_context: '', candidate_fields: { body_state: 'full', observed_metrics: {} } }
    const suggestion = { ...grounded, source_ids: [earlyCta.source_id], measurements: [],
      claims: [{ ...grounded.claims[0], source_id: earlyCta.source_id,
        supporting_quote: 'rebooking the same creators every thirty days',
        statement: 'The source records a thirty-day creator rebooking cadence' }] }

    await expect(buildSynthesisBriefs({ ...base, clientId: 'arch', sources: [earlyCta] as never,
      suggestions: [suggestion] as never })).rejects.toThrow(/exact retained supporting quote/)
  })
})

describe('prior real failure 4: stale evaluation date', () => {
  it('refuses an evaluation date at or before the refresh request time', async () => {
    const suggestion = { ...grounded,
      evaluation: { ...grounded.evaluation, earliest_valid_observation: '2026-09-15T00:00:00Z' } }

    await expect(run([ownPost], [suggestion])).rejects.toThrow(/evaluation date/i)
  })
})

describe('prior real failure 5: copied recent own topic', () => {
  it('refuses an undeclared repeat of a recent own post', async () => {
    const suggestion = { ...grounded, recent_duplicate: false, followup_difference: '' }

    await expect(run([ownPost], [suggestion])).rejects.toThrow(/repeats recent content/)
  })

  it('counts an unpublished ordinary draft for duplication without calling it published', async () => {
    const suggestion = { ...grounded, recent_duplicate: false, followup_difference: '',
      topic: 'Small US budget with about three creators',
      angle: 'Why the two year unsolved distribution problem persists',
      structural_beats: ['Small US budget', 'About three creators', 'Two year unsolved distribution'] }

    await expect(run([ownPost], [suggestion])).rejects.toThrow(/native:review-draft/)
  })

  it('refuses a failed internal test row used as positive voice precedent', async () => {
    const suggestion = { ...grounded, positive_precedent_native_ids: ['native:failed-test'] }

    await expect(run([ownPost], [suggestion])).rejects.toThrow(/negative_only|failed/i)
  })
})

describe('prior real failure 6: client-brief text mistaken for proof', () => {
  it('refuses a generated brief as the original proof for its own claim', async () => {
    const brief = { ...ownPost, source_id: 'brief:arch-w40-02', source_kind: 'brief',
      derived_from: 'brief-arch-w40-02', owner: 'editorial synthesis',
      passage: 'Key insight: store distribution is the live constraint and the current creator motion is already funded across the roster this quarter.',
      retained_context: '', candidate_fields: { body_state: 'full', observed_metrics: {} } }
    const suggestion = { ...grounded, source_ids: [brief.source_id], measurements: [],
      claims: [{ ...grounded.claims[0], source_id: brief.source_id, status: 'fact',
        supporting_quote: 'store distribution is the live constraint',
        statement: 'Store distribution is the live constraint' }] }

    await expect(run([brief], [suggestion])).rejects.toThrow(/not original proof/)
  })
})

describe('prior real failure 7: topic ban inferred from one rejection', () => {
  it('refuses a topic-wide exclusion justified by a piece-scoped rejection', async () => {
    const suggestion = { ...grounded,
      excluded_alternatives: [{ topic: 'creator rebooking cadence', basis_decision_id: 'dec-piece-1' }] }

    await expect(run([ownPost], [suggestion])).rejects.toThrow(/rejection of one execution/)
  })

  it('accepts a topic exclusion that cites an actual topic-scoped decision', async () => {
    const suggestion = { ...grounded,
      excluded_alternatives: [{ topic: 'giveaways', basis_decision_id: 'dec-topic-1' }] }

    await expect(run([ownPost], [suggestion])).resolves.toHaveLength(1)
  })
})

describe('causal and commercial claims need a supporting source contract', () => {
  it('refuses undeclared causal language in public-facing text', async () => {
    const suggestion = { ...grounded,
      hook: 'Running the checks in order is what caused the budget to stop leaking.' }

    await expect(run([ownPost], [suggestion])).rejects.toThrow(/causal/i)
  })

  it('refuses a declared causal claim whose source contract does not support causality', async () => {
    const suggestion = { ...grounded,
      hook: 'Running the checks in order is what caused the budget to stop leaking.',
      causal_claims: [{ statement: 'Running the checks in order is what caused the budget to stop leaking.',
        source_id: ownPost.source_id, support_basis: 'the author said so' }] }

    await expect(run([ownPost], [suggestion])).rejects.toThrow(/causal/i)
  })

  it('refuses an undeclared commercial outcome claim', async () => {
    const suggestion = { ...grounded,
      structural_beats: [...grounded.structural_beats, 'The sequence adds revenue for every store that runs it'] }

    await expect(run([ownPost], [suggestion])).rejects.toThrow(/commercial/i)
  })

  it('accepts a causal claim backed by a source contract that supports causality', async () => {
    const supported = { ...ownPost, candidate_fields: { ...ownPost.candidate_fields,
      contract: { supports_causality: true, supports_commercial_outcome: false } } }
    const suggestion = { ...grounded,
      hook: 'Running the checks in order is what caused the budget to stop leaking.',
      causal_claims: [{ statement: 'Running the checks in order is what caused the budget to stop leaking.',
        source_id: ownPost.source_id, support_basis: 'the retained source contract records a controlled comparison' }] }

    await expect(run([supported], [suggestion])).resolves.toHaveLength(1)
  })
})

describe('five-slot week cohort without padding', () => {
  it('refuses fewer than five directions with no acquisition or material task', () => {
    expect(() => assertWeekCohort([grounded, grounded, grounded] as never, undefined))
      .toThrow(/acquisition/i)
  })

  it('accepts fewer than five directions with an explicit acquisition task', () => {
    expect(() => assertWeekCohort([grounded] as never, { client_reason: 'Only one adaptable own post inside the shortlist',
      missing_material: ['Two additional dated own posts with retained bodies'],
      proposed_acquisition: 'Re-run the own-post collector across the full 90-day window' })).not.toThrow()
  })

  it('refuses more than five directions for a five-slot week', () => {
    expect(() => assertWeekCohort(Array.from({ length: 6 }, () => grounded) as never, undefined))
      .toThrow(/five/i)
  })
})

describe('the deployed refresh adapter actually supplies the semantic context', () => {
  const edge = readFileSync('supabase/functions/editorial-refresh/index.ts', 'utf8')

  it('passes request time, direction text, history and decisions into the validator', () => {
    const call = edge.slice(edge.indexOf('buildSynthesisBriefs({'))
    for (const field of ['requestedAt', 'directionText', 'history', 'decisions']) {
      expect(call.slice(0, 900)).toContain(field)
    }
  })

  it('requests up to five directions on prompt version v6 and never says exactly three', () => {
    expect(edge).toContain("const promptVersion = 'editorial-synthesis-v6'")
    expect(edge).not.toMatch(/exactly (three|3) (complete )?directions/i)
    expect(edge).not.toMatch(/suggestions array of 3 to 5/)
    expect(edge).toMatch(/up to five/i)
    expect(edge).toMatch(/acquisition/i)
  })

  it('renders the per-source gap reason and the population coverage into the request', () => {
    expect(edge).toContain('gap_reason: x.gap_reason')
    expect(edge).toContain('population:')
  })
})

// The first real local ARCH reply lost all five proposals to undeclared causal and
// commercial wording. No retained source carries a causality or commercial contract, so
// the only correct repair is a descriptive rewrite; the prompt has to say that plainly.
describe('the request states the causal and commercial disclosure duty', () => {
  const edge = readFileSync('supabase/functions/editorial-refresh/index.ts', 'utf8')

  it('names the declaration arrays, the contract field and the rewrite remedy', () => {
    expect(edge).toMatch(/MUST be listed in causal_claims or commercial_claims/)
    expect(edge).toMatch(/candidate_fields\.contract records supports_causality or supports_commercial_outcome/)
    expect(edge).toMatch(/REWRITE the sentence descriptively/)
    expect(edge).toMatch(/rejects the entire batch/)
  })

  it('keeps every boundary sentence the prompt already carried', () => {
    for (const boundary of [
      'The client voice/positioning text is not research evidence.',
      'Own outcomes are observations, not causal proof.',
      'No invented numbers, permission, deliverables or audience approval.',
      'Never put private call names, titles or participants into public-facing topic',
    ]) expect(edge).toContain(boundary)
  })
})

// A 180k-character request plus a 26-33k reply exceeds the intact 200k hard guard, so the
// in-request correction attempt cannot always be dispatched. The defects must therefore
// survive into the next outer request instead of dying with the rejected batch.
describe('a rejected batch carries its exact defects forward', () => {
  const edge = readFileSync('supabase/functions/editorial-refresh/index.ts', 'utf8')

  it('persists every attempt defect on the failed trace', () => {
    expect(edge).toContain("defects: synthesisAttempts.map(a => a.validation_error).filter(Boolean)")
  })

  it('reads this client\'s own most recent failed trace and renders only defect text', () => {
    expect(edge).toContain("from('editorial_synthesis_traces')")
    expect(edge).toContain('const priorDefects =')
    expect(edge).toContain('PRIOR ATTEMPT DEFECTS')
    expect(edge).toMatch(/fix each one and keep every other proposal/)
    // The prior reply itself is never re-sent: only validation defect strings travel.
    expect(edge).not.toMatch(/priorTrace[\s\S]{0,400}raw_response/)
  })

  it('omits the block entirely when there is no prior defect', () => {
    expect(edge).toContain("${priorDefects.length ? `")
  })
})

// ARCH's final local reply lost two otherwise-checkable proposals to
// `source.captured_at.slice is not a function`: the local driver hands back Date objects
// where PostgREST hands back ISO strings. A crash is not a judgement.
describe('timestamps judge the same whether they arrive as strings or Date objects', () => {
  const asDates = {
    ...ownPost,
    captured_at: new Date('2026-09-20T00:00:00Z') as unknown as string,
    source_published_at: new Date('2026-09-17T00:00:00Z') as unknown as string,
  }

  it('accepts the grounded direction when every timestamp is a Date', async () => {
    const briefs = await run([asDates], [grounded], { sourceCutoff: new Date('2026-09-21T00:00:00Z') })

    expect(briefs).toHaveLength(1)
    expect(briefs[0].evidence[0].captured_date).toBe('2026-09-20T00:00:00.000Z')
    expect(briefs[0].evidence[0].currency_state).toBe('current')
  })

  it('still rejects a metric whose window omits the capture date, with Date inputs', async () => {
    const suggestion = { ...grounded, measurements: [{ ...grounded.measurements[0],
      observation_window: 'captured some time last week; window start unknown' }] }

    await expect(run([asDates], [suggestion])).rejects.toThrow(/exact capture date/)
  })
})

// RISE's second local reply cited three derived candidate rows as proof. derived_from is
// set on candidate rows and nowhere else in the retained population, so the rule is exact
// — but the request has to say so, and show which rows are derived.
describe('derived candidate rows are visible and named as unusable proof', () => {
  const edge = readFileSync('supabase/functions/editorial-refresh/index.ts', 'utf8')

  it('supplies derived_from on every rendered source', () => {
    expect(edge).toContain('derived_from: x.derived_from ?? null')
  })

  it('tells the model a derived summary can never be the cited source', () => {
    expect(edge).toMatch(/derived_from is not null \(kind=candidate\)/)
    expect(edge).toMatch(/never be the cited source for any claim/)
  })
})

// Option A, shipped: the compact correction turn must carry the VALIDATOR'S INPUTS, not
// only the error strings. buildSynthesisBriefs never reads the message thread or a
// canonical prompt body, so dropping the canon from the correction turn cannot weaken any
// check — but everything the validator does read has to be in there.
describe('the compact correction turn carries every validator input', () => {
  const edge = readFileSync('supabase/functions/editorial-refresh/index.ts', 'utf8')
  const lib = readFileSync('src/lib/editorialSynthesis.ts', 'utf8')
  const correction = edge.slice(edge.indexOf('const buildCorrection ='), edge.indexOf('const synthesized = await runSynthesis'))

  it('the validator never reads the thread or a canonical body', () => {
    for (const leak of ['canonicalPromptBodies', 'messages', 'relevantPrompts', 'content_prompts']) {
      expect(lib).not.toContain(leak)
    }
  })

  it('carries the output contract, schema, metric records, rejected JSON and exact errors', () => {
    expect(correction).toContain('${OUTPUT_CONTRACT}')
    expect(correction).toContain('YOUR REJECTED JSON (verbatim):\\n${raw}')
    expect(correction).toContain('${directive}')
    expect(correction).toContain('${FINAL_BOUNDARY}')
    expect(edge).toMatch(/correctionContext: `Allowed measurement records:/)
  })

  it('carries the request time, direction, decisions, history roles and assets', () => {
    for (const input of ['${requestedAt}', '${directionText}', 'JSON.stringify(decisions)',
      'JSON.stringify(historyForPrompt.rows)', 'JSON.stringify(assets)']) {
      expect(correction).toContain(input)
    }
  })

  it('supplies only the sources the rejected proposals actually cite, and never drops to none', () => {
    expect(correction).toContain('SOURCES CITED BY YOUR REJECTED PROPOSALS')
    expect(correction).toContain('cited.size ? selected.filter(x => cited.has(String(x.source_id))) : selected')
    expect(correction).toContain('passage: x.passage')
    expect(correction).toContain('candidate_fields: x.candidate_fields')
  })

  it('drops the canonical bodies from the correction turn only, and says they still bind', () => {
    expect(correction).not.toContain('canonicalPromptBodies')
    expect(correction).toContain('still bind and are unchanged, they are simply not repeated here')
    // The initial request keeps them verbatim.
    expect(edge).toContain('CANONICAL AUTHOR VOICE AND LANGUAGE RULES')
    expect(edge).toContain('${canonicalPromptBodies}')
  })
})

// Ivan's standing rule: gates are reasoned, never keyword lists. The routing patterns
// now only decide what gets examined. Every verdict below comes from the relation between
// the assertion and the cited source, the inspected catalog or the proposal's own
// declaration. All four false positives are the reviewer's, reproduced from the retained
// Run5 replies; all three rejections are the failures that must keep holding.
describe('a routed construction is judged, never rejected for appearing', () => {
  // A neutral retained context, so every fixture clears the adaptability floor without
  // adding a single routed construction of its own.
  const CONTEXT = 'observed_metrics: impressions=238 reactions=0 comments=1; captured from the retained snapshot on the date recorded above'
  const withPassage = (passage: string, extra: Record<string, unknown> = {}) =>
    ({ ...ownPost, source_id: 'own:routed', passage, retained_context: CONTEXT, ...extra })
  const oneClaim = (source: Record<string, unknown>, over: Record<string, unknown>) => ({
    ...grounded, source_ids: [source.source_id], measurements: [],
    claims: [{ ...grounded.claims[0], source_id: source.source_id,
      supporting_quote: String(source.passage).slice(0, 40) }], ...over })

  it('clears "booked" when the cited source records the booking', async () => {
    const source = withPassage('Davorin described a creator booked for one brief and then graded on a different metric a week later, which is the mismatch he keeps hitting when a campaign is set up in a hurry.')
    const suggestion = oneClaim(source, { hook: 'The creator was booked for one brief and graded on another.' })

    await expect(run([source], [suggestion])).resolves.toHaveLength(1)
  })

  it('clears "Deal" inside an inspected asset name', async () => {
    const source = withPassage('The internal worksheet takes a creator fee and a target cost per install and returns the maximum installs the booking would have to produce, all in the browser with nothing submitted.')
    const suggestion = oneClaim(source, { hook: 'Point readers at the Creator Deal Check worksheet.' })
    const assets = [{ id: 'asset-1', version: '1', access_route: '/tools/creator-deal-check',
      permission_basis: 'client-owned catalog', status: 'ready', slug: 'creator-deal-check' }]

    await expect(run([source], [suggestion], { assets })).resolves.toHaveLength(1)
  })

  it('clears "because" when it sits inside reported speech the source records', async () => {
    const source = withPassage('He told the content managers never to show the QR code in the first fifteen seconds, because showing it immediately reads as an ad and viewers skip straight past the integration.')
    const suggestion = oneClaim(source, { hook: 'He holds the QR code back, because showing it immediately reads as an ad.' })

    await expect(run([source], [suggestion])).resolves.toHaveLength(1)
  })

  it('clears "prove" when the source uses it', async () => {
    const source = withPassage('You do not have to write like a seven-year-old just to prove a post was not written by a machine; the argument in the post is about tells, not about quality.')
    const suggestion = oneClaim(source, { topic: 'Whether avoiding every AI-writing tell is necessary to prove a post was not AI-written' })

    await expect(run([source], [suggestion])).resolves.toHaveLength(1)
  })

  it('a routed construction with no source, asset or declaration behind it is refused', async () => {
    const source = withPassage('Three videos a month with one creator is the pace we settled on for the rest of the quarter, written down on the call so the managers have one number to work from.')
    const suggestion = oneClaim(source, { hook: 'Running one creator too often burns out the audience, which is why the pace was capped.' })

    await expect(run([source], [suggestion])).rejects.toThrow(/no cited source records, no inspected asset names, and no declaration covers/)
  })

  it('a declared commercial claim with no supporting source contract is refused', async () => {
    const source = withPassage('She cannot trace a single click from the ad account into the marketplace, so she turns the channel off for a week and reads the difference by hand each morning.')
    const suggestion = oneClaim(source, {
      hook: 'Turning the channel off is how she reads the sales it was carrying.',
      commercial_claims: [{ statement: 'Turning the channel off is how she reads the sales it was carrying.',
        source_id: source.source_id, support_basis: 'she said so on the call' }] })

    await expect(run([source], [suggestion])).rejects.toThrow(/source contract records no commercial outcome/)
  })

  it('a statement that exceeds its own declared allowed_phrasing is refused', async () => {
    const source = withPassage('The post recorded two hundred and thirty eight impressions and one comment on the day it was captured, with no other engagement noted anywhere in the record.')
    const suggestion = oneClaim(source, {
      claims: [{ ...grounded.claims[0], source_id: source.source_id, status: 'interpretation',
        supporting_quote: 'two hundred and thirty eight impressions',
        statement: 'The checklist format drove the impressions the post recorded',
        allowed_phrasing: 'On the capture date the post recorded two hundred and thirty eight impressions',
        prohibited_inference: 'Do not attribute the count to the format' }] })

    await expect(run([source], [suggestion])).rejects.toThrow(/its own declared allowed_phrasing does not carry/)
  })

  it('accepts an interpretation the proposal scoped in its own allowed_phrasing', async () => {
    const source = withPassage('The post recorded two hundred and thirty eight impressions and one comment on the capture date, and nothing in the record says why any of it happened the way it did.')
    const suggestion = oneClaim(source, {
      hook: 'One reading: the ordering, so that a reader can run it, is what the post was actually for.',
      claims: [{ ...grounded.claims[0], source_id: source.source_id, status: 'hypothesis',
        supporting_quote: 'two hundred and thirty eight impressions',
        statement: 'One reading of the record',
        allowed_phrasing: 'One reading: the ordering, so that a reader can run it, is what the post was actually for',
        prohibited_inference: 'Do not present this reading as something the source records' }] })

    await expect(run([source], [suggestion])).resolves.toHaveLength(1)
  })
})
