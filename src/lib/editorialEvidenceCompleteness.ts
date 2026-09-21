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
  fetchFailed?: boolean
  native?: NativeBodyRecovery | null
}): EvidenceCompleteness {
  const state = declaredState(input.declaredState)
  const native = input.native ?? null
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
  if (state) return { bodyState: state, supplementalBody: false, nativeBodySha256: native?.body_sha256 ?? null }
  return {
    bodyState: input.body.length === 500 ? 'unknown' : 'full',
    supplementalBody: false,
    nativeBodySha256: native?.body_sha256 ?? null,
  }
}
