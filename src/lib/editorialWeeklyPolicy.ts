import { EditorialContractError, isEditorialClientId } from './editorialTypes.ts'
import type { EditorialClientId } from './editorialTypes.ts'

export type PurposeAllocation = { unit: 'count' | 'proportion'; values: Record<string, number> }
export type FormatPreference = { format: string; max_slots: number; purposes?: string[]; route_ready?: boolean; asset_gap?: string }
export type WeeklyPolicy = {
  schema_version: 1
  status: 'proposed' | 'adopted'
  weekly_total: number
  allocation: PurposeAllocation
  format_preferences: FormatPreference[]
  topic_priorities: string[]
  exclusions: string[]
  campaign_dates: string[]
  target_outcomes: Record<string, string>
  conflict_priority: string[]
  evidence: { source_ids: string[]; observed_at: string; rationale: string }
  objective?: string
  audience?: string
  offer?: string
  positioning?: string
  audience_maturity?: { state: string; source_ids: string[]; reviewed_at: string }
  timezone?: string
  active_period?: { starts_on: string; ends_on: string | null }
  campaign?: { name: string; starts_on: string; ends_on: string }
  minimum_posts?: number
  maximum_posts?: number
  personal_allowance?: number
  client_holds?: string[]
  proposer?: string
  editor?: string
  reason?: string
  week_override?: {
    week_start: string
    expires_after: string
    weekly_total: number
    allocation: PurposeAllocation
    format_preferences?: FormatPreference[]
  }
}

export type WeeklySlot = {
  slot_id: string
  ordinal: number
  purpose: string
  format: string
  client_id: EditorialClientId
  direction_version: string
  week_start: string
  route_ready: boolean
  asset_gap: string | null
}
export type WeeklySlotManifest = {
  contract_version: 0 | 1
  client_id: EditorialClientId
  direction_version: string
  week_start: string
  policy_status: 'legacy' | 'proposed' | 'adopted'
  active_client_proof_credit: boolean
  purpose_counts: Record<string, number>
  slots: WeeklySlot[]
  /** Preview is empty; the evidence reviewer fills one immutable record per slot before freeze. */
  slot_requirements: WeeklySlotRequirements[]
}

