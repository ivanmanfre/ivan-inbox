/** Deterministic bounded evidence selection for a refresh. Full source snapshots stay
 * in the manifest; this only controls the model context and records omissions.
 *
 * The population is walked in explicit pages so a newest-first prefix can never
 * silently remove a whole source family (or the only cited winner). Every row the
 * shortlist leaves behind is named by ID, grouped by family, in `coverage`. */
export type SelectionRow = Record<string, unknown> & {
  source_id: string; source_kind: string; owner: string; passage: string | null
  source_published_at?: string | null; captured_at: string
  retained_context?: string; limitation?: string; permission_state?: string
  candidate_fields?: Record<string, unknown> | null
}

export type SelectionCoverage = {
  method: string; page_size: number; pages_read: number
  population_total: number; usable_population: number; without_usable_body: number
  selected_count: number; omitted_count: number
  family_quotas: Record<string, number>
  selected_count_by_family: Record<string, number>
  usable_count_by_family: Record<string, number>
  omitted_count_by_family: Record<string, number>
  omitted_source_ids_by_family: Record<string, string[]>
  distinct_owners_selected: number
}

/** Families the shortlist must represent. Anything unrecognised keeps its own
 * bucket rather than disappearing into a generic tail. */
export const SOURCE_FAMILY_ORDER = ['own_post', 'public_post', 'market_study', 'candidate', 'call', 'asset'] as const
const familyOf = (row: SelectionRow) => String(row.source_kind ?? 'unknown') || 'unknown'

const date = (s: SelectionRow) => Date.parse(s.source_published_at ?? s.captured_at) || 0
const passage = (s: SelectionRow) => typeof s.passage === 'string' ? s.passage : ''
const rich = (s: SelectionRow) => passage(s).trim().length >= 160
const lift = (s: SelectionRow) => {
  const findings = s.candidate_fields?.linked_findings
  if (!Array.isArray(findings)) return 0
  return Math.max(0, ...findings.map(f => Number(f?.lift ?? 0)).filter(Number.isFinite))
}

/** Explicit pagination over the allowed population. Every page is read; the page
 * size only bounds how much is held at once, never how much is considered. */
export function paginateSources<T>(sources: T[], pageSize = 500): T[][] {
  const size = Math.max(1, pageSize)
  const pages: T[][] = []
  for (let offset = 0; offset < sources.length; offset += size) pages.push(sources.slice(offset, offset + size))
  return pages
}

const rank = (family: string) => (a: SelectionRow, b: SelectionRow) => {
  if (family === 'public_post' || family === 'market_study') {
    // Adaptability first: a short high-lift row cannot carry a direction, so a
    // rich measured source outranks a louder fragment.
    const byRich = Number(rich(b)) - Number(rich(a))
    if (byRich) return byRich
    const byLift = lift(b) - lift(a)
    if (byLift) return byLift
  }
  return date(b) - date(a) || a.source_id.localeCompare(b.source_id)
}

/** Even split of the shortlist across present families, remainder handed out in a
 * fixed family order so the result never depends on input order. */
function quotas(families: string[], limit: number) {
  const ordered = [...families].sort((a, b) => {
    const ai = SOURCE_FAMILY_ORDER.indexOf(a as never), bi = SOURCE_FAMILY_ORDER.indexOf(b as never)
    return (ai < 0 ? SOURCE_FAMILY_ORDER.length : ai) - (bi < 0 ? SOURCE_FAMILY_ORDER.length : bi) || a.localeCompare(b)
  })
  const base = Math.floor(limit / Math.max(1, ordered.length))
  const out: Record<string, number> = {}
  let spare = limit - base * ordered.length
  for (const family of ordered) { out[family] = base + (spare > 0 ? 1 : 0); if (spare > 0) spare-- }
  return { ordered, out }
}

