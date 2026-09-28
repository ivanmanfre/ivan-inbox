import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; family: string; incident_key: string | null; group_key: string | null; created_at: string; read_at: string | null; expires_at: string | null }
const pages: Row[][] = []
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

const NOW = '2026-09-28T12:00:00Z'
const at = (minutesAgo: number) => new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString()
function row(id: string, minutesAgo: number, over: Partial<Row> = {}): Row {
  return { id, family: 'content_board_activity', incident_key: null, group_key: null,
    created_at: at(minutesAgo), read_at: null, expires_at: null, ...over }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); pages.length = 0; filters.length = 0 })
afterEach(() => vi.useRealTimers())

describe('bell counts and exact expiry', () => {
  it('leaves a large old unread backlog out of the badge while retaining every open row', async () => {
    const future = at(-1)
    pages.push(Array.from({ length: 1000 }, (_, i) => row(`old${i}`, 241)))
    pages.push([row('read-late-page', 1, { family: 'system_infra_alarm', read_at: at(0), expires_at: future })])
    expect(await fetchBellCounts()).toEqual({ unreadGroups: 0, open: 1001, nextExpiryAt: future })
    expect(filters).toHaveLength(2)
    expect(filters.every(f => f.includes('is:dismissed_at') && f.some(x => x.startsWith('or:expires_at.is.null,expires_at.gt.')))).toBe(true)
  })

  it('counts recent routine and important rows, grouping distinct incidents separately', async () => {
    pages.push([
      row('config', 5, { family: 'system_infra_alarm', incident_key: 'rise:w:config:failed:attention', group_key: 'workflow' }),
      row('auth', 5, { family: 'system_infra_alarm', incident_key: 'rise:w:auth:failed:attention', group_key: 'workflow' }),
      row('routine-a', 10, { group_key: 'board' }),
      row('routine-b', 10, { group_key: 'board' }),
      row('seen', 15, { family: 'page_open_notice' }),
    ])
    expect(await fetchBellCounts()).toEqual({ unreadGroups: 4, open: 5, nextExpiryAt: at(-225) })
  })

  it('uses created_at, not repeat activity, and drops an alert at the exact four-hour boundary', async () => {
    pages.push([row('boundary', 240), row('retained', 239, { group_key: 'x' }),
      row('repeated', 250, { group_key: 'x' })])
    expect(await fetchBellCounts()).toEqual({ unreadGroups: 1, open: 3, nextExpiryAt: at(-1) })
  })

  it('excludes read rows from the badge but retains their expiry deadline', async () => {
    pages.push([row('unread', 20), row('read', 1, { read_at: at(0), expires_at: at(-2) })])
    expect(await fetchBellCounts()).toEqual({ unreadGroups: 1, open: 2, nextExpiryAt: at(-2) })
  })
})
