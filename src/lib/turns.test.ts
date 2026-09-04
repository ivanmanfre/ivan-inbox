import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Notification } from './turns'

// The query builders are asserted against a recording stub rather than a live
// database, because what these tests are FOR is the shape of the statement: the
// view (never the base table) on every read, the two column grants on every
// write, and the `.in('status', …)` that makes an abort a no-op instead of a 403
// when the turn finished a moment earlier.

type Step = {
  table: string
  op: 'select' | 'update'
  cols?: string
  filters: string[]
  order?: string
  limit?: number
  payload?: Record<string, unknown>
  single?: boolean
}

const steps: Step[] = []
let queue: Array<{ data: unknown; error: unknown }> = []

function chain(step: Step) {
  const settle = () => Promise.resolve(queue.shift() ?? { data: null, error: null })
  const c = {
    select(cols?: string) { step.cols = cols; return c },
    eq(k: string, v: unknown) { step.filters.push(`eq:${k}=${String(v)}`); return c },
    is(k: string, v: unknown) { step.filters.push(`is:${k}=${String(v)}`); return c },
    in(k: string, v: unknown[]) { step.filters.push(`in:${k}=${v.join('|')}`); return c },
    order(k: string, o?: { ascending?: boolean; nullsFirst?: boolean }) {
      step.order = `${k}:${o?.ascending ? 'asc' : 'desc'}${o?.nullsFirst === false ? ':nullslast' : ''}`
      return c
    },
    limit(n: number) { step.limit = n; return c },
    maybeSingle() { step.single = true; return settle() },
    then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) { return settle().then(ok, bad) },
  }
  return c
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select(cols?: string) {
        const step: Step = { table, op: 'select', cols, filters: [] }
        steps.push(step)
        return chain(step)
      },
      update(payload: Record<string, unknown>) {
        const step: Step = { table, op: 'update', filters: [], payload }
        steps.push(step)
        return chain(step)
      },
    }),
  },
}))

const {
  NOTIFICATION_FALLBACK_HASH, NOTIFICATIONS_TABLE, NOTIFICATIONS_VIEW, THREADS_VIEW,
  TURNS_TABLE, TURNS_VIEW, abortTurn, dismissGroup, dismissNotification, getThread, getTurn,
  groupNotifications, isUuid, latestThread, listNotifications, listThreads, listTurns,
  markNotificationsRead, notificationDeepLink,
} = await import('./turns')

beforeEach(() => { steps.length = 0; queue = [] })

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

// ---------------------------------------------------------------------------

describe('isUuid', () => {
  it('accepts a v4 id and refuses a cache that has rotted into something else', () => {
    expect(isUuid(U1)).toBe(true)
    expect(isUuid('null')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid(undefined)).toBe(false)
    expect(isUuid('11111111-1111-4111-8111')).toBe(false)
  })
})

describe('reads go through the views, never the base tables', () => {
  it('listThreads: newest first, archived gone, nulls last', async () => {
    queue.push({ data: [], error: null })
    await listThreads()
    expect(steps[0].table).toBe(THREADS_VIEW)
    expect(steps[0].op).toBe('select')
    expect(steps[0].filters).toContain('is:archived_at=null')
    expect(steps[0].order).toBe('last_turn_at:desc:nullslast')
    expect(steps[0].limit).toBe(30)
    // '*' would start shipping columns nobody chose to send to the browser.
    expect(steps[0].cols).not.toContain('*')
    expect(steps[0].cols).toContain('session_started_at')
    expect(steps[0].cols).toContain('turn_count')
  })

  it('getThread reads one row by id', async () => {
    queue.push({ data: { id: U1 }, error: null })
    await getThread(U1)
    expect(steps[0].table).toBe(THREADS_VIEW)
    expect(steps[0].filters).toEqual([`eq:id=${U1}`])
    expect(steps[0].single).toBe(true)
  })

  it('latestThread is one row of the same ordering, not a client-side sort', async () => {
    queue.push({ data: null, error: null })
    expect(await latestThread()).toBeNull()
    expect(steps[0].table).toBe(THREADS_VIEW)
    expect(steps[0].limit).toBe(1)
    expect(steps[0].single).toBe(true)
    expect(steps[0].filters).toContain('is:archived_at=null')
  })

  it('listTurns reads a transcript oldest first and bounded', async () => {
    queue.push({ data: [], error: null })
    await listTurns(U1)
    expect(steps[0].table).toBe(TURNS_VIEW)
    expect(steps[0].filters).toEqual([`eq:thread_id=${U1}`])
    expect(steps[0].order).toBe('created_at:asc')
    expect(steps[0].limit).toBe(200)
  })

  it('getTurn reads the ROW that is the truth after a stream is lost', async () => {
    queue.push({ data: { id: U1, status: 'done' }, error: null })
    const row = await getTurn(U1)
    expect(steps[0].table).toBe(TURNS_VIEW)
    expect(steps[0].single).toBe(true)
    expect(row?.status).toBe('done')
  })

  it('a read error is thrown, never swallowed into an empty list', async () => {
    queue.push({ data: null, error: { message: 'boom' } })
    await expect(listThreads()).rejects.toBeTruthy()
  })

  it('listNotifications hides dismissed rows unless asked', async () => {
    queue.push({ data: [], error: null })
    await listNotifications()
    expect(steps[0].table).toBe(NOTIFICATIONS_VIEW)
    expect(steps[0].filters).toContain('is:dismissed_at=null')
    expect(steps[0].order).toBe('created_at:desc')
    expect(steps[0].limit).toBe(200)

    queue.push({ data: [], error: null })
    await listNotifications({ includeDismissed: true, limit: 5 })
    expect(steps[1].filters).toEqual([])
    expect(steps[1].limit).toBe(5)
  })
})

