export const BODY_STATES = ['full', 'excerpt', 'unavailable', 'unknown'] as const
export type EvidenceBodyState = typeof BODY_STATES[number]

export type NativeBodyRecovery = {
  source_id: string
  native_id: string
  body_chars: number
  body_sha256: string
  exact_prefix_match: boolean
  exact_body_match: boolean
}

export type EvidenceCompleteness = {
  bodyState: EvidenceBodyState
  supplementalBody: boolean
  nativeBodySha256: string | null
}

function declaredState(value: unknown): EvidenceBodyState | null {
  return typeof value === 'string' && (BODY_STATES as readonly string[]).includes(value)
    ? value as EvidenceBodyState
    : null
}

/** Collection metadata, not display length, decides whether a body is full.
    An exact 500-character capture is ambiguous until a collector records more. */
export function resolveEvidenceCompleteness(input: {
  body: string | null
  declaredState?: unknown
  /** A collector field or retained-native receipt that establishes a declared
      full body is complete. A label alone is not enough proof. */
  collectionProvenance?: unknown
  fetchFailed?: boolean
  native?: NativeBodyRecovery | null
}): EvidenceCompleteness {
  const state = declaredState(input.declaredState)
  const native = input.native ?? null
  const hasCollectionProvenance = typeof input.collectionProvenance === 'string' && input.collectionProvenance.trim().length > 0
  if (!input.body || input.fetchFailed) {
    return { bodyState: 'unavailable', supplementalBody: false, nativeBodySha256: native?.body_sha256 ?? null }
  }
  if (native && native.body_chars > input.body.length) {
    return {
      bodyState: 'excerpt',
      supplementalBody: native.exact_prefix_match || native.exact_body_match,
      nativeBodySha256: native.body_sha256,
    }
  }
  if (native?.exact_body_match && native.body_chars === input.body.length) {
    return { bodyState: 'full', supplementalBody: true, nativeBodySha256: native.body_sha256 }
  }
  if (state === 'full' && hasCollectionProvenance) {
    return { bodyState: 'full', supplementalBody: false, nativeBodySha256: native?.body_sha256 ?? null }
  }
  if (state && state !== 'full') return { bodyState: state, supplementalBody: false, nativeBodySha256: native?.body_sha256 ?? null }
  return {
    bodyState: 'unknown',
    supplementalBody: false,
    nativeBodySha256: native?.body_sha256 ?? null,
  }
}
