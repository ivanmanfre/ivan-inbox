import { describe, expect, it } from 'vitest'
import { brief, evidence } from './editorialBriefs.fixtures'
import { assertEnvelopeAtStage, assertNativeCompletionReadback, assessProviderCallBudget, attachEnvelope, buildGenerationEnvelope, buildTransportQaAssessment, classifyHistoryRole, evaluateRegisterFloors, GenerationBlocked, projectNativeColumns, serializeFinalCopy, validateFinalQaAcceptance } from './editorialGeneration'
import { createHash } from 'node:crypto'

const make = (over = {}) => {
  const b = brief(over)
  return buildGenerationEnvelope({ brief: b, clientId: 'ivan', expectedHash: b.identity.content_hash,
    artifactRole: 'post', requestId: 'test-request' })
}

describe('editorial generation boundary', () => {
  it('carries exact brief, source, claim and prior context into every stage', () => {
    const envelope = make()
    const legacy = { competitor_context: 'retained', call_passages: ['retained passage'] }
    const item = attachEnvelope(legacy, envelope)
    expect(item.competitor_context).toBe('retained')
    expect(item.call_passages).toEqual(['retained passage'])
    expect(assertEnvelopeAtStage(item, envelope)).toBe(envelope)
    expect(envelope.source_ids).toEqual(['urn:fixture:source:1'])
    expect(envelope.permitted_claim_ids).toEqual(['cl-01'])
    expect(() => assertEnvelopeAtStage({ ...item, editorial_generation: { ...envelope, brief_hash: 'wrong' } }, envelope))
      .toThrow(new GenerationBlocked('brief_lineage_lost'))
  })

  it('blocks wrong tenant, missing permission and unsupported promotion', () => {
    const b = brief()
    expect(() => buildGenerationEnvelope({ brief: b, clientId: 'arch', expectedHash: b.identity.content_hash,
      artifactRole: 'post', requestId: 'x' })).toThrow(new GenerationBlocked('wrong_client'))
    expect(() => make({ evidence: [evidence({ permission_state: 'denied' })] }))
      .toThrow(new GenerationBlocked('no_permitted_source'))
    expect(() => make({ editorial_direction: { ...b.editorial_direction, format: 'lm_promo' } }))
      .toThrow(new GenerationBlocked('resource_not_ready'))
  })

  it('allows carousel copy with an explicit render hold but blocks factual gaps', () => {
    const b = brief()
    const carousel = make({ editorial_direction: { ...b.editorial_direction, format: 'carousel' },
      readiness: 'needs_material', missing_material: ['rendered slide PDF pending'] })
    expect(carousel.copy_only).toBe(true)
    expect(carousel.production_hold).toContain('rendered_deck_unverified')
    expect(() => make({ readiness: 'needs_material', missing_material: ['Permission for case study unknown'] }))
      .toThrow(new GenerationBlocked('essential_material_missing'))
  })

  it('routes a single-image brief to text copy while holding the owned image', () => {
    const b = brief()
    const image = make({ editorial_direction: { ...b.editorial_direction, format: 'single_image' },
      production: { ...b.production, required_materials: ['owned image proof pending'] } })
    expect(image.route).toBe('text')
    expect(image.copy_only).toBe(true)
    expect(image.production_hold).toEqual(['image_asset_pending', 'owned image proof pending'])
    expect(image.brief.editorial_direction.format).toBe('single_image')
  })

  it('keeps an accessible private call internal while preserving public-use hold', () => {
    const result = make({ evidence: [evidence({ source_kind: 'call', source_client_scope: 'ivan',
      permission_state: 'unknown', source_ref: { excerpt_pointer: 'private-call:excerpt-1' } })] })
    expect(result.source_ids).toEqual(['urn:fixture:source:1'])
    expect(result.production_hold).toContain('call_public_use_permission_unresolved')
    expect(() => make({ evidence: [evidence({ source_kind: 'call', source_client_scope: 'arch',
      permission_state: 'unknown' })] })).toThrow(new GenerationBlocked('no_permitted_source'))
  })
})

