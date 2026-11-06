import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; family: string; severity: string | null; title: string | null; incident_key: string | null; group_key: string | null; created_at: string; expires_at?: string | null }
// One answer per query, in call order: [badge rows, next expiry].
const answers: unknown[][] = []
const filters: string[][] = []
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => {
    const f: string[] = []; filters.push(f)
    const answer = answers.shift() ?? []
    const q = {
      select: (cols: string) => { f.push(`select:${cols}`); return q },
      is: (key: string, v: unknown) => { f.push(`is:${key}:${v}`); return q },
      not: (key: string, op: string, value: string) => { f.push(`not:${key}:${op}:${value}`); return q },
      or: (value: string) => { f.push(`or:${value}`); return q },
      gt: (key: string) => { f.push(`gt:${key}`); return q },
      lte: (key: string) => { f.push(`lte:${key}`); return q },
      order: () => q,
      limit: async (n: number) => { f.push(`limit:${n}`); return { data: answer, error: null } },
      range: () => { throw new Error('the bell must never page through the open pile') },
    }
    return q
  } },
}))
const { fetchBellCounts } = await import('./bell')

const NOW = '2026-09-28T12:00:00Z'
const at = (minutesAgo: number) => new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString()
function row(id: string, minutesAgo: number, over: Partial<Row> = {}): Row {
  return { id, family: 'reply_draft_pending', severity: 'attention', title: 'Warm reply drafted for X:', incident_key: null, group_key: null,
    created_at: at(minutesAgo), ...over }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); answers.length = 0; filters.length = 0 })
afterEach(() => vi.useRealTimers())

describe('bell counts', () => {
  it('reads two bounded queries: unread rows in the badge window, and the single next expiry', async () => {
    await fetchBellCounts()
    expect(filters).toHaveLength(2)
    const [badge, expiry] = filters
    expect(badge).toEqual(expect.arrayContaining(['is:dismissed_at:null', 'is:read_at:null', 'gt:created_at', 'lte:created_at', 'limit:500']))
    const activity = badge.find(f => f.startsWith('or:severity.eq.error,and(family.not.in.('))!
    expect(activity).toContain('title.not.like.DM1 wins auto-queued for*')
    expect(activity).toContain('outreach_engine_ops')
    expect(activity).toContain('content_board_activity')
    expect(activity).not.toContain('reply_draft_pending')
    expect(activity).not.toContain('claude_turn')
    expect(badge.some(f => f.startsWith('not:family:in:') && f.includes('system_watchdog_digest'))).toBe(true)
    expect(badge.some(f => f.startsWith('not:family:in:') && f.includes('send_failed_alert'))).toBe(false)
    expect(expiry).toEqual(expect.arrayContaining(['is:dismissed_at:null', 'gt:expires_at', 'limit:1']))
  })

  it('counts needs-you rows, grouping distinct incidents separately, and leaves Activity out of the badge', async () => {
    answers.push([
      row('config', 5, { family: 'send_failed_alert', severity: 'error', incident_key: 'rise:w:config:failed:attention', group_key: 'workflow' }),
      row('auth', 5, { family: 'send_failed_alert', severity: 'error', incident_key: 'rise:w:auth:failed:attention', group_key: 'workflow' }),
      row('draft-a', 10, { group_key: 'reply_draft_pending:p1' }),
      row('draft-b', 10, { group_key: 'reply_draft_pending:p1' }),
      row('seen', 15, { family: 'page_open_notice', severity: 'attention', title: 'Page opened' }),
      // Activity: a sent log, a published post, a run summary, an auto-queued DM1.
      row('sent', 3, { family: 'outreach_engine_ops', severity: 'info', title: 'Email SENT to sam@example.com' }),
      row('published', 3, { family: 'content_board_activity', severity: 'info', title: 'Post published' }),
      row('summary', 3, { family: 'lane_run_summary', severity: 'info', title: 'Run summary' }),
      row('queued', 3, { severity: 'info', title: 'DM1 wins auto-queued for Patrick McKenna:' }),
    ], [])
    expect(await fetchBellCounts()).toEqual({ unreadGroups: 4, nextExpiryAt: at(-225) })
  })

  it('keeps a broken log on top: an error row is never Activity', async () => {
    answers.push([row('board-error', 5, { family: 'content_board_activity', severity: 'error', title: 'Publish failed' })], [])
    expect((await fetchBellCounts()).unreadGroups).toBe(1)
  })

  it('drops an expired row from the badge', async () => {
    answers.push([row('gone', 5, { expires_at: at(1) }), row('live', 5, { expires_at: at(-10) })], [])
    expect((await fetchBellCounts()).unreadGroups).toBe(1)
  })

  it('takes the earlier of the next row expiry and the next badge-window exit', async () => {
    answers.push([row('unread', 200)], [{ expires_at: at(-2) }])
    expect(await fetchBellCounts()).toEqual({ unreadGroups: 1, nextExpiryAt: at(-2) })
    answers.push([], [])
    expect(await fetchBellCounts()).toEqual({ unreadGroups: 0, nextExpiryAt: null })
  })
})
