import { describe, expect, it } from 'vitest'
import { brief, evidence } from './editorialBriefs.fixtures'
import { assertEnvelopeAtStage, attachEnvelope, buildGenerationEnvelope, classifyHistoryRole, evaluateRegisterFloors, GenerationBlocked, projectNativeColumns } from './editorialGeneration'

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
