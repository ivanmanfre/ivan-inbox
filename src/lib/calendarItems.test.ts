import { describe, it, expect } from 'vitest'
import {
  buildCalendarItems, buildCalendarRail, canMoveDate, dayKey, dayKeyOf,
  groupByDay, monthLabel, monthWeeks, publishAtForDay, shiftMonth,
} from './calendarItems'
import type { ContentDraft } from './content'

// Ported in shape from the old dashboard's calendarItems.test.ts: one test per
// derivation rule, each naming the live behaviour it protects.

const NOW = Date.parse('2026-08-07T12:00:00Z')
const d = (over: Partial<ContentDraft> = {}): ContentDraft => ({
  id: 'd1', client_id: 'risedtc', status: 'scheduled', type: 'text',
  title: 'A post', topic: null, post_body: 'body',
  scheduled_at: '2026-08-12T10:30:00Z', source_post_id: null, image_urls: null,
  taxonomy: {}, updated_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z',
  ...over,
})

describe('buildCalendarItems — which rows become chips', () => {
  it('a scheduled draft becomes one chip on its own local day', () => {
    const items = buildCalendarItems([d()], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'd1', stage: 'scheduled', title: 'A post' })
    expect(items[0].day).toBe(dayKeyOf('2026-08-12T10:30:00Z'))
  })

  it('published rows stay on the calendar — the month is a record, not just a plan', () => {
    const items = buildCalendarItems([d({ status: 'published', source_post_id: 'urn:li:activity:1' })], NOW)
    expect(items[0].stage).toBe('published')
  })

  it('a past-due schedule keeps its own stage (stuck), never drawn as a plan', () => {
    const items = buildCalendarItems([d({ scheduled_at: '2026-08-01T10:00:00Z' })], NOW)
    expect(items[0].stage).toBe('stuck')
  })

  it('a row with no date is NOT drawn — there is no day to draw it on', () => {
    expect(buildCalendarItems([d({ scheduled_at: null })], NOW)).toHaveLength(0)
  })

  it('an unparseable date is dropped rather than bucketed as today', () => {
    expect(buildCalendarItems([d({ scheduled_at: 'not-a-date' })], NOW)).toHaveLength(0)
  })

  it('an errored or archived row carrying an old date is NOT drawn as a future post', () => {
    const rows = [d({ status: 'error' }), d({ id: 'd2', status: 'disqualified' }), d({ id: 'd3', status: 'skipped' })]
    expect(buildCalendarItems(rows, NOW)).toHaveLength(0)
  })

  it('🔴 a DATED REVIEW row is drawn — that is what the client lane\'s forward schedule IS', () => {
    // Probed 2026-08-07: risedtc holds 9 dated `review` rows, 13 published and
    // ZERO at `scheduled`. Drawing `scheduled` only showed his history and
    // nothing ahead of today.
    const items = buildCalendarItems([d({ status: 'review' })], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ stage: 'review', movable: true })
  })

  it('a dated approved row is drawn too — but the date RPC will not take it', () => {
    const items = buildCalendarItems([d({ status: 'approved' })], NOW)
    expect(items[0]).toMatchObject({ stage: 'approved', movable: false })
  })

  it('titles fall back topic → Untitled, never blank', () => {
    expect(buildCalendarItems([d({ title: null, topic: 'The topic' })], NOW)[0].title).toBe('The topic')
    expect(buildCalendarItems([d({ title: null, topic: null })], NOW)[0].title).toBe('Untitled')
  })

  it('chips come back in time order, so the day cell reads top-to-bottom', () => {
    const rows = [
      d({ id: 'late', scheduled_at: '2026-08-12T18:00:00Z' }),
      d({ id: 'early', scheduled_at: '2026-08-12T08:00:00Z' }),
    ]
    expect(buildCalendarItems(rows, NOW).map(i => i.id)).toEqual(['early', 'late'])
  })
})

