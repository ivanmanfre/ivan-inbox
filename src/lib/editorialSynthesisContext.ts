import type { SelectionRow } from './editorialSelection.ts'
import type { SynthesisMessage } from './editorialSynthesisRun.ts'

type Row = Record<string, unknown>
export type ContextParts = { selected: SelectionRow[]; outcomes: Row[]; coverage: Record<string, unknown> }
/** Bound the actual serialized request, never the frozen evidence store. Binding
 * feedback, canonical voice, direction and assets are supplied intact by render. */
export function prepareSynthesisContext(input: {
  sources: SelectionRow[]; outcomes: Row[]
  render: (parts: ContextParts) => SynthesisMessage[]
}) {
  const keys = ['observed_metrics', 'linked_findings', 'private_names', 'age_comparability', 'population', 'inclusion', 'study_id']
  const project = (source: SelectionRow, cap: number): SelectionRow => ({ ...source,
    passage: source.passage.slice(0, cap), retained_context: String(source.retained_context ?? '').slice(0, Math.min(cap, 2000)),
    candidate_fields: Object.fromEntries(keys.filter(k => source.candidate_fields?.[k] !== undefined)
      .map(k => [k, source.candidate_fields![k]])),
  })
  // Round-robin kinds when context is tight: never spend the whole remaining
  // budget on high-engagement public posts and silently lose own/call evidence.
  const kinds = [...new Set(input.sources.map(s => s.source_kind))]
  const groups = kinds.map(k => input.sources.filter(s => s.source_kind === k))
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
      const coverage = { method: 'kind-balanced-exact-artifact-latest-metric-whole-request-v1',
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