export function selectSynthesisSources<T extends SelectionRow>(sources: T[], limit = 24, pageSize = 500) {
  const pages = paginateSources(sources, pageSize)
  const population: T[] = []
  for (const page of pages) population.push(...page)
  const usable = population.filter(source => passage(source).trim())
  const withoutUsableBody = population.length - usable.length

  const buckets = new Map<string, T[]>()
  for (const source of usable) {
    const family = familyOf(source)
    if (!buckets.has(family)) buckets.set(family, [])
    buckets.get(family)!.push(source)
  }
  const { ordered, out: quota } = quotas([...buckets.keys()], limit)
  for (const family of ordered) buckets.get(family)!.sort(rank(family))

  // Round-robin so no family can consume the budget before the others are offered
  // a slot. Distinct owners come first inside the market families; a repeated owner
  // is still eligible once every distinct owner in that family has been offered.
  const selected = new Map<string, T>()
  const takenOwners = new Map<string, Set<string>>()
  const cursor = new Map<string, number>()
  const takeOne = (family: string, cap: number, uniqueOwner: boolean) => {
    const rows = buckets.get(family) ?? []
    const owners = takenOwners.get(family) ?? new Set<string>()
    takenOwners.set(family, owners)
    for (let i = cursor.get(family) ?? 0; i < rows.length; i++) {
      const row = rows[i]
      if (selected.has(row.source_id)) continue
      if (uniqueOwner && owners.has(String(row.owner))) continue
      cursor.set(family, i + 1)
      selected.set(row.source_id, row)
      owners.add(String(row.owner))
      return true
    }
    if (uniqueOwner) { cursor.set(family, 0); return takeOne(family, cap, false) }
    return false
  }
  for (const uniqueOwner of [true, false]) {
    for (let round = 0; selected.size < limit; round++) {
      let progressed = false
      for (const family of ordered) {
        if (selected.size >= limit) break
        const taken = [...selected.values()].filter(x => familyOf(x) === family).length
        if (taken >= quota[family]) continue
        if (takeOne(family, quota[family], uniqueOwner && (family === 'public_post' || family === 'market_study'))) progressed = true
      }
      if (!progressed) break
    }
    // Families that could not fill their quota release it to the rest.
    for (const family of ordered) quota[family] = limit
  }

  const selectedIds = new Set(selected.keys())
  const omittedByFamily: Record<string, string[]> = {}
  const usableByFamily: Record<string, number> = {}
  const selectedByFamily: Record<string, number> = {}
  for (const family of ordered) {
    const rows = buckets.get(family) ?? []
    usableByFamily[family] = rows.length
    selectedByFamily[family] = rows.filter(x => selectedIds.has(x.source_id)).length
    omittedByFamily[family] = rows.filter(x => !selectedIds.has(x.source_id)).map(x => x.source_id)
  }
  const withoutBodyIds = population.filter(source => !passage(source).trim()).map(source => source.source_id)
  if (withoutBodyIds.length) omittedByFamily.without_usable_body = withoutBodyIds

  const coverage: SelectionCoverage = {
    method: 'paginated-family-balanced-measured-distinct-author-round-robin-v3',
    page_size: Math.max(1, pageSize), pages_read: pages.length,
    population_total: population.length, usable_population: usable.length, without_usable_body: withoutUsableBody,
    selected_count: selected.size, omitted_count: population.length - selected.size,
    family_quotas: Object.fromEntries(ordered.map(family => [family, quota[family]])),
    selected_count_by_family: selectedByFamily, usable_count_by_family: usableByFamily,
    omitted_count_by_family: Object.fromEntries(Object.entries(omittedByFamily).map(([k, v]) => [k, v.length])),
    omitted_source_ids_by_family: omittedByFamily,
    distinct_owners_selected: new Set([...selected.values()].map(x => String(x.owner))).size,
  }
  return { selected: [...selected.values()], method: coverage.method,
    omitted: population.length - selected.size, withoutUsableBody, coverage }
}
