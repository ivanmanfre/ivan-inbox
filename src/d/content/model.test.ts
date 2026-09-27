import { describe, expect, it } from 'vitest'
import type { ContentDraft } from '../../lib/content'
import {
  isPlanned, isScheduled, landingDay, nextFreeWeekday, postOn, ptOf, scheduledIn, timeLine,
  wallDays, waitingRows, weekWord,
} from './model'

const row = (p: Partial<ContentDraft>): ContentDraft => ({
  id: p.id ?? 'x', client_id: null, status: 'review', type: 'text', title: 'T', topic: null, post_body: 'b',
  scheduled_at: null, source_post_id: null, image_urls: null, taxonomy: null,
  updated_at: '2026-09-20T10:00:00Z', created_at: '2026-09-20T10:00:00Z', ...p,
})
const SUN = Date.parse('2026-09-27T08:50:00Z') // Sun 27 Sep, 10:50 Warsaw
const WED = Date.parse('2026-09-30T08:00:00Z')

describe('the wall', () => {
  it('opens on the coming Monday on a weekend, this Monday on a weekday, ten weekdays', () => {
    const d = wallDays(SUN)
    expect(d).toHaveLength(10)
    expect(d[0]).toMatchObject({ key: '2026-09-28', dow: 'Mon' })
    expect(d[5]).toMatchObject({ key: '2026-10-05', dow: 'Mon' })
    expect(d.some(x => x.dow === 'Sat' || x.dow === 'Sun')).toBe(false)
    expect(wallDays(WED)[0].key).toBe('2026-09-28')
    expect(weekWord(SUN)).toBe('Next week')
    expect(weekWord(WED)).toBe('This week')
  })

  it('counts by the ratified rule: client = on board + unpublished + dated, review counts; Ivan = scheduled', () => {
    const at = '2026-09-29T07:00:00Z'
    expect(isScheduled(row({ client_id: 'arch', board_visible: true, status: 'review', scheduled_at: at }), 'arch')).toBe(true)
    expect(isScheduled(row({ client_id: 'arch', board_visible: false, status: 'review', scheduled_at: at }), 'arch')).toBe(false)
    expect(isScheduled(row({ client_id: 'arch', board_visible: true, status: 'review', scheduled_at: at, published_at: at }), 'arch')).toBe(false)
    expect(isScheduled(row({ status: 'scheduled', scheduled_at: at }), 'ivan')).toBe(true)
    expect(isScheduled(row({ status: 'review', scheduled_at: at }), 'ivan')).toBe(false)
    expect(isPlanned(row({ status: 'review', scheduled_at: at }), 'ivan')).toBe(true)
    const rows = [
      row({ id: 'a', status: 'scheduled', scheduled_at: at }),
      row({ id: 'b', status: 'scheduled', scheduled_at: '2026-10-06T07:00:00Z' }),
    ]
    expect(scheduledIn(rows, 'ivan', wallDays(SUN).slice(0, 5))).toBe(1)
    expect(postOn(rows, 'ivan', '2026-09-29')?.id).toBe('a')
  })

  it('shows Pacific time beside Warsaw on Rise only', () => {
    const at = '2026-09-28T14:00:00Z'
    expect(ptOf(at)).toBe('07:00 PT')
    expect(timeLine(at, 'risedtc')).toBe('16:00 · 07:00 PT')
    expect(timeLine(at, 'arch')).toBe('16:00')
  })
})

describe('waiting on you', () => {
  it('is status review, not on a board, split at 14 days, newest first', () => {
    const rows = [
      row({ id: 'new', created_at: '2026-09-26T10:00:00Z' }),
      row({ id: 'old', created_at: '2026-09-01T10:00:00Z' }),
      row({ id: 'board', board_visible: true, created_at: '2026-09-26T11:00:00Z' }),
      row({ id: 'sched', status: 'scheduled', created_at: '2026-09-26T11:00:00Z' }),
      row({ id: 'newer', created_at: '2026-09-27T07:00:00Z' }),
    ]
    const w = waitingRows(rows, SUN)
    expect(w.fresh.map(r => r.id)).toEqual(['newer', 'new'])
    expect(w.older.map(r => r.id)).toEqual(['old'])
  })
})

describe('next free slot', () => {
  it('is three days out at 10:45 and skips weekends and taken days', () => {
    // Sun 27 Sep + 3 = Wed 30 Sep; taken Wed + Thu -> Fri 2 Oct
    const s = nextFreeWeekday(new Set(['2026-09-30', '2026-10-01']), SUN)
    expect(s.at.getHours()).toBe(10)
    expect(s.at.getMinutes()).toBe(45)
    expect(s.skipped.map(x => x.why)).toEqual(['has a post', 'has a post'])
    // Wed + 3 = Sat 3 Oct -> Mon 5 Oct
    const w = nextFreeWeekday(new Set(), WED)
    expect([1, 2, 3, 4, 5]).toContain(w.at.getDay())
    expect(w.skipped.map(x => x.why)).toEqual(['weekend', 'weekend'])
  })
})

describe('move landing', () => {
  it('bumps a taken day and a weekend to the next free weekday', () => {
    expect(landingDay('2026-10-01', new Set(['2026-10-01']))).toBe('2026-10-02')
    expect(landingDay('2026-10-03', new Set())).toBe('2026-10-05')
    expect(landingDay('2026-10-02', new Set(['2026-10-02']))).toBe('2026-10-05')
  })
})
