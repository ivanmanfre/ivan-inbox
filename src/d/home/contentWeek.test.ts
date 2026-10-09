import { expect, it, vi } from 'vitest'
import type { ContentDraft } from '../../lib/content'
import { contentWeek, nextWeekDays } from '../lanes/glance/model'
import { fetchHomeWeekRows, homeWeeks } from './contentWeek'

const sdk = vi.hoisted(() => ({ calls: [] as Array<{ cols: string; from?: string; to?: string }>, rows: [] as unknown[], members: [] as unknown[] }))
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: () => {
    const call = { cols: '', from: undefined as string | undefined, to: undefined as string | undefined }
    sdk.calls.push(call)
    const q = {
      select: (cols: string) => { call.cols = cols; return q },
      gte: (_: string, from: string) => { call.from = from; return q },
      lt: (_: string, to: string) => { call.to = to; return q },
      order: () => q,
      in: () => q,
      is: () => q,
      eq: () => q,
      range: async () => ({ data: sdk.rows, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: sdk.members, error: null }).then(resolve),
    }
    return q
  },
} }))

const NOW = Date.parse('2026-10-09T12:00:00Z')
const draft = (id: string, client_id: string | null, scheduled_at: string, status = 'scheduled'): ContentDraft => ({
  id, client_id, status, scheduled_at, published_at: null, board_visible: true,
  cb34_p2_member: false, title: id, topic: null, post_body: '', taxonomy: null, updated_at: scheduled_at,
} as ContentDraft)

it('Home asks the guarded view for one slim dated page and keeps all three seat rules', async () => {
  sdk.calls = []
  sdk.members = []
  sdk.rows = [
    draft('ivan', null, '2026-10-12T12:00:00Z'),
    draft('rise', 'risedtc', '2026-10-12T12:00:00Z'),
    draft('arch', 'arch', '2026-10-12T12:00:00Z'),
    draft('planned', null, '2026-10-13T12:00:00Z', 'approved'),
    { ...draft('deleted', null, '2026-10-14T12:00:00Z'), taxonomy: { deleted_by_operator: true } },
  ]
  const rows = await fetchHomeWeekRows(NOW)
  expect(rows.map(r => r.id)).toEqual(['ivan', 'rise', 'arch', 'planned'])
  expect(sdk.calls).toHaveLength(1)
  expect(sdk.calls[0].cols).toContain('cb34_p2_member')
  expect(sdk.calls[0].cols).not.toContain('agent_log')
  expect(sdk.calls[0].from).toBe('2026-10-11T00:00:00.000Z')
  expect(sdk.calls[0].to).toBe('2026-10-18T00:00:00.000Z')
  const weeks = homeWeeks(rows, NOW)
  const days = nextWeekDays(NOW)
  for (const seat of ['ivan', 'risedtc', 'arch'] as const) {
    expect(weeks[seat]).toEqual(contentWeek(rows.filter(r => r.client_id === seat || seat === 'ivan' && r.client_id == null), seat, days))
  }
  expect(weeks.ivan.n).toBe(1)
  expect(weeks.ivan.days[1].planned).toBe(true)
})

it('rechecks guarded member IDs and omits a row that vanished on recheck', async () => {
  sdk.calls = []
  sdk.rows = [{ ...draft('member', null, '2026-10-12T12:00:00Z'), cb34_p2_member: true }]
  sdk.members = []
  expect(await fetchHomeWeekRows(NOW)).toEqual([])
  expect(sdk.calls.map(c => c.cols)).toEqual([expect.stringContaining('scheduled_at'), '*'])
})
