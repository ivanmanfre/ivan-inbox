const DIRECTION_KEYS = new Set(['audience', 'purpose', 'boundaries'])

/** Exact human-authored passages the model may copy into direction_quote.
 * Operational metadata is deliberately excluded so evidence/source text cannot
 * be mistaken for direction and hashes cannot accidentally satisfy the gate. */
export function directionQuoteOptions(direction: unknown): string[] {
  const values: string[] = []
  const walk = (value: unknown, key = '') => {
    if (typeof value === 'string') {
      if (DIRECTION_KEYS.has(key) && value.trim()) values.push(value.trim())
      return
    }
    if (Array.isArray(value)) {
      if (DIRECTION_KEYS.has(key)) {
        for (const item of value) if (typeof item === 'string' && item.trim()) values.push(item.trim())
      } else {
        for (const item of value) walk(item)
      }
      return
    }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) walk(child, childKey)
    }
  }
  walk(direction)
  return [...new Set(values)]
}

export function refreshTraceValidation(input: {
  error: string; defects: string[]; selectedSourceIds: string[]
  selectionMethod: string; selectionCoverage: unknown; contextCoverage: unknown
}) {
  return {
    error: input.error, defects: input.defects,
    context_coverage: input.contextCoverage,
    selection_method: input.selectionMethod,
    selection_coverage: input.selectionCoverage,
    selected_source_ids: input.selectedSourceIds,
  }
}

export function assertRefreshHasSources(sourceIds: string[], frozenRefCount: number) {
  if (!sourceIds.length) {
    throw new Error(`no eligible sources were offered to synthesis from ${frozenRefCount} frozen refs`)
  }
}
