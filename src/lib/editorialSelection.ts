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
  selected_count_by_platform: Record<string, number>
  usable_count_by_family: Record<string, number>
  omitted_count_by_family: Record<string, number>
  omitted_source_ids_by_family: Record<string, string[]>
  distinct_owners_selected: number
}

/** Families the shortlist must represent. Anything unrecognised keeps its own
 * bucket rather than disappearing into a generic tail. */
export const SOURCE_FAMILY_ORDER = ['own_post', 'author_note', 'public_post', 'market_study', 'candidate', 'call', 'asset'] as const
const familyOf = (row: SelectionRow) => String(row.source_kind ?? 'unknown') || 'unknown'
const platformOf = (row: SelectionRow) => {
  const identity = row.candidate_fields?.source_identity
  if (identity && typeof identity === 'object' && typeof (identity as Record<string, unknown>).platform === 'string') {
    return String((identity as Record<string, unknown>).platform).toLowerCase()
  }
  return 'unknown'
}

const date = (s: SelectionRow) => Date.parse(s.source_published_at ?? s.captured_at) || 0
const passage = (s: SelectionRow) => typeof s.passage === 'string' ? s.passage : ''
const rich = (s: SelectionRow) => passage(s).trim().length >= 160
const lift = (s: SelectionRow) => {
  const findings = s.candidate_fields?.linked_findings
  if (!Array.isArray(findings)) return 0
  return Math.max(0, ...findings.map(f => Number(f?.lift ?? 0)).filter(Number.isFinite))
}
const engagement = (s: SelectionRow) => {
  const metrics = s.candidate_fields?.observed_metrics
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return 0
  const keys = platformOf(s) === 'reddit' ? ['score', 'comments'] : ['likes', 'replies', 'reposts', 'quotes']
  return keys.reduce((sum, key) => {
    const value = Number((metrics as Record<string, unknown>)[key])
    return sum + (Number.isFinite(value) && value >= 0 ? value : 0)
  }, 0)
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
  for (const family of ordered) {
    const rows = buckets.get(family)!
    if (family !== 'public_post') { rows.sort(rank(family)); continue }
    const byPlatform = new Map<string, T[]>()
    for (const row of rows) byPlatform.set(platformOf(row), [...(byPlatform.get(platformOf(row)) ?? []), row])
    for (const platformRows of byPlatform.values()) {
      const newest = Math.max(...platformRows.map(date))
      platformRows.sort((a, b) => {
        const byRich = Number(rich(b)) - Number(rich(a))
        if (byRich) return byRich
        const aRecent = newest - date(a) <= 30 * 86_400_000
        const bRecent = newest - date(b) <= 30 * 86_400_000
        if (aRecent !== bRecent) return Number(bRecent) - Number(aRecent)
        if (aRecent) {
          const byEngagement = engagement(b) - engagement(a)
          if (byEngagement) return byEngagement
        }
        return date(b) - date(a) || a.source_id.localeCompare(b.source_id)
      })
    }
    const platforms = [...byPlatform.keys()].sort()
    const interleaved: T[] = []
    for (let index = 0; interleaved.length < rows.length; index++) {
      for (const platform of platforms) {
        const row = byPlatform.get(platform)?.[index]
        if (row) interleaved.push(row)
      }
    }
    buckets.set(family, interleaved)
  }

  // Round-robin so no family can consume the budget before the others are offered
  // a slot. Distinct owners come first inside the market families; a repeated owner
  // is still eligible once every distinct owner in that family has been offered.
  const selected = new Map<string, T>()
  const takenOwners = new Map<string, Set<string>>()
  const takenPlatforms = new Map<string, Set<string>>()
  const takeOne = (family: string, uniqueOwner: boolean, uniquePlatform: boolean) => {
    const rows = buckets.get(family) ?? []
    const owners = takenOwners.get(family) ?? new Set<string>()
    const platforms = takenPlatforms.get(family) ?? new Set<string>()
    takenOwners.set(family, owners)
    takenPlatforms.set(family, platforms)
    for (const row of rows) {
      if (selected.has(row.source_id)) continue
      if (uniqueOwner && owners.has(String(row.owner))) continue
      if (uniquePlatform && platforms.has(platformOf(row))) continue
      selected.set(row.source_id, row)
      owners.add(String(row.owner))
      platforms.add(platformOf(row))
      return true
    }
    return false
  }
  for (const phase of [{ uniqueOwner: true, uniquePlatform: true },
    { uniqueOwner: true, uniquePlatform: false }, { uniqueOwner: false, uniquePlatform: false }]) {
    for (let round = 0; selected.size < limit; round++) {
      let progressed = false
      for (const family of ordered) {
        if (selected.size >= limit) break
        const taken = [...selected.values()].filter(x => familyOf(x) === family).length
        if (taken >= quota[family]) continue
        const marketFamily = family === 'public_post' || family === 'market_study'
        if (takeOne(family, phase.uniqueOwner && marketFamily, phase.uniquePlatform && family === 'public_post')) progressed = true
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
    method: 'paginated-family-platform-recent-engagement-measured-distinct-author-round-robin-v5',
    page_size: Math.max(1, pageSize), pages_read: pages.length,
    population_total: population.length, usable_population: usable.length, without_usable_body: withoutUsableBody,
    selected_count: selected.size, omitted_count: population.length - selected.size,
    family_quotas: Object.fromEntries(ordered.map(family => [family, quota[family]])),
    selected_count_by_family: selectedByFamily, usable_count_by_family: usableByFamily,
    selected_count_by_platform: Object.fromEntries([...selected.values()].reduce((counts, source) => {
      const platform = platformOf(source)
      counts.set(platform, (counts.get(platform) ?? 0) + 1)
      return counts
    }, new Map<string, number>())),
    omitted_count_by_family: Object.fromEntries(Object.entries(omittedByFamily).map(([k, v]) => [k, v.length])),
    omitted_source_ids_by_family: omittedByFamily,
    distinct_owners_selected: new Set([...selected.values()].map(x => String(x.owner))).size,
  }
  return { selected: [...selected.values()], method: coverage.method,
    omitted: population.length - selected.size, withoutUsableBody, coverage }
}
