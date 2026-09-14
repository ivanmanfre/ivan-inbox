import { describe, it, expect } from 'vitest'
import { newerSession, newerSwr, shouldPrefetch } from './handoff'

const sess = (expires_at: number, tag = 'x') => JSON.stringify({ access_token: tag, refresh_token: 'r', expires_at, user: { id: 'u1' } })

describe('newerSession — which stored session the page adopts at boot', () => {
  it('takes the worker copy when it expires later', () => {
    expect(newerSession(sess(100, 'local'), sess(200, 'worker'))).toBe(sess(200, 'worker'))
  })
  it('keeps the local copy when it is the later one', () => {
    expect(newerSession(sess(300, 'local'), sess(200, 'worker'))).toBe(sess(300, 'local'))
  })
  it('keeps the local copy on a tie', () => {
    expect(newerSession(sess(200, 'local'), sess(200, 'worker'))).toBe(sess(200, 'local'))
  })
  it('keeps the local copy when the worker copy is missing or unreadable', () => {
    expect(newerSession(sess(100, 'local'), null)).toBe(sess(100, 'local'))
    expect(newerSession(sess(100, 'local'), '{not json')).toBe(sess(100, 'local'))
  })
  it('adopts the worker copy when nothing is stored locally', () => {
    expect(newerSession(null, sess(100, 'worker'))).toBe(sess(100, 'worker'))
  })
})

describe('newerSwr — which saved DMs copy the page paints from', () => {
  const e = (savedAt: string, user = 'u1') => ({ savedAt, user, payload: { threads: [] } })
  it('takes the worker copy when it was saved later', () => {
    expect(newerSwr(e('2026-09-14T08:00:00Z'), e('2026-09-14T09:00:00Z'), 'u1')).toEqual(e('2026-09-14T09:00:00Z'))
  })
  it('keeps the local copy when it is later or equal', () => {
    expect(newerSwr(e('2026-09-14T09:00:00Z'), e('2026-09-14T08:00:00Z'), 'u1')).toEqual(e('2026-09-14T09:00:00Z'))
    expect(newerSwr(e('2026-09-14T09:00:00Z'), e('2026-09-14T09:00:00Z'), 'u1')).toEqual(e('2026-09-14T09:00:00Z'))
  })
  it('never adopts a copy that belongs to another user', () => {
    expect(newerSwr(e('2026-09-14T08:00:00Z'), e('2026-09-14T09:00:00Z', 'u2'), 'u1')).toEqual(e('2026-09-14T08:00:00Z'))
    expect(newerSwr(null, e('2026-09-14T09:00:00Z', 'u2'), 'u1')).toBeNull()
  })
  it('adopts the worker copy when nothing is stored locally', () => {
    expect(newerSwr(null, e('2026-09-14T09:00:00Z'), 'u1')).toEqual(e('2026-09-14T09:00:00Z'))
  })
})

describe('shouldPrefetch — when a push may fetch the inbox in the worker', () => {
  it('fetches when the app is closed and a session is stored', () => {
    expect(shouldPrefetch({ windowClients: 0, session: sess(1) })).toBe(true)
  })
  it('leaves it to the open app when any window is open', () => {
    expect(shouldPrefetch({ windowClients: 1, session: sess(1) })).toBe(false)
  })
  it('does nothing without a stored session', () => {
    expect(shouldPrefetch({ windowClients: 0, session: null })).toBe(false)
  })
})
