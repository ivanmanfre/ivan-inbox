export type NativeRoutePlan = {
  path: string
  phase?: 'editorial_promo' | 'editorial_resource'
  nativeFormat?: string
  postFormat: 'text' | 'carousel'
}

const postPath: Record<string, string> = {
  ivan: 'post-gen-v2',
  risedtc: 'rise-dtc-post-gen-v2-max',
  arch: 'arch-post-gen-v2',
}

/** Preserve the brief's format in SQL while using a copy-only native text row
 * for a single-image post until its owned image passes production review. */
export function planNativeRoute(clientId: string, format: string, copyOnly: boolean,
  resource: { readiness?: string; artifact_role?: string } | null): NativeRoutePlan | null {
  if (!postPath[clientId]) return null
  if (format === 'single_image' && !copyOnly) return null
  if (format === 'carousel' && !copyOnly) return null
  if (format === 'lm_promo') {
    if (!copyOnly || resource?.readiness !== 'ready') return null
    return { path: 'lm-gen-v2', phase: 'editorial_promo', nativeFormat: 'promo', postFormat: 'text' }
  }
  if (format === 'resource') {
    if (resource?.readiness !== 'ready' ||
      !['guide','checklist','template','calculator','skill_pack'].includes(resource.artifact_role ?? '')) return null
    return { path: 'lm-gen-v2', phase: 'editorial_resource',
      nativeFormat: resource.artifact_role, postFormat: 'text' }
  }
  if (format === 'video') return clientId === 'ivan' ? { path: 'video-script', postFormat: 'text' } : null
  if (format === 'text' || format === 'single_image' || format === 'carousel')
    return { path: postPath[clientId], postFormat: format === 'carousel' ? 'carousel' : 'text' }
  return null
}

export type NativeFinalizationInput = {
  artifactId: string
  requestId: string
  briefHash: string
  dispatchState: 'claimed' | 'complete' | 'failed'
  transportAmbiguous: boolean
  selectedQaCopy: string
  selectedAssessmentId: string
  persistedCopy?: string | null
  persistedAssessmentId?: string | null
}

export type NativeFinalizationPlan = {
  decision: 'persist_final' | 'idempotent_replay' | 'hold_unreconciled'
    | 'failed_original_retained' | 'persisted_copy_conflict' | 'no_selected_copy'
  reported_state: 'claimed' | 'complete' | 'failed'
  persist: boolean
  reason: string
}

/** Decides the terminal state of one dispatched native draft BEFORE any write.
 * A claimed job whose transport outcome is unknown stays claimed: an unresolved
 * dispatch is never reported complete. A failed original is retained as failed
 * and is never rewritten as the corrected final. A replay of an identical
 * completed job writes nothing. */
export function planNativeFinalization(input: NativeFinalizationInput): NativeFinalizationPlan {
  const selected = (input.selectedQaCopy ?? '').trim()
  if (!selected) return { decision: 'no_selected_copy', reported_state: input.dispatchState,
    persist: false, reason: 'no QA-selected final copy to persist' }
  if (input.dispatchState === 'failed') return { decision: 'failed_original_retained',
    reported_state: 'failed', persist: false,
    reason: 'the original dispatch failed; its status and candidate provenance are retained rather than overwritten by a corrected final' }
  if (input.transportAmbiguous) return { decision: 'hold_unreconciled', reported_state: 'claimed',
    persist: false, reason: 'transport outcome unresolved; the job stays claimed until read-only reconciliation settles it' }
  if (input.dispatchState === 'complete') {
    const stored = (input.persistedCopy ?? '').trim()
    if (stored === selected && input.persistedAssessmentId === input.selectedAssessmentId)
      return { decision: 'idempotent_replay', reported_state: 'complete', persist: false,
        reason: 'identical request already persisted; no second native object and no further provider call' }
    return { decision: 'persisted_copy_conflict', reported_state: 'complete', persist: false,
      reason: 'the stored final copy or assessment differs from the selected QA copy; refusing to overwrite a terminal object' }
  }
  return { decision: 'persist_final', reported_state: 'complete', persist: true,
    reason: 'claimed job with a settled transport outcome and a QA-selected final copy' }
}