export type WeeklySlotRequirements = {
  slot_id: string
  source_refs: { source_id: string; seen_version: number; snapshot_hash: string }[]
  mandatory_facts: string[]
  applicable_rule_refs: string[]
  permission_boundaries: string[]
  comparisons: string[]
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function allocationErrors(allocation: unknown, total: number, prefix: string): string[] {
  if (!object(allocation) || !['count', 'proportion'].includes(String(allocation.unit)) || !object(allocation.values))
    return [`${prefix}: expected count or proportion values`]
  const entries = Object.entries(allocation.values)
  if (total > 0 && !entries.length) return [`${prefix}.values: at least one purpose is required`]
  const errors: string[] = []
  for (const [purpose, value] of entries) {
    if (!purpose.trim() || !Number.isFinite(value) || Number(value) < 0 ||
        (allocation.unit === 'count' && !Number.isInteger(value)))
      errors.push(`${prefix}.values.${purpose}: expected nonnegative ${allocation.unit === 'count' ? 'integer' : 'number'}`)
  }
  if (!errors.length && allocation.unit === 'count' && entries.reduce((n, [, v]) => n + Number(v), 0) !== total)
    errors.push(`${prefix}.values: counts must sum to weekly_total`)
  if (!errors.length && allocation.unit === 'proportion' && total > 0 && entries.reduce((n, [, v]) => n + Number(v), 0) <= 0)
    errors.push(`${prefix}.values: proportions need positive weight`)
  return errors
}

function counts(allocation: PurposeAllocation, total: number): Record<string, number> {
  if (allocation.unit === 'count') return Object.fromEntries(Object.entries(allocation.values).filter(([, n]) => n > 0))
  const names = Object.keys(allocation.values).sort()
  const weight = names.reduce((n, name) => n + allocation.values[name], 0)
  const result: Record<string, number> = {}
  if (total === 0) return result
  const fractions = names.map(name => {
    const exact = allocation.values[name] / weight * total
    result[name] = Math.floor(exact)
    return { name, remainder: exact - result[name] }
  }).sort((a, b) => b.remainder - a.remainder || a.name.localeCompare(b.name))
  let remaining = total - Object.values(result).reduce((a, b) => a + b, 0)
  for (const item of fractions) {
    if (remaining-- <= 0) break
    result[item.name]++
  }
  return Object.fromEntries(Object.entries(result).filter(([, n]) => n > 0))
}

function assignFormats(purposes: string[], preferences: FormatPreference[]): number[] | null {
  if (!purposes.length) return []
  const prefs = preferences.length ? preferences : [{ format: 'text', max_slots: purposes.length }]
  const occupants = prefs.map(() => [] as number[])
  const assigned = new Array<number>(purposes.length).fill(-1)
  const place = (slot: number, seen: Set<number>): boolean => {
    // Keep the caller's explicit preference order when capacity is available.
    // Reassignment is only needed if all compatible preferences are full.
    for (let p = 0; p < prefs.length; p++) {
      if (seen.has(p) || (prefs[p].purposes?.length && !prefs[p].purposes!.includes(purposes[slot]))) continue
      if (occupants[p].length < prefs[p].max_slots) {
        occupants[p].push(slot); assigned[slot] = p; return true
      }
    }
    for (let p = 0; p < prefs.length; p++) {
      if (seen.has(p) || (prefs[p].purposes?.length && !prefs[p].purposes!.includes(purposes[slot]))) continue
      seen.add(p)
      for (const prior of [...occupants[p]]) {
        if (place(prior, seen)) {
          occupants[p].splice(occupants[p].indexOf(prior), 1)
          occupants[p].push(slot); assigned[slot] = p; return true
        }
      }
    }
    return false
  }
  for (let i = 0; i < purposes.length; i++) if (!place(i, new Set())) return null
  return assigned
}

function purposeSequence(allocation: PurposeAllocation, total: number, priority: string[]): string[] {
  return Object.entries(counts(allocation, total))
    .sort(([a], [b]) => (priority.indexOf(a) < 0 ? priority.length : priority.indexOf(a)) -
      (priority.indexOf(b) < 0 ? priority.length : priority.indexOf(b)) || a.localeCompare(b))
    .flatMap(([purpose, n]) => Array(n).fill(purpose) as string[])
}

export function validateWeeklyPolicy(value: unknown): string[] {
  if (!object(value)) return ['weekly_policy: expected object']
  const errors: string[] = []
  if (value.schema_version !== 1) errors.push('schema_version: expected 1')
  if (value.status !== 'proposed' && value.status !== 'adopted') errors.push('status: expected proposed or adopted')
  const total = value.weekly_total
  if (!Number.isSafeInteger(total) || Number(total) < 0) errors.push('weekly_total: expected nonnegative integer')
  if (!errors.some(x => x.startsWith('weekly_total'))) errors.push(...allocationErrors(value.allocation, Number(total), 'allocation'))
  if (!Array.isArray(value.format_preferences)) errors.push('format_preferences: expected array')
  else {
    for (const [i, item] of value.format_preferences.entries()) {
      if (!object(item) || typeof item.format !== 'string' || !item.format.trim() || !Number.isSafeInteger(item.max_slots) || Number(item.max_slots) < 0 ||
          (item.purposes !== undefined && (!Array.isArray(item.purposes) || item.purposes.some(x => typeof x !== 'string' || !x.trim()))))
        errors.push(`format_preferences.${i}: expected format, nonnegative capacity and optional purposes`)
    }
  }
  for (const field of ['topic_priorities', 'exclusions', 'campaign_dates'] as const) {
    if (!Array.isArray(value[field]) || value[field].some(x => typeof x !== 'string')) errors.push(`${field}: expected text array`)
  }
  if (!object(value.target_outcomes)) errors.push('target_outcomes: expected purpose outcomes')
  if (!Array.isArray(value.conflict_priority) || value.conflict_priority.some(x => typeof x !== 'string' || !x.trim()))
    errors.push('conflict_priority: expected purpose order')
  if (!object(value.evidence) || !Array.isArray(value.evidence.source_ids) ||
      value.evidence.source_ids.some(x => typeof x !== 'string' || !x.trim()) ||
      typeof value.evidence.observed_at !== 'string' || !value.evidence.observed_at.trim() ||
      typeof value.evidence.rationale !== 'string' || !value.evidence.rationale.trim())
    errors.push('evidence: source IDs, observed date and rationale are required')
  for (const field of ['objective', 'audience', 'offer', 'positioning', 'timezone', 'proposer', 'editor', 'reason'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') errors.push(`${field}: expected text`)
  }
  for (const field of ['minimum_posts', 'maximum_posts', 'personal_allowance'] as const) {
    if (value[field] !== undefined && (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0))
      errors.push(`${field}: expected nonnegative integer`)
  }
  if (typeof value.minimum_posts === 'number' && typeof total === 'number' && total < value.minimum_posts) errors.push('weekly_total: below minimum_posts')
  if (typeof value.maximum_posts === 'number' && typeof total === 'number' && total > value.maximum_posts) errors.push('weekly_total: above maximum_posts')
  if (typeof value.minimum_posts === 'number' && typeof value.maximum_posts === 'number' && value.minimum_posts > value.maximum_posts)
    errors.push('minimum_posts: cannot exceed maximum_posts')
  if (value.client_holds !== undefined && (!Array.isArray(value.client_holds) || value.client_holds.some(x => typeof x !== 'string')))
    errors.push('client_holds: expected text array')
  if (value.active_period !== undefined && (!object(value.active_period) || !date(value.active_period.starts_on) ||
      (value.active_period.ends_on !== null && !date(value.active_period.ends_on))))
    errors.push('active_period: valid start and end are required')
  if (value.campaign !== undefined && (!object(value.campaign) || typeof value.campaign.name !== 'string' ||
      !date(value.campaign.starts_on) || !date(value.campaign.ends_on)))
    errors.push('campaign: name, start and end are required')
  if (value.week_override !== undefined) {
    const override = value.week_override
    if (!object(override) || !date(override.week_start) || !date(override.expires_after) || override.expires_after < override.week_start ||
        !Number.isSafeInteger(override.weekly_total) || Number(override.weekly_total) < 0)
      errors.push('week_override: valid start, expiry and total are required')
    else errors.push(...allocationErrors(override.allocation, Number(override.weekly_total), 'week_override.allocation'))
    if (object(override) && override.format_preferences !== undefined) {
      if (!Array.isArray(override.format_preferences)) errors.push('week_override.format_preferences: expected array')
      else for (const [i, item] of override.format_preferences.entries()) {
        if (!object(item) || typeof item.format !== 'string' || !item.format.trim() || !Number.isSafeInteger(item.max_slots) || Number(item.max_slots) < 0 ||
            (item.purposes !== undefined && (!Array.isArray(item.purposes) || item.purposes.some(x => typeof x !== 'string' || !x.trim()))))
          errors.push(`week_override.format_preferences.${i}: expected format, nonnegative capacity and optional purposes`)
      }
    }
  }
  if (errors.length) return errors
  const policy = value as WeeklyPolicy
  const activePurposes = new Set([...Object.keys(counts(policy.allocation, policy.weekly_total)),
    ...Object.keys(policy.week_override ? counts(policy.week_override.allocation, policy.week_override.weekly_total) : {})])
  for (const purpose of activePurposes) {
    if (typeof policy.target_outcomes[purpose] !== 'string' || !policy.target_outcomes[purpose].trim())
      errors.push(`target_outcomes.${purpose}: required for an active purpose`)
  }
  const basePurposes = purposeSequence(policy.allocation, policy.weekly_total, policy.conflict_priority)
  if (!assignFormats(basePurposes, policy.format_preferences)) errors.push(`format_preferences: capacity cannot fill ${policy.weekly_total} slots`)
  if (policy.week_override) {
    const override = policy.week_override
    if (!assignFormats(purposeSequence(override.allocation, override.weekly_total, policy.conflict_priority), override.format_preferences ?? policy.format_preferences))
      errors.push(`week_override.format_preferences: capacity cannot fill ${override.weekly_total} slots`)
  }
  return errors
}

export function mergeWeeklyPolicy(direction: Record<string, unknown>, policy: WeeklyPolicy): Record<string, unknown> {
  const errors = validateWeeklyPolicy(policy)
  if (errors.length) throw new EditorialContractError('invalid_argument', 'Invalid weekly policy.', errors.join('; '))
  return { ...direction, weekly_policy: policy }
}

export function getEffectiveWeeklyPolicy(direction: Record<string, unknown>, weekStart: string): WeeklyPolicy | null {
  const policy = direction.weekly_policy
  if (policy === undefined) return null
  const errors = validateWeeklyPolicy(policy)
  if (errors.length) throw new EditorialContractError('invalid_argument', 'Invalid weekly policy.', errors.join('; '))
  const typed = policy as WeeklyPolicy
  const override = typed.week_override
  return override && weekStart >= override.week_start && weekStart <= override.expires_after
    ? { ...typed, weekly_total: override.weekly_total, allocation: override.allocation,
      format_preferences: override.format_preferences ?? typed.format_preferences }
    : typed
}

export function buildWeeklySlotManifest(clientId: string, directionVersion: string, weekStart: string,
  direction: Record<string, unknown>): WeeklySlotManifest {
  if (!isEditorialClientId(clientId)) throw new EditorialContractError('unknown_client', 'Unknown editorial client.', clientId)
  if (!directionVersion.trim() || !date(weekStart)) throw new EditorialContractError('invalid_argument', 'Direction version and valid week start are required.')
  const policy = getEffectiveWeeklyPolicy(direction, weekStart)
  const purposes = policy ? purposeSequence(policy.allocation, policy.weekly_total, policy.conflict_priority) : Array(5).fill('legacy') as string[]
  const preferences = policy?.format_preferences ?? []
  const assignments = assignFormats(purposes, preferences)
  if (!assignments) throw new EditorialContractError('invalid_argument', 'Format capacity cannot fill this week.')
  const slots = purposes.map((purpose, index): WeeklySlot => {
    const preference = preferences[assignments[index]] ?? { format: 'text', max_slots: purposes.length }
    return {
      slot_id: `weekly:${encodeURIComponent(clientId)}:${encodeURIComponent(directionVersion)}:${weekStart}:${index + 1}`,
      ordinal: index + 1, purpose, format: preference.format, client_id: clientId,
      direction_version: directionVersion, week_start: weekStart,
      route_ready: preference.route_ready === true,
      asset_gap: preference.asset_gap ?? null,
    }
  })
  return { contract_version: policy ? 1 : 0, client_id: clientId, direction_version: directionVersion,
    week_start: weekStart, policy_status: policy?.status ?? 'legacy', active_client_proof_credit: slots.length > 0,
    purpose_counts: policy ? counts(policy.allocation, policy.weekly_total) : { legacy: 5 }, slots, slot_requirements: [] }
}