describe('history row roles for a generation route', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    native_id: 'older', qa_failed: false, is_test: false, published_at: null, ...over,
  })

  it('never lets the current native object act as its own history', () => {
    expect(classifyHistoryRole(row({ native_id: 'current' }), 'current').role).toBe('excluded')
  })

  it('demotes a QA-failed or test row to a negative example only', () => {
    expect(classifyHistoryRole(row({ qa_failed: true }), 'current').role).toBe('negative_only')
    expect(classifyHistoryRole(row({ is_test: true }), 'current').role).toBe('negative_only')
    expect(classifyHistoryRole(row({ qa_failed: true, published_at: '2026-09-01T00:00:00Z' }), 'current').role)
      .toBe('negative_only')
  })

  it('treats an unpublished draft as a duplication check, never as published precedent', () => {
    expect(classifyHistoryRole(row(), 'current').role).toBe('duplicate_only')
  })

  it('allows a clean published row as positive precedent', () => {
    expect(classifyHistoryRole(row({ published_at: '2026-09-01T00:00:00Z' }), 'current').role)
      .toBe('positive_precedent')
  })
})

describe('projected native columns', () => {
  it('keeps only columns that exist in the actual destination schema, in schema order', () => {
    const r = projectNativeColumns(['post_text', 'invented_column', 'post_format'],
      ['id', 'post_text', 'post_format', 'scheduled_at'])
    expect(r.projected).toEqual(['post_text', 'post_format'])
    expect(r.unknown).toEqual(['invented_column'])
  })

  it('reports an empty projection rather than inventing a destination column', () => {
    expect(projectNativeColumns(['nope'], ['id']))
      .toEqual({ projected: [], unknown: ['nope'] })
  })
})

describe('canonical register floors', () => {
  const long = 'This sentence is deliberately written to run past seventeen words so that it satisfies the rhythm floor cleanly.'
  const withBoth = `It's a short one. ${long}`

  it('reads an absence penalty as a floor, never as a cap', () => {
    // arch-qa v12: "zero contractions -> VOICE <= 5. No sentence of 17+ words -> RHYTHM <= 5."
    // One is enough; more must never make the result worse.
    const one = evaluateRegisterFloors(withBoth)
    const many = evaluateRegisterFloors(`${withBoth} It's here. We're there. They're gone. ${long} ${long}`)
    expect(one.satisfied).toBe(true)
    expect(many.satisfied).toBe(true)
    expect(many.contractions).toBeGreaterThan(one.contractions)
    expect(many.long_sentences).toBeGreaterThan(one.long_sentences)
    for (const f of many.floors) expect(f.satisfied).toBe(true)
    // the direction of the rule is explicit in the data, so a caller cannot invert it
    for (const f of many.floors) expect(f.direction).toBe('minimum')
  })

  it('reports the exact floor that is unmet rather than a bare failure', () => {
    const noContractions = evaluateRegisterFloors(`A plain short line. ${long}`)
    expect(noContractions.satisfied).toBe(false)
    expect(noContractions.unmet.map(f => f.id)).toEqual(['contractions'])
    expect(noContractions.unmet[0].penalty_if_unmet).toMatch(/VOICE/)

    const noLong = evaluateRegisterFloors("It's short. So is this one.")
    expect(noLong.satisfied).toBe(false)
    expect(noLong.unmet.map(f => f.id)).toEqual(['long_sentences'])
    expect(noLong.unmet[0].penalty_if_unmet).toMatch(/RHYTHM/)
  })

  it('counts a seventeen-word sentence as satisfying the rhythm floor and sixteen as not', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => `word${i}`).join(' ') + '.'
    const seventeen = Array.from({ length: 17 }, (_, i) => `word${i}`).join(' ') + '.'
    expect(evaluateRegisterFloors(sixteen).long_sentences).toBe(0)
    expect(evaluateRegisterFloors(seventeen).long_sentences).toBe(1)
  })

  it('does not mistake a possessive or a hyphen for a contraction', () => {
    expect(evaluateRegisterFloors("The studio's budget. A well-known name.").contractions).toBe(0)
    expect(evaluateRegisterFloors("The studio's budget. It's late.").contractions).toBe(1)
  })
})

