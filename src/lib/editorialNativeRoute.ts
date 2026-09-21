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
  if (format === 'video') return { path: 'video-script', postFormat: 'text' }
  if (format === 'text' || format === 'single_image' || format === 'carousel')
    return { path: postPath[clientId], postFormat: format === 'carousel' ? 'carousel' : 'text' }
  return null
}
