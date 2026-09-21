import type { SelectionRow } from './editorialSelection.ts'
import type { SynthesisMessage } from './editorialSynthesisRun.ts'

type Row = Record<string, unknown>
export type ContextParts = { selected: SelectionRow[]; outcomes: Row[]; coverage: Record<string, unknown> }
export type CanonicalPrompt = { id: string; slug: string; version: string | number; body: string }
export type SynthesisAsset = { id: string; version: string; access_route: string; permission_basis: string
  status: string; catalog_state: string; slug?: string | null }

/** Keep each canonical body as raw prompt text. JSON metadata stays separate so
 * request serialization escapes each body once rather than a nested second time. */
export function renderCanonicalPromptBodies(prompts: CanonicalPrompt[]) {
  return prompts.map((prompt, index) => {
    const metadata = JSON.stringify({ prompt_id: prompt.id, slug: prompt.slug, version: prompt.version })
    return `CANONICAL PROMPT ${index + 1} METADATA: ${metadata}\nBEGIN EXACT CANONICAL BODY\n${prompt.body}\nEND EXACT CANONICAL BODY`
  }).join('\n\n')
}

const assetRank = (asset: SynthesisAsset) => asset.status === 'ready' ? 0
  : asset.catalog_state === 'published' ? 1
    : asset.catalog_state === 'draft' ? 2
      : asset.catalog_state === 'private' ? 3
        : asset.catalog_state === 'retired' ? 4
          : asset.catalog_state === 'disqualified' ? 5 : 6

/** Bound the actionable catalog while retaining an explicit identity manifest
 * for every omitted row. Full catalog rows remain frozen outside the request. */
export function selectSynthesisAssets<T extends SynthesisAsset>(assets: T[], limit = 8) {
  const ordered = [...assets].sort((a, b) => assetRank(a) - assetRank(b) ||
    String(a.slug ?? a.id).localeCompare(String(b.slug ?? b.id)) || a.id.localeCompare(b.id))
  const selected = ordered.slice(0, limit)
  const omitted = ordered.slice(limit)
  return { selected, coverage: {
    method: 'ready-published-draft-private-retired-disqualified-lexical-v1',
    assets_considered: ordered.length, assets_supplied: selected.length, assets_omitted: omitted.length,
    omitted_assets: omitted.map(asset => ({ id: asset.id, catalog_state: asset.catalog_state })),
  } }
}

/** Bound the actual serialized request, never the frozen evidence store. Binding
 * feedback, canonical voice, direction and assets are supplied intact by render. */
export function prepareSynthesisContext(input: {
  sources: SelectionRow[]; outcomes: Row[]
  coverage?: Record<string, unknown>
  render: (parts: ContextParts) => SynthesisMessage[]
}) {
  const keys = ['observed_metrics', 'linked_findings', 'private_names', 'age_comparability', 'population', 'inclusion', 'study_id',
    'metric_source', 'metric_denominator', 'observation_window', 'metric_observations', 'body_state', 'body_provenance', 'source_identity']
  const project = (source: SelectionRow, cap: number): SelectionRow => ({ ...source,
    passage: String(source.passage ?? '').slice(0, cap), retained_context: String(source.retained_context ?? '').slice(0, Math.min(cap, 2000)),
    candidate_fields: Object.fromEntries(keys.filter(k => source.candidate_fields?.[k] !== undefined)
      .map(k => [k, source.candidate_fields![k]])),
  })
  // Round-robin kinds when context is tight: never spend the whole remaining
  // budget on high-engagement public posts and silently lose own/call evidence.
  const kinds = [...new Set(input.sources.map(s => s.source_kind))]
  const outcomeIds = new Set(input.outcomes.map(o => String(o.artifact_id)))
  const groups = kinds.map(k => input.sources.filter(s => s.source_kind === k)
    .sort((a, b) => k === 'own_post' ? Number(outcomeIds.has(b.source_id)) - Number(outcomeIds.has(a.source_id)) : 0))
  const balanced: SelectionRow[] = []
  for (let i = 0; balanced.length < input.sources.length; i++)
    for (const group of groups) if (group[i]) balanced.push(group[i])
  // Keep 24k for correction; a larger actual reply still fails closed at 200k.
  for (const count of [...new Set([input.sources.length, 16, 12, 8, 6, kinds.length])].filter(n => n <= input.sources.length)) {
    const supplied = count === input.sources.length ? input.sources : balanced.slice(0, count)
    const sourceIds = new Set(supplied.map(s => s.source_id))
    const latest = new Map<string, Row>()
    for (const row of input.outcomes) {
      if (!sourceIds.has(String(row.artifact_id))) continue
      const key = `${row.artifact_id}|${row.metric}`
      const old = latest.get(key)
      if (!old || String(row.captured_at ?? '').localeCompare(String(old.captured_at ?? '')) > 0 ||
        (row.captured_at === old.captured_at && String(row.snapshot_id).localeCompare(String(old.snapshot_id)) > 0)) latest.set(key, row)
    }
    const outcomes = [...latest.values()].sort((a, b) => String(a.snapshot_id).localeCompare(String(b.snapshot_id)))
    for (const cap of [8000, 4000, 2000, 1000, 500]) {
      const selected = supplied.map(s => project(s, cap))
      const coverage: Record<string, unknown> = { ...(input.coverage ?? {}), method: 'kind-balanced-exact-artifact-latest-metric-whole-request-v1',
        sources_considered: input.sources.length, sources_supplied: selected.length, sources_omitted_by_budget: input.sources.length - selected.length,
        outcomes_frozen: input.outcomes.length, outcomes_supplied: outcomes.length, outcomes_omitted: input.outcomes.length - outcomes.length,
        excerpted_sources: selected.filter((s, i) => s.passage !== supplied[i].passage || s.retained_context !== String(supplied[i].retained_context ?? '')).length,
        passage_cap: cap, correction_reserve_chars: 24000,
        limits: 'Only selected sources and their latest exact-artifact observations are supplied. All binding decisions remain supplied. Omitted outcomes are unknown here, not zero. Historical feed overlap and buyer composition are unknown. Full source/outcome snapshots remain in the immutable manifest. Candidate duplicate raw context is excluded; structured measurements and private-name guards are retained.' }
      const messages = input.render({ selected, outcomes, coverage })
      if (JSON.stringify(messages).length <= 176000) return { selected, outcomes, coverage, messages }
    }
  }
  throw new Error('Mandatory canonical instructions, decisions and selected evidence exceed bounded context; last usable batch retained')
}
