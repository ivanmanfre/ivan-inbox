import { describe, expect, it } from 'vitest'
import { buildWeeklySlotManifest, mergeWeeklyPolicy, validateWeeklyPolicy } from './editorialWeeklyPolicy'

const base = {
  schema_version: 1 as const, status: 'adopted' as const, weekly_total: 3,
  allocation: { unit: 'count' as const, values: { reach: 1, buyer: 2 } },
  format_preferences: [{ format: 'text', max_slots: 3 }],
  topic_priorities: ['proof'], exclusions: ['unverified claims'], campaign_dates: [],
  target_outcomes: { reach: 'relevant discovery', buyer: 'qualified conversations' },
  conflict_priority: ['reach', 'buyer'],
  evidence: { source_ids: ['source-1'], observed_at: '2026-09-22', rationale: 'buyer need' },
}

describe('versioned weekly policy', () => {
  it('preserves unknown legacy direction fields when one policy is edited', () => {
    const legacy = { audience: { who: 'buyers' }, obscure: { nested: [1, { x: true }] } }
    const merged = mergeWeeklyPolicy(legacy, base)
    expect(merged.audience).toEqual(legacy.audience)
    expect(merged.obscure).toEqual(legacy.obscure)
    expect(legacy).not.toHaveProperty('weekly_policy')
  })

  it('roundtrips editable audience, offer and positioning without changing legacy strategy', () => {
    const policy = { ...base, objective: 'Qualified buyer conversations', audience: 'DTC founders', offer: 'Two model structures', positioning: 'Financial health with creative and paid media' }
    expect(validateWeeklyPolicy(policy)).toEqual([])
    const legacy = { statement: 'Retain unknown context', custom: { unknown: true } }
    expect(mergeWeeklyPolicy(legacy, policy)).toMatchObject({ ...legacy, weekly_policy: policy })
    expect(validateWeeklyPolicy({ ...policy, offer: 7 })).toContain('offer: expected text')
  })

  it('allocates a paused week to zero slots and refuses active proof credit', () => {
    const manifest = buildWeeklySlotManifest('ivan', 'v0', '2026-09-21', {
      weekly_policy: { ...base, weekly_total: 0, allocation: { unit: 'count', values: {} } },
    })
    expect(manifest.slots).toEqual([])
    expect(manifest.active_client_proof_credit).toBe(false)
  })

  it('binds three conversion slots to client, version and week', () => {
    const a = buildWeeklySlotManifest('ivan', 'v3', '2026-09-21', { weekly_policy: base })
    const b = buildWeeklySlotManifest('ivan', 'v4', '2026-09-21', { weekly_policy: base })
    const c = buildWeeklySlotManifest('arch', 'v3', '2026-09-21', { weekly_policy: base })
    expect(a.slots.map(x => x.purpose)).toEqual(['reach', 'buyer', 'buyer'])
    expect(a.slots.map(x => x.format)).toEqual(['text', 'text', 'text'])
    expect(a.slots[0].slot_id).not.toBe(b.slots[0].slot_id)
    expect(a.slots[0].slot_id).not.toBe(c.slots[0].slot_id)
    expect(a.slots[0].slot_id).toBe(buildWeeklySlotManifest('ivan', 'v3', '2026-09-21', { weekly_policy: base }).slots[0].slot_id)
  })

  it('rounds proportions by largest remainder with stable ties for six slots', () => {
    const policy = { ...base, weekly_total: 6, allocation: { unit: 'proportion' as const, values: { reach: 0.6, consideration: 0.2, buyer: 0.2 } }, format_preferences: [{ format: 'text', max_slots: 6 }], target_outcomes: { ...base.target_outcomes, consideration: 'informed buyers' } }
    const manifest = buildWeeklySlotManifest('ivan', 'v6', '2026-09-21', { weekly_policy: policy })
    expect(manifest.purpose_counts).toEqual({ reach: 4, consideration: 1, buyer: 1 })
  })

  it('keeps format separate from purpose and does not count a reel as an extra slot', () => {
    const policy = { ...base, format_preferences: [{ format: 'reel', max_slots: 1, purposes: ['reach'] }, { format: 'text', max_slots: 2 }] }
    const manifest = buildWeeklySlotManifest('ivan', 'v3', '2026-09-21', { weekly_policy: policy })
    expect(manifest.slots).toHaveLength(3)
    expect(manifest.slots[0]).toMatchObject({ purpose: 'reach', format: 'reel' })
  })
  it('preserves explicit format order for repeated purposes while retaining matching fallback', () => {
    const policy = { ...base, allocation: { unit: 'count' as const, values: { reach: 2, buyer: 1 } },
      format_preferences: [
      { format: 'single_image', max_slots: 1, purposes: ['reach'] },
      { format: 'video', max_slots: 1, purposes: ['reach'] },
      { format: 'text', max_slots: 1, purposes: ['buyer'] },
    ] }
    const manifest = buildWeeklySlotManifest('ivan', 'v3', '2026-09-21', { weekly_policy: policy })
    expect(manifest.slots.map(x => x.format)).toEqual(['single_image', 'video', 'text'])
  })

  it('rejects count mismatch and impossible format capacity', () => {
    expect(validateWeeklyPolicy({ ...base, weekly_total: 4 })).toContain('allocation.values: counts must sum to weekly_total')
    expect(validateWeeklyPolicy({ ...base, format_preferences: [{ format: 'reel', max_slots: 1 }] })).toContain('format_preferences: capacity cannot fill 3 slots')
  })

  it('requires an outcome for every active purpose and orders slots by adopted priority', () => {
    expect(validateWeeklyPolicy({ ...base, target_outcomes: { reach: 'discovery' } }))
      .toContain('target_outcomes.buyer: required for an active purpose')
    const manifest = buildWeeklySlotManifest('ivan', 'priority', '2026-09-21', {
      weekly_policy: { ...base, conflict_priority: ['buyer', 'reach'] },
    })
    expect(manifest.slots.map(x => x.purpose)).toEqual(['buyer', 'buyer', 'reach'])
  })

  it('applies a week override only through its expiry, leaving the base intact', () => {
    const policy = { ...base, week_override: { week_start: '2026-09-21', expires_after: '2026-09-27', weekly_total: 1, allocation: { unit: 'count' as const, values: { buyer: 1 } } } }
    expect(buildWeeklySlotManifest('ivan', 'v3', '2026-09-21', { weekly_policy: policy }).slots).toHaveLength(1)
    expect(buildWeeklySlotManifest('ivan', 'v3', '2026-09-28', { weekly_policy: policy }).slots).toHaveLength(3)
    expect(policy.weekly_total).toBe(3)
  })

  it('rejects malformed override capacity and undated evidence metadata', () => {
    expect(validateWeeklyPolicy({ ...base, week_override: {
      week_start: '2026-09-21', expires_after: '2026-09-27', weekly_total: 1,
      allocation: { unit: 'count', values: { buyer: 1 } }, format_preferences: [{ format: 'reel', max_slots: -1 }],
    } })).toContain('week_override.format_preferences.0: expected format, nonnegative capacity and optional purposes')
    expect(validateWeeklyPolicy({ ...base, evidence: { source_ids: [1], observed_at: '', rationale: '' } }))
      .toContain('evidence: source IDs, observed date and rationale are required')
  })

  it('supports the historical five-slot direction without a weekly policy', () => {
    const manifest = buildWeeklySlotManifest('ivan', 'old', '2026-09-21', { audience: 'operators' })
    expect(manifest.contract_version).toBe(0)
    expect(manifest.slots).toHaveLength(5)
  })
})
