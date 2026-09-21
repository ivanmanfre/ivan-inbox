/** Deterministic bounded evidence selection for a refresh. Full source snapshots stay
 * in the manifest; this only controls the model context and records omissions. */
export type SelectionRow = Record<string, unknown> & {
  source_id: string; source_kind: string; owner: string; passage: string
  source_published_at?: string | null; captured_at: string
  retained_context?: string; limitation?: string; permission_state?: string
  candidate_fields?: Record<string, unknown> | null
}

const date = (s: SelectionRow) => Date.parse(s.source_published_at ?? s.captured_at) || 0
const rich = (s: SelectionRow) => s.passage.trim().length >= 160
const lift = (s: SelectionRow) => {
  const findings = s.candidate_fields?.linked_findings
  if (!Array.isArray(findings)) return 0
  return Math.max(0, ...findings.map(f => Number(f?.lift ?? 0)).filter(Number.isFinite))
}
export function selectSynthesisSources<T extends SelectionRow>(sources: T[], limit = 24) {
  const selected = new Map<string, T>()
  const add = (candidates: T[], max: number, uniqueOwner = false) => {
    const owners = new Set<string>()
    let count = 0
    for (const source of candidates) {
      if (count >= max || selected.size >= limit) break
      if (selected.has(source.source_id) || !source.passage.trim()) continue
      if (uniqueOwner && owners.has(source.owner)) continue
      selected.set(source.source_id, source)
      owners.add(source.owner)
      count++
    }
  }
  const byDate = (a: T, b: T) => date(b) - date(a)
  add(sources.filter(x => x.source_kind === 'own_post').sort(byDate), 5)
  add(sources.filter(x => x.source_kind === 'call').sort(byDate), 3)
  add(sources.filter(x => x.source_kind === 'public_post' && rich(x) && lift(x) > 1)
    .sort((a, b) => lift(b) - lift(a) || byDate(a, b)), 6, true)
  add(sources.filter(x => x.source_kind === 'public_post' && rich(x)).sort(byDate), 6, true)
  add(sources.filter(x => x.source_kind === 'asset').sort(byDate), 2)
  add(sources.filter(x => rich(x)).sort(byDate), limit)
  add(sources.sort(byDate), limit)
  return { selected: [...selected.values()], method: 'own5-call3-measured-distinct-author6-recent-distinct-author6-asset2-fill-v1',
    omitted: Math.max(0, sources.length - selected.size) }
}
