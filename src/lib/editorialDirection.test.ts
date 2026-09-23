import { describe, expect, it } from 'vitest'
import { adoptEditorialWeeklyPolicy, suggestEditorialWeeklyPolicy } from './editorialDirection'
import type { EditorialClient } from './editorialTypes'

const policy = {
  schema_version: 1 as const, status: 'proposed' as const, weekly_total: 0,
  allocation: { unit: 'count' as const, values: {} }, format_preferences: [],
  topic_priorities: [], exclusions: [], campaign_dates: [],
  target_outcomes: {}, conflict_priority: [],
  evidence: { source_ids: [], observed_at: '2026-09-23', rationale: 'pause' },
}

describe('weekly policy direction adapter', () => {
  it('merges an adopted policy into the observed full direction payload', async () => {
    const calls: { fn: string; params: Record<string, unknown> }[] = []
    const client: EditorialClient = { rpc: async (fn, params) => {
      calls.push({ fn, params })
      if (fn === 'editorial_read_direction') return { data: { client_id: 'ivan', active_version: 'old', status: 'active',
        audience: { role: 'founders' }, direction: { audience: { role: 'founders' }, custom: { keep: true } },
        source: 'seed', updated_at: '2026-09-22' }, error: null }
      return { data: { state: 'active', active_version: 'new' }, error: null }
    } }
    const result = await adoptEditorialWeeklyPolicy(client, 'ivan', 'old', policy, 'operator', 'weekly edit', 'request-1')
    expect(result.state).toBe('active')
    expect(calls[1].params.p_payload).toEqual({ audience: { role: 'founders' }, custom: { keep: true },
      weekly_policy: { ...policy, status: 'adopted' } })
    expect(calls[1].params.p_expected_version).toBe('old')
  })

  it('returns a conflict without a write when the observed version is stale', async () => {
    let writes = 0
    const client: EditorialClient = { rpc: async (fn) => {
      if (fn !== 'editorial_read_direction') writes++
      return { data: { client_id: 'ivan', active_version: 'new', direction: {}, status: 'active' }, error: null }
    } }
    expect(await adoptEditorialWeeklyPolicy(client, 'ivan', 'old', policy, 'operator', 'edit', 'request-2'))
      .toMatchObject({ state: 'conflict', observed_version: 'new' })
    expect(writes).toBe(0)
  })

  it('sends a suggestion to a separate append-only RPC', async () => {
    const names: string[] = []
    const client: EditorialClient = { rpc: async (fn) => {
      names.push(fn)
      return { data: { state: 'recorded', suggestion_id: 's1' }, error: null }
    } }
    await suggestEditorialWeeklyPolicy(client, 'ivan', 'v1', policy, 'new call', 'request-3')
    expect(names).toEqual(['editorial_suggest_weekly_policy'])
  })
})
