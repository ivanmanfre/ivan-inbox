import { describe, expect, it } from 'vitest'
import { resolveEvidenceCompleteness } from './editorialEvidenceCompleteness'

// Sanitized retained recovery facts: public identifiers and hashes only. The
// source body remains in the read-only recovery artifact, not this test file.
const riseRecovery = {
  sourceId: 'urn:li:activity:7506351357595918336',
  capturedChars: 500,
  capturedHash: '8d20dc97e778716860d915b698699919d136fda112e9e9b1a84a6c38ffa9c159',
  nativeId: '4b999ad5-429b-454b-a707-438e466c8eee',
  nativeChars: 902,
  nativeHash: '98ba29a13a5baf2f5b7863cc579359c5f362de7e305d5f68edb1c49e836b6a33',
} as const

describe('evidence body completeness', () => {
  it('records a verified 500-character native mismatch as an unresolved excerpt', () => {
    const recovered = resolveEvidenceCompleteness({
      body: 'x'.repeat(riseRecovery.capturedChars),
      native: {
        source_id: riseRecovery.sourceId,
        native_id: riseRecovery.nativeId,
        body_chars: riseRecovery.nativeChars,
        body_sha256: riseRecovery.nativeHash,
        exact_prefix_match: false,
        exact_body_match: false,
      },
    })

    expect(recovered.bodyState).toBe('excerpt')
    expect(recovered.supplementalBody).toBe(false)
    expect(recovered.nativeBodySha256).toBe(riseRecovery.nativeHash)
  })

  it('marks an exact 500-character capture unknown until collection evidence resolves it', () => {
    const recovered = resolveEvidenceCompleteness({ body: 'x'.repeat(500) })

    expect(recovered.bodyState).toBe('unknown')
    expect(recovered.supplementalBody).toBe(false)
  })

  it('keeps every unproven retained length unknown, including a non-500 body', () => {
    const recovered = resolveEvidenceCompleteness({ body: 'x'.repeat(417) })

    expect(recovered.bodyState).toBe('unknown')
  })

  it('accepts a declared full body only with a retained collection basis', () => {
    const unproven = resolveEvidenceCompleteness({ body: 'retained source text', declaredState: 'full' })
    const proven = resolveEvidenceCompleteness({ body: 'retained source text', declaredState: 'full',
      collectionProvenance: 'client_post_metrics.full_text' })

    expect(unproven.bodyState).toBe('unknown')
    expect(proven.bodyState).toBe('full')
  })

  it('accepts an exact native-body match as full without a collector label', () => {
    const recovered = resolveEvidenceCompleteness({ body: 'native body', native: {
      source_id: 'urn:fixture', native_id: 'native-fixture', body_chars: 11,
      body_sha256: 'a'.repeat(64), exact_prefix_match: true, exact_body_match: true,
    } })

    expect(recovered.bodyState).toBe('full')
    expect(recovered.supplementalBody).toBe(true)
  })

  it('keeps a failed body capture unavailable instead of treating it as empty text', () => {
    const recovered = resolveEvidenceCompleteness({ body: null, fetchFailed: true })

    expect(recovered.bodyState).toBe('unavailable')
    expect(recovered.supplementalBody).toBe(false)
  })
})