describe('the two permitted writes', () => {
  it('abortTurn writes only status, and only over a live turn', async () => {
    queue.push({ data: null, error: null })
    expect(await abortTurn(U1)).toBe(true)
    // The base TABLE, because the view is read-only; `status` is the only
    // column `authenticated` holds an update grant on.
    expect(steps[0].table).toBe(TURNS_TABLE)
    expect(steps[0].payload).toEqual({ status: 'aborted' })
    expect(steps[0].filters).toEqual([`eq:id=${U1}`, 'in:status=queued|running'])
  })

  it('abortTurn never throws when the row finished first', async () => {
    queue.push({ data: null, error: { message: 'refused by policy' } })
    expect(await abortTurn(U1)).toBe(false)
  })

  it('markNotificationsRead stamps only unread rows and skips an empty list', async () => {
    await markNotificationsRead([])
    expect(steps).toHaveLength(0)

    queue.push({ data: null, error: null })
    await markNotificationsRead([U1, U2, 'not-an-id'])
    expect(steps[0].table).toBe(NOTIFICATIONS_TABLE)
    expect(Object.keys(steps[0].payload ?? {})).toEqual(['read_at'])
    expect(steps[0].filters).toEqual([`in:id=${U1}|${U2}`, 'is:read_at=null'])
  })

  it('dismiss writes only dismissed_at, one row or a whole group', async () => {
    queue.push({ data: null, error: null })
    await dismissNotification(U1)
    expect(Object.keys(steps[0].payload ?? {})).toEqual(['dismissed_at'])
    expect(steps[0].filters).toEqual([`eq:id=${U1}`, 'is:dismissed_at=null'])

    queue.push({ data: null, error: null })
    await dismissGroup('turn:abc')
    expect(steps[1].filters).toEqual(['eq:group_key=turn:abc', 'is:dismissed_at=null'])
  })
})

// ---------------------------------------------------------------------------

const notif = (o: Partial<Notification>): Notification => ({
  id: 'n', family: 'engine_error', source: null, severity: 'info',
  title: 'Something happened', body: null, url: null, media: null,
  group_key: null, tenant: null, count: 1,
  first_seen_at: '2026-09-04T09:00:00.000Z',
  last_seen_at: '2026-09-04T09:00:00.000Z',
  created_at: '2026-09-04T09:00:00.000Z',
  read_at: null, dismissed_at: null, ...o,
})