describe('final QA acceptance boundary', () => {
  const copy = 'This is the exact final copy. It has already been reviewed.'
  const copySha256 = createHash('sha256').update(copy, 'utf8').digest('hex')
  const accepted = {
    assessment_id: 'assessment-1', verdict: 'accepted' as const,
    reviewed_copy_sha256: copySha256, reviewer_response_id: 'provider-response-1',
    reviewer_provenance: 'provider_response' as const,
  }

  it('accepts only a trusted external review bound to the exact final copy', async () => {
    await expect(validateFinalQaAcceptance({ finalCopy: copy, assessment: accepted, sha256Hex: value => createHash('sha256').update(value).digest('hex') })).resolves.toEqual({
      ...accepted, final_copy_sha256: copySha256,
    })
  })

  it.each([
    [{ ...accepted, verdict: 'needs_regenerate' }, 'qa_not_accepted'],
    [{ ...accepted, reviewed_copy_sha256: '0'.repeat(64) }, 'qa_copy_hash_mismatch'],
    [{ ...accepted, reviewer_provenance: 'model_output' }, 'untrusted_reviewer_provenance'],
    [{ ...accepted, reviewer_response_id: '' }, 'missing_reviewer_response_id'],
  ])('fails closed for invalid acceptance evidence %#', async (assessment, reason) => {
    await expect(validateFinalQaAcceptance({ finalCopy: copy, assessment: assessment as any,
      sha256Hex: value => createHash('sha256').update(value).digest('hex') }))
      .rejects.toEqual(new GenerationBlocked(reason))
  })

  it('requires a rewritten copy to receive its own review', async () => {
    await expect(validateFinalQaAcceptance({ finalCopy: `${copy} Rewritten.`, assessment: accepted,
      sha256Hex: value => createHash('sha256').update(value).digest('hex') }))
      .rejects.toEqual(new GenerationBlocked('qa_copy_hash_mismatch'))
  })
})

describe('complete route final-copy contracts', () => {
  it('serializes the complete selected format without dropping carousel slides or video segments', () => {
    const carousel = serializeFinalCopy({ format: 'carousel', caption: 'Caption', slides: [
      { number: 1, copy: 'Cover', visual_direction: 'Portrait crop' },
      { number: 2, copy: 'Body', visual_direction: 'Two-column comparison' },
    ] })
    expect(JSON.parse(carousel)).toEqual({ format: 'carousel', caption: 'Caption', slides: [
      { number: 1, copy: 'Cover', visual_direction: 'Portrait crop' },
      { number: 2, copy: 'Body', visual_direction: 'Two-column comparison' },
    ] })
    expect(JSON.parse(serializeFinalCopy({ format: 'video', script: 'Full script', segments: ['Beat one', 'Beat two'] })))
      .toEqual({ format: 'video', script: 'Full script', segments: ['Beat one', 'Beat two'] })
  })

  it('refuses incomplete structured output and missing resource material', () => {
    expect(() => serializeFinalCopy({ format: 'carousel', caption: 'Caption', slides: [
      { number: 1, copy: 'Cover', visual_direction: '' },
    ] })).toThrow(new GenerationBlocked('incomplete_carousel_copy'))
    expect(() => serializeFinalCopy({ format: 'video', script: 'Script', segments: [] }))
      .toThrow(new GenerationBlocked('incomplete_video_script'))
    expect(() => serializeFinalCopy({ format: 'resource', material: '' }))
      .toThrow(new GenerationBlocked('resource_material_missing'))
  })
})

