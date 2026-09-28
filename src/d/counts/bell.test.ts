import { beforeEach, describe, expect, it, vi } from 'vitest'

const pages: Array<Array<{ id: string; family: string; incident_key: string | null; group_key: string | null; read_at: string | null; expires_at: string | null }>> = []
const filters: string[][] = []
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => {
    const f: string[] = []; filters.push(f)
    const q = {
      select: () => q,
      is: (key: string) => { f.push(`is:${key}`); return q },
      or: (value: string) => { f.push(`or:${value}`); return q },
      order: () => q,
      range: async () => ({ data: pages.shift() ?? [], error: null }),
    }
    return q
  } },
}))
const { fetchBellCounts } = await import('./bell')

beforeEach(() => { pages.length = 0; filters.length = 0 })

describe('bell counts and exact expiry', () => {
  it('uses all active pages, including read rows and beyond feed cap, for next expiry', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    pages.push(Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, family: 'claude_turn', incident_key: null, group_key: null, read_at: null, expires_at: null })))
    pages.push([{ id: 'read-late-page', family: 'system_infra_alarm', incident_key: 'rise:w:step:failed:attention', group_key: null, read_at: '2026-09-28T09:00:00Z', expires_at: future }])
    expect(await fetchBellCounts()).toEqual({ unreadGroups: 1000, open: 1001, nextExpiryAt: future })
    expect(filters).toHaveLength(2)
    expect(filters.every(f => f.includes('is:dismissed_at') && f.some(x => x.startsWith('or:expires_at.is.null,expires_at.gt.')))).toBe(true)
  })

  it('counts distinct important conditions despite a shared producer group key', async () => {
    pages.push([
      { id: 'config', family: 'system_infra_alarm', incident_key: 'rise:w:config:failed:attention', group_key: 'workflow', read_at: null, expires_at: null },
      { id: 'auth', family: 'system_infra_alarm', incident_key: 'rise:w:auth:failed:attention', group_key: 'workflow', read_at: null, expires_at: null },
      { id: 'routine-a', family: 'content_board_activity', incident_key: null, group_key: 'board', read_at: null, expires_at: null },
      { id: 'routine-b', family: 'content_board_activity', incident_key: null, group_key: 'board', read_at: null, expires_at: null },
    ])
    expect(await fetchBellCounts()).toEqual({ unreadGroups: 3, open: 4, nextExpiryAt: null })
  })
})
