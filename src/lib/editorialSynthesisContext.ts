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
  const omittedByState = omitted.reduce<Record<string, string[]>>((groups, asset) => {
    ;(groups[asset.catalog_state] ??= []).push(asset.id)
    return groups
  }, {})
  return { selected, coverage: {
    method: 'ready-published-draft-private-retired-disqualified-lexical-v1',
    assets_considered: ordered.length, assets_supplied: selected.length, assets_omitted: omitted.length,
    omitted_asset_ids_by_catalog_state: Object.fromEntries(Object.entries(omittedByState)
      .sort(([a], [b]) => a.localeCompare(b)).map(([state, ids]) => [state, ids.sort()])),
  } }
}

/** Bound the actual serialized request, never the frozen evidence store. Binding
 * feedback, canonical voice, direction and assets are supplied intact by render. */
/** What the shortlist left behind, stated INSIDE the request. Counts only: the full
 * omitted-ID ledger stays in the manifest/receipt so disclosure cannot eat the budget. */
export type PopulationCoverage = {
  usable_population: number; shortlist_size: number; selection_policy: string
  without_usable_body?: number; omitted_count_by_family?: Record<string, number>
}

export function prepareSynthesisContext(input: {
  sources: SelectionRow[]; outcomes: Row[]
  coverage?: Record<string, unknown>
  population?: PopulationCoverage
  render: (parts: ContextParts) => SynthesisMessage[]
}) {
  const keys = ['observed_metrics', 'linked_findings', 'private_names', 'age_comparability', 'population', 'inclusion', 'study_id',
    'metric_source', 'metric_denominator', 'observation_window', 'metric_observations', 'source_identity']
  const project = (source: SelectionRow, cap: number): SelectionRow => {
    const sourcePassage = String(source.passage ?? '')
    const sourceContext = String(source.retained_context ?? '')
    const passage = sourcePassage.slice(0, cap)
    const retainedContext = sourceContext.slice(0, Math.min(cap, 2000))
    const sourceBodyState = String(source.candidate_fields?.body_state ?? 'unknown')
    const passageClipped = passage.length < sourcePassage.length
    const retainedContextClipped = retainedContext.length < sourceContext.length
    const candidateFields = Object.fromEntries(keys.filter(k => source.candidate_fields?.[k] !== undefined)
      .map(k => [k, source.candidate_fields![k]]))
    // Plain ASCII so the exact string survives JSON escaping and stays findable in
    // the assembled request: a clipped or incomplete body can never arrive silently.
    const gaps = [
      ...(sourceBodyState !== 'full' ? [`retained body state is ${sourceBodyState.replace(/[^a-z_]/gi, '')}`] : []),
      ...(passageClipped ? [`passage clipped to ${passage.length} of ${sourcePassage.length} characters`] : []),
      ...(retainedContextClipped ? [`retained context clipped to ${retainedContext.length} of ${sourceContext.length} characters`] : []),
    ]
    const gapReason = gaps.length
      ? `GAP: ${gaps.join('; ')}. The complete original stays in the immutable input manifest and is not supplied here.`
      : null
    return { ...source, passage, retained_context: retainedContext, gap_reason: gapReason, candidate_fields: {
      ...candidateFields,
      // `body_state` describes the model-visible passage. The immutable source
      // state and provenance remain distinct inside `model_projection`.
      body_state: passageClipped ? 'excerpt' : sourceBodyState,
      model_projection: {
        source_body_state: sourceBodyState,
        source_body_provenance: source.candidate_fields?.body_provenance ?? null,
        // Refresh reads the retained table shape (`body_sha256`) directly;
        // the RPC/UI projection aliases the same value as `source_content_hash`.
        source_content_hash: source.body_sha256 ?? source.source_content_hash ?? null,
        source_passage_chars: sourcePassage.length,
        supplied_passage_chars: passage.length,
        passage_clipped: passageClipped,
        source_retained_context_chars: sourceContext.length,
        supplied_retained_context_chars: retainedContext.length,
        retained_context_clipped: retainedContextClipped,
      },
    } }
  }
  // Round-robin kinds when context is tight: never spend the whole remaining
  // budget on high-engagement public posts and silently lose own/call evidence.
  const kinds = [...new Set(input.sources.map(s => s.source_kind))]
  const outcomeIds = new Set(input.outcomes.map(o => String(o.artifact_id)))
  const groups = kinds.map(k => input.sources.filter(s => s.source_kind === k)
    .sort((a, b) => k === 'own_post' ? Number(outcomeIds.has(b.source_id)) - Number(outcomeIds.has(a.source_id)) : 0))
  const balanced: SelectionRow[] = []
  for (let i = 0; balanced.length < input.sources.length; i++)
    for (const group of groups) if (group[i]) balanced.push(group[i])
  // Keep a 16k planning allowance for correction. This is not a guarantee: the
  // actual initial and correction requests each still fail closed at 200k in
  // runSynthesis, and a rejected reply is retained even when no retry can fit.
  // A client whose mandatory canon is very large (Ivan: ~147k of canonical bodies) can
  // only carry a handful of sources. Walking down to one supplies an honest, disclosed
  // request instead of failing closed; coverage states exactly how few arrived.
  for (const count of [...new Set([input.sources.length, 16, 12, 8, 6, kinds.length, 5, 4, 3, 2, 1])]
    .sort((a, b) => b - a).filter(n => n <= input.sources.length && n > 0)) {
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
      // The model must see how much evidence exists behind the shortlist, not only
      // the shortlist. `sources_considered` is the usable population, never the 24.
      const usablePopulation = input.population?.usable_population ?? input.sources.length
      const coverage: Record<string, unknown> = { ...(input.coverage ?? {}), method: 'kind-balanced-exact-artifact-latest-metric-whole-request-v1',
        sources_usable_population: usablePopulation,
        sources_shortlisted: input.population?.shortlist_size ?? input.sources.length,
        selection_policy: input.population?.selection_policy ?? 'supplied-shortlist-only',
        sources_without_usable_body: input.population?.without_usable_body ?? 0,
        omitted_count_by_source_family: input.population?.omitted_count_by_family ?? {},
        sources_omitted_before_shortlist: Math.max(0, usablePopulation - input.sources.length),
        sources_omitted_total: Math.max(0, usablePopulation - selected.length),
        sources_considered: usablePopulation, sources_supplied: selected.length, sources_omitted_by_budget: input.sources.length - selected.length,
        outcomes_frozen: input.outcomes.length, outcomes_supplied: outcomes.length, outcomes_omitted: input.outcomes.length - outcomes.length,
        excerpted_sources: selected.filter((s, i) => s.passage !== supplied[i].passage || s.retained_context !== String(supplied[i].retained_context ?? '')).length,
        passage_cap: cap, correction_reserve_chars: 16000,
        limits: 'sources_usable_population is the full usable population for this client; sources_shortlisted is the bounded shortlist selection_policy drew from it; sources_supplied is what fit. omitted_count_by_source_family states the loss per family; omitted IDs are named in the input manifest. Never claim feed-wide novelty or completeness from this sample. Only selected sources and their latest exact-artifact observations are supplied. All binding decisions remain supplied. Omitted outcomes are unknown here, not zero. Historical feed overlap and buyer composition are unknown. Full source/outcome snapshots remain in the immutable manifest. Candidate duplicate raw context is excluded; structured measurements and private-name guards are retained.' }
      const messages = input.render({ selected, outcomes, coverage })
      if (JSON.stringify(messages).length <= 184000) return { selected, outcomes, coverage, messages }
    }
  }
  throw new Error('Mandatory canonical instructions, decisions and selected evidence exceed bounded context; last usable batch retained')
}