describe('transport-derived QA receipt', () => {
  const sha = (value: string) => createHash('sha256').update(value).digest('hex')

  it('accepts only a provider pass of the byte-identical candidate', async () => {
    const candidate = 'Exact candidate bytes.'
    const assessment = await buildTransportQaAssessment({ candidateCopy: candidate,
      providerResponseId: 'msg-provider-1', assessmentId: 'qa-1',
      reviewerResult: { decision: 'pass', final_copy: candidate }, sha256Hex: sha })
    expect(assessment).toMatchObject({ verdict: 'accepted', reviewer_response_id: 'msg-provider-1',
      reviewer_provenance: 'provider_response', reviewed_copy_sha256: sha(candidate) })
  })

  it('keeps a QA rewrite as an unaccepted correction candidate until it is reviewed again', async () => {
    const assessment = await buildTransportQaAssessment({ candidateCopy: 'First candidate.',
      providerResponseId: 'msg-provider-2', assessmentId: 'qa-2',
      reviewerResult: { decision: 'revised', final_copy: 'Rewritten candidate.' }, sha256Hex: sha })
    expect(assessment).toMatchObject({ verdict: 'needs_regenerate', proposed_copy: 'Rewritten candidate.',
      reviewed_copy_sha256: sha('First candidate.') })
    await expect(validateFinalQaAcceptance({ finalCopy: 'Rewritten candidate.', assessment,
      sha256Hex: sha })).rejects.toEqual(new GenerationBlocked('qa_not_accepted'))
  })

  it('rejects model-authored or missing transport identity', async () => {
    await expect(buildTransportQaAssessment({ candidateCopy: 'Candidate.', providerResponseId: '',
      assessmentId: 'qa-3', reviewerResult: { decision: 'pass', final_copy: 'Candidate.' }, sha256Hex: sha }))
      .rejects.toEqual(new GenerationBlocked('missing_reviewer_response_id'))
  })
})

describe('native completion identity and provider ceilings', () => {
  const copy = 'Persisted exact copy.'
  const copyHash = createHash('sha256').update(copy).digest('hex')
  const expected = { client_id: 'ivan' as const, artifact_id: 'artifact-1', native_draft_id: 'native-1',
    request_id: 'request-1', brief_id: 'brief-1', brief_version: 1, brief_hash: 'a'.repeat(64),
    assessment_id: 'qa-1', final_copy_sha256: copyHash }

  it('accepts only one complete native row with the exact request, brief, QA and copy identity', () => {
    expect(assertNativeCompletionReadback({ ...expected, dispatch_state: 'complete', persisted: true }, expected))
      .toMatchObject(expected)
    expect(() => assertNativeCompletionReadback({ ...expected, client_id: 'arch', dispatch_state: 'complete', persisted: true }, expected))
      .toThrow(new GenerationBlocked('native_completion_identity_mismatch'))
    expect(() => assertNativeCompletionReadback({ ...expected, final_copy_sha256: '0'.repeat(64), dispatch_state: 'complete', persisted: true }, expected))
      .toThrow(new GenerationBlocked('native_completion_identity_mismatch'))
  })

  it('blocks routes whose actual worst-case graph exceeds twelve provider calls', () => {
    expect(assessProviderCallBudget('video_script', [
      { stage: 'generate_script', worst_case_calls: 1 }, { stage: 'qa', worst_case_calls: 1 },
    ])).toMatchObject({ worst_case_calls: 2, eligible: true })
    expect(assessProviderCallBudget('text', [
      { stage: 'content_brief', worst_case_calls: 4 }, { stage: 'hooks', worst_case_calls: 4 },
      { stage: 'post', worst_case_calls: 4 }, { stage: 'qa', worst_case_calls: 4 },
    ])).toMatchObject({ worst_case_calls: 16, eligible: false, blocked_reason: 'provider_call_ceiling_exceeded' })
  })
})