describe('canMoveDate — operator_set_schedule_date’s status line, and nothing else', () => {
  it('🔴 IVAN’S OWN DRAFTS MOVE NOW: the date RPC has no client_id branch at all', () => {
    // The refusal this used to encode (`not_a_client_draft`) belongs to the
    // ARMING rpc. db/032 tests status only, so the lane stopped mattering —
    // and the signature says so: canMoveDate cannot even SEE client_id now.
    const row = (status: string, client_id: string | null) => ({ status, client_id })
    expect(canMoveDate(row('scheduled', null))).toBe(true)
    expect(canMoveDate(row('review', null))).toBe(true)
    expect(canMoveDate(row('scheduled', 'risedtc'))).toBe(true)
  })
  it('the two statuses the SQL names, verbatim — and nothing outside them', () => {
    for (const s of ['review', 'scheduled']) {
      expect(canMoveDate({ status: s })).toBe(true)
    }
    for (const s of ['approved', 'generating', 'error', 'disqualified', 'skipped']) {
      expect(canMoveDate({ status: s })).toBe(false)
    }
  })
  it('🔴 published is refused BY THE DATABASE now, not by a promise we keep here', () => {
    expect(canMoveDate({ status: 'published' })).toBe(false)
  })
  it('the chips carry that answer, so a locked row never renders a move control', () => {
    const items = buildCalendarItems([d(), d({ id: 'p', status: 'published' })], NOW)
    expect(items.find(i => i.id === 'd1')?.movable).toBe(true)
    expect(items.find(i => i.id === 'p')?.movable).toBe(false)
    // the same row on Ivan's lane — dated, scheduled, no client_id — is movable
    expect(buildCalendarItems([d({ client_id: null })], NOW)[0].movable).toBe(true)
  })
})

describe('buildCalendarRail — Ready, no date', () => {
  it('is exactly the approved-and-undated set the Approved sub-line counts', () => {
    const rows = [
      d({ id: 'a', status: 'approved', scheduled_at: null }),
      d({ id: 'b', status: 'approved', scheduled_at: '2026-08-12T10:00:00Z' }),
      d({ id: 'c', status: 'review', scheduled_at: null }),
    ]
    expect(buildCalendarRail(rows).map(r => r.id)).toEqual(['a'])
  })
  it('carries the same movability answer as a chip — approved is refused on BOTH lanes', () => {
    const row = d({ status: 'approved', scheduled_at: null })
    expect(buildCalendarRail([row])[0].movable).toBe(false)
    expect(buildCalendarRail([{ ...row, client_id: null }])[0].movable).toBe(false)
  })
})

describe('publishAtForDay — what the RPC is actually handed', () => {
  it('preserves the time of day so ONLY the day varies (the 08-04 Fri→Sun move)', () => {
    const cur = new Date(2026, 7, 7, 10, 30, 0, 0).toISOString()
    const next = publishAtForDay(cur, '2026-08-09')
    const nd = new Date(next)
    expect(nd.getFullYear()).toBe(2026)
    expect(nd.getMonth()).toBe(7)
    expect(nd.getDate()).toBe(9)
    expect(nd.getHours()).toBe(10)
    expect(nd.getMinutes()).toBe(30)
  })
  it('defaults a never-dated draft to 09:00 local, not to whatever now happens to be', () => {
    const next = new Date(publishAtForDay(null, '2026-08-19', Date.parse('2026-08-07T23:14:00Z')))
    expect(next.getDate()).toBe(19)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
  })
  it('an unparseable stored date is treated as no date rather than throwing', () => {
    const next = new Date(publishAtForDay('garbage', '2026-08-19'))
    expect(next.getDate()).toBe(19)
    expect(next.getHours()).toBe(9)
  })
})

describe('the grid', () => {
  it('dayKey is LOCAL — the UTC slice(0,10) bug the risedtc punchlist recorded', () => {
    // 22:00 local on the 9th is the 10th in UTC for a positive offset, and the
    // 9th is what belongs on the grid either way: the key is built from the
    // local parts, never from the ISO string.
    const local = new Date(2026, 7, 9, 22, 0, 0)
    expect(dayKey(local)).toBe('2026-08-09')
    expect(dayKeyOf(local.toISOString())).toBe('2026-08-09')
  })
  it('weeks start on Sunday — the posting week is Sun-Thu', () => {
    const weeks = monthWeeks(2026, 7)
    expect(new Date(weeks[0][0] + 'T00:00:00').getDay()).toBe(0)
    expect(weeks.every(w => w.length === 7)).toBe(true)
  })
  it('covers every day of the month exactly once', () => {
    const flat = monthWeeks(2026, 7).flat()
    const inMonth = flat.filter(k => k.startsWith('2026-08'))
    expect(inMonth).toHaveLength(31)
    expect(new Set(flat).size).toBe(flat.length)
  })
  it('does not draw a sixth empty week when the month does not need one', () => {
    // February 2026 starts on a Sunday: exactly four weeks of 7 cover it.
    expect(monthWeeks(2026, 1).length).toBeLessThanOrEqual(5)
  })
  it('shiftMonth rolls the year rather than producing month 12', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })
  it('groupByDay buckets by the same key the grid draws', () => {
    const items = buildCalendarItems([d(), d({ id: 'd2' })], NOW)
    const byDay = groupByDay(items)
    expect(byDay.get(items[0].day)).toHaveLength(2)
  })
  it('monthLabel names the month rather than printing a number', () => {
    expect(monthLabel(2026, 7)).toMatch(/2026/)
  })
})
