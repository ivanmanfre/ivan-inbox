import { describe, expect, it } from 'vitest'
import { SNAPSHOT_MAX_AGE_MS, usableSnapshot } from './inboxSnapshot'

const now = Date.parse('2026-11-15T20:00:00.000Z')
const ok = { user: 'u1', rows: [{ id: 'm' }], watermark: '2026-11-15T19:00:00.000Z', fullAt: now - 3_600_000 }

describe('usableSnapshot', () => {
  it('takes only this user, a non-empty set, and a watermark the server can still answer from', () => {
    expect(usableSnapshot(ok, 'u1', now)).toBe(ok)
    expect(usableSnapshot(ok, 'u2', now)).toBeNull()
    expect(usableSnapshot(ok, null, now)).toBeNull()
    expect(usableSnapshot({ ...ok, rows: [] }, 'u1', now)).toBeNull()
    expect(usableSnapshot({ ...ok, watermark: new Date(now - SNAPSHOT_MAX_AGE_MS).toISOString() }, 'u1', now)).toBeNull()
    expect(usableSnapshot({ ...ok, watermark: 'not a date' }, 'u1', now)).toBeNull()
    expect(usableSnapshot({ ...ok, watermark: new Date(now + 3_600_000).toISOString() }, 'u1', now)).toBeNull()
    expect(usableSnapshot({ ...ok, fullAt: undefined }, 'u1', now)).toBeNull()
    expect(usableSnapshot(null, 'u1', now)).toBeNull()
    expect(usableSnapshot({ ...ok, fullAt: now - SNAPSHOT_MAX_AGE_MS }, 'u1', now)).toBeNull()
  })
})