describe('groupNotifications', () => {
  it('a producer that set group_key decides its own fold', () => {
    const g = groupNotifications([
      notif({ id: 'a', group_key: 'turn:1', title: 'One', last_seen_at: '2026-09-04T09:00:00.000Z' }),
      notif({ id: 'b', group_key: 'turn:1', title: 'Totally different', last_seen_at: '2026-09-04T10:00:00.000Z' }),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].groupKey).toBe('turn:1')
    // Newest inside the group is the headline: the group says what is true now.
    expect(g[0].latest.id).toBe('b')
    expect(g[0].items.map(n => n.id)).toEqual(['b', 'a'])
  })

  it('folds one situation reported with different numbers in it', () => {
    const g = groupNotifications([
      notif({ id: 'a', family: 'drafts', title: '3 drafts waiting' }),
      notif({ id: 'b', family: 'drafts', title: '11 drafts waiting' }),
    ])
    expect(g).toHaveLength(1)
  })

  it('never folds across families, however alike the titles read', () => {
    const g = groupNotifications([
      notif({ id: 'a', family: 'drafts', title: 'Failed' }),
      notif({ id: 'b', family: 'engine_error', title: 'Failed' }),
    ])
    expect(g).toHaveLength(2)
  })

  it('counts the rows own folds, not the rows', () => {
    const g = groupNotifications([
      notif({ id: 'a', group_key: 'k', count: 4, read_at: '2026-09-04T09:30:00.000Z' }),
      notif({ id: 'b', group_key: 'k', count: 2 }),
      notif({ id: 'c', group_key: 'k', count: 1 }),
    ])
    expect(g[0].count).toBe(7)
    expect(g[0].unread).toBe(2)
  })

  it('orders groups newest first, on last_seen_at rather than created_at', () => {
    // A deduped row keeps its created_at and moves last_seen_at, so an alert
    // that fired again five minutes ago must outrank one first seen today.
    const g = groupNotifications([
      notif({ id: 'old', group_key: 'a', created_at: '2026-09-04T11:00:00.000Z', last_seen_at: '2026-09-04T11:00:00.000Z' }),
      notif({ id: 'refired', group_key: 'b', created_at: '2026-09-01T08:00:00.000Z', last_seen_at: '2026-09-04T12:00:00.000Z' }),
    ])
    expect(g.map(x => x.latest.id)).toEqual(['refired', 'old'])
  })

  it('does not mutate its input', () => {
    const rows = [notif({ id: 'a', group_key: 'k', last_seen_at: '2026-09-04T09:00:00.000Z' }),
      notif({ id: 'b', group_key: 'k', last_seen_at: '2026-09-04T10:00:00.000Z' })]
    groupNotifications(rows)
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
  })

  it('is empty for no rows', () => {
    expect(groupNotifications([])).toEqual([])
  })
})

describe('notificationDeepLink', () => {
  it('reduces the relative url inbox-notify writes to the hash this app routes', () => {
    expect(notificationDeepLink({ url: `./#exp/v2/ask?thread=${U1}&turn=${U2}` }))
      .toBe(`#exp/v2/ask?thread=${U1}&turn=${U2}`)
    expect(notificationDeepLink({ url: '/#exp/v2/ops' })).toBe('#exp/v2/ops')
    expect(notificationDeepLink({ url: '#exp/v2/ops' })).toBe('#exp/v2/ops')
  })

  it('falls back rather than throwing on a missing url', () => {
    expect(notificationDeepLink({})).toBe(NOTIFICATION_FALLBACK_HASH)
    expect(notificationDeepLink({ url: null })).toBe(NOTIFICATION_FALLBACK_HASH)
    expect(notificationDeepLink({ url: '   ' })).toBe(NOTIFICATION_FALLBACK_HASH)
  })

  it('never routes an absolute url through the hash router', () => {
    // inbox-notify allows https:// for links that point somewhere ELSE. Pushing
    // one into the fragment would render an empty pane; the UI opens those off
    // n.url as an external link instead.
    expect(notificationDeepLink({ url: 'https://www.linkedin.com/feed/update/1#x' }))
      .toBe(NOTIFICATION_FALLBACK_HASH)
    expect(notificationDeepLink({ url: 'https://inbox.example.com/#exp/v2/ops' }))
      .toBe(NOTIFICATION_FALLBACK_HASH)
  })

  it('refuses anything that is not a fragment at all', () => {
    expect(notificationDeepLink({ url: 'javascript:alert(1)' })).toBe(NOTIFICATION_FALLBACK_HASH)
    expect(notificationDeepLink({ url: '/ops' })).toBe(NOTIFICATION_FALLBACK_HASH)
    expect(notificationDeepLink({ url: '../secrets/#exp/v2/ops' })).toBe(NOTIFICATION_FALLBACK_HASH)
    expect(notificationDeepLink({ url: '#' })).toBe(NOTIFICATION_FALLBACK_HASH)
    expect(notificationDeepLink({ url: '#exp/v2/ops "onload' })).toBe(NOTIFICATION_FALLBACK_HASH)
  })
})
