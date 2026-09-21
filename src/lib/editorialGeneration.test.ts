import { describe, expect, it } from 'vitest'
import { brief, evidence } from './editorialBriefs.fixtures'
import { assertEnvelopeAtStage, attachEnvelope, buildGenerationEnvelope, GenerationBlocked } from './editorialGeneration'

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
