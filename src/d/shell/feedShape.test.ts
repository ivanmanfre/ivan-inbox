import { describe, expect, it } from 'vitest'
import type { NotificationGroup } from '../../lib/turns'
import { bodyLine, cleanLine, feedDays } from './feedShape'
import { healthLines } from './healthLines'

describe('cleanLine / bodyLine', () => {
  it('drops the emoji, the tenant tag, the em dash and bare links', () => {
    expect(cleanLine('🚨 [ARCH] Harvest ran — posts capped https://x.y/z')).toBe('Harvest ran, posts capped')
  })
  it('drops a body that only repeats the title', () => {
    expect(bodyLine({ title: 'Publish queue', body: 'Publish queue' })).toBe('')
    expect(bodyLine({ title: 'Publish queue', body: 'Publish queue: QUEUED "Cold DMing"' })).toBe('QUEUED "Cold DMing"')
  })
})

describe('feedDays', () => {
  const g = (key: string, at: string, unread: number) => ({ key, lastSeenAt: at, unread } as unknown as NotificationGroup)
  it('groups by Warsaw day and counts unread groups per day', () => {
    const now = Date.parse('2026-09-27T09:00:00Z')
    const d = feedDays([g('a', '2026-09-27T08:00:00Z', 2), g('b', '2026-09-27T07:00:00Z', 0), g('c', '2026-09-26T20:00:00Z', 1)], now)
    expect(d.map(x => [x.day, x.groups.length, x.unread])).toEqual([['Today', 2, 1], ['Yesterday', 1, 1]])
  })
})

describe('healthLines (seat banner)', () => {
  const now = Date.parse('2026-09-27T09:00:00Z')
  it('nothing when every seat is up and the guard is fresh', () => {
    expect(healthLines({ updated_at: '2026-09-27T08:00:00Z', seats: [{ id: 's1', name: 'Ivan', account: 'OK', sn: 'OK', degraded: false, link: null }] }, now)).toEqual([])
    expect(healthLines(null, now)).toEqual([])
  })
  it('a dead seat gets a line and its reconnect link; a silent guard says so', () => {
    const l = healthLines({ updated_at: '2026-09-27T02:00:00Z', seats: [
      { id: 's1', name: 'Arch', account: 'CREDENTIALS', sn: null, degraded: true, link: 'https://reconnect.example/arch' },
      { id: 's2', name: 'Rise', account: 'OK', sn: 'DEAD', degraded: true, link: null },
    ] }, now)
    expect(l[0]).toEqual({ key: 's1', text: 'Arch: LinkedIn seat disconnected', link: 'https://reconnect.example/arch' })
    expect(l[1].text).toBe('Rise: Sales Nav session dead')
    expect(l[2].text).toMatch(/^Seat guard silent since Sun 27 Sep, 04:00 Warsaw/)
  })
})
