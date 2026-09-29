import { describe, expect, it } from 'vitest'
import type { ContentDraft } from '../../lib/content'
import { seatItems } from './planModel'
import { buildWeek, foldText, laneOfRow, openingOf, primaryOf, windowDays } from './weekModel'

// Tue 29 Sep 2026, 12:00 Warsaw.
const NOW = Date.parse('2026-09-29T10:00:00Z')
const H = 3_600_000
const D = 24 * H

let n = 0
const row = (o: Partial<ContentDraft>): ContentDraft => ({
  id: `r${++n}`, client_id: null, status: 'review', type: 'text', title: 'A post', topic: null, post_body: 'Body.',
  scheduled_at: null, published_at: null, source_post_id: null, image_urls: null, taxonomy: null,
  created_at: new Date(NOW - H).toISOString(), updated_at: new Date(NOW - H).toISOString(), board_visible: null, ...o,
} as ContentDraft)
const at = (ms: number) => new Date(NOW + ms).toISOString()
const ids = (w: ReturnType<typeof buildWeek>, key: string) => w.groups.find(g => g.key === key)?.cards.map(c => c.r.id) ?? []

describe('this week: grouping and order', () => {
  it('today first, then each upcoming day, then review with no date this week', () => {
    const a = row({ id: 'tomorrow', status: 'scheduled', scheduled_at: at(D) })
    const b = row({ id: 'today', status: 'scheduled', scheduled_at: at(2 * H) })
    const c = row({ id: 'undated' })
    const d = row({ id: 'fri', client_id: 'risedtc', board_visible: true, scheduled_at: at(3 * D) })
    const w = buildWeek([a, c, d, b], { now: NOW })
    expect(w.groups.map(g => g.kind)).toEqual(['today', 'day', 'day', 'review'])
    expect(w.groups.map(g => g.label)).toEqual(['Today', 'Tomorrow', 'Fri', 'In review'])
    expect(w.ids).toEqual(['today', 'tomorrow', 'fri', 'undated'])
  })

  it('a day orders by time, and at the same minute Ivan, then Rise, then Arch', () => {
    const t = at(D)
    const w = buildWeek([
      row({ id: 'arch', client_id: 'arch', scheduled_at: t }),
      row({ id: 'late', status: 'scheduled', scheduled_at: at(D + H) }),
      row({ id: 'rise', client_id: 'risedtc', board_visible: true, scheduled_at: t }),
      row({ id: 'ivan', status: 'scheduled', scheduled_at: t }),
    ], { now: NOW })
    expect(w.groups[0].cards.map(c => c.r.id)).toEqual(['ivan', 'rise', 'arch', 'late'])
  })

  it('a post that did not go out on its time rides at the top of Today, flagged', () => {
    const w = buildWeek([
      row({ id: 'now', status: 'scheduled', scheduled_at: at(H) }),
      row({ id: 'missed', status: 'scheduled', scheduled_at: at(-2 * D) }),
      row({ id: 'ancient', status: 'scheduled', scheduled_at: at(-20 * D) }),
    ], { now: NOW })
    expect(ids(w, '2026-09-29')).toEqual(['missed', 'now'])
    const missed = w.groups[0].cards[0]
    expect(missed.overdue).toBe(true)
    expect(missed.flags[0]).toMatchObject({ key: 'stuck', tone: 'warn' })
    expect(w.ids).not.toContain('ancient')
  })

  it('client posts already on the board or scheduled are in the stack (they used to vanish from Review)', () => {
    const w = buildWeek([
      row({ id: 'onboard', client_id: 'risedtc', board_visible: true }),
      row({ id: 'armed', client_id: 'risedtc', board_visible: true, status: 'scheduled', scheduled_at: at(2 * D) }),
    ], { now: NOW })
    expect(w.ids.sort()).toEqual(['armed', 'onboard'])
    expect(w.groups.find(g => g.kind === 'review')!.cards[0].flags.map(f => f.key)).toContain('board')
  })

  it('review older than two weeks goes to the fold, newest first everywhere', () => {
    const w = buildWeek([
      row({ id: 'old2', created_at: at(-30 * D) }),
      row({ id: 'new', created_at: at(-1 * D) }),
      row({ id: 'old1', created_at: at(-20 * D) }),
      row({ id: 'newer', created_at: at(-1 * H) }),
    ], { now: NOW })
    expect(ids(w, 'review')).toEqual(['newer', 'new'])
    expect(w.older.map(c => c.r.id)).toEqual(['old1', 'old2'])
    expect(w.ids).toEqual(['newer', 'new', 'old1', 'old2'])
    expect(w.toDecide.ivan).toBe(2)
    expect(w.perLane.ivan).toBe(4)
  })

  it('leaves out what is not a decision or a post this week', () => {
    const w = buildWeek([
      row({ status: 'disqualified' }), row({ status: 'generating' }), row({ status: 'idea' }), row({ status: 'archived', client_id: 'risedtc' }),
      row({ status: 'approved' }), row({ status: 'error' }),
      row({ status: 'published', published_at: at(-3 * D), scheduled_at: at(-3 * D) }),
      row({ status: 'scheduled', scheduled_at: at(12 * D) }),
      row({ client_id: 'someone-else' }),
    ], { now: NOW })
    expect(w.ids).toEqual([])
  })

  it('the lane filter narrows the cards but the chip counts stay per seat', () => {
    const rows = [row({}), row({ client_id: 'risedtc' }), row({ client_id: 'arch' }), row({ client_id: 'ivan' })]
    const w = buildWeek(rows, { now: NOW, show: 'risedtc' })
    expect(w.ids).toHaveLength(1)
    expect(w.perLane).toEqual({ ivan: 2, risedtc: 1, arch: 1 })
    expect(w.toDecide).toEqual({ ivan: 2, risedtc: 1, arch: 0 })
  })

  it('a held decision shows at once: Skip leaves, Approve on a dated draft turns its key into Schedule', () => {
    const dated = row({ id: 'dated', scheduled_at: at(D) })
    const plain = row({ id: 'plain' })
    const gone = row({ id: 'gone' })
    const w = buildWeek([dated, plain, gone], { now: NOW, pending: new Map([['gone', 'skip'], ['plain', 'approve'], ['dated', 'approve']]) })
    expect(w.ids).toEqual(['dated'])
    expect(w.groups[0].cards[0].primary).toBe('schedule')
  })

  it('a post the publisher stopped says Blocked, with the reason', () => {
    const r = row({ id: 'b', status: 'scheduled', scheduled_at: at(D) })
    const w = buildWeek([r], { now: NOW, blocks: new Map([['b', 'publish_lint_fail: em dash']]) })
    expect(w.groups[0].cards[0].flags[0]).toMatchObject({ key: 'blocked', title: 'publish_lint_fail: em dash' })
  })
})

describe('this week: ARCH is view only', () => {
  it('an Arch card never carries a date control or a status key, whatever its state', () => {
    const arch = [
      row({ client_id: 'arch' }),
      row({ client_id: 'arch', board_visible: false, scheduled_at: at(D) }),
      row({ client_id: 'arch', board_visible: true, scheduled_at: at(2 * D) }),
      row({ client_id: 'arch', status: 'scheduled', board_visible: true, scheduled_at: at(3 * D) }),
    ]
    const w = buildWeek(arch, { now: NOW })
    const cards = [...w.groups.flatMap(g => g.cards), ...w.older]
    expect(cards).toHaveLength(4)
    for (const c of cards) {
      expect(c.canDate).toBe(false)
      expect(c.primary).toBe('open')
      expect(c.viewOnly).toBe(true)
      expect(c.flags.map(f => f.key)).toContain('view')
    }
    expect(w.toDecide.arch).toBe(0)
  })

  it('the same rows on Rise do get the date control and Put on board', () => {
    const c = buildWeek([row({ client_id: 'risedtc' })], { now: NOW }).groups[0].cards[0]
    expect(c.canDate).toBe(true)
    expect(c.primary).toBe('board')
  })

  it('the planner never offers a move or an arm on an Arch post either', () => {
    const items = seatItems([row({ client_id: 'arch', board_visible: true, scheduled_at: at(D) })], 'arch', null, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].movable).toBe(false)
    expect(items[0].armable).toBe(false)
    expect(seatItems([row({ client_id: 'risedtc', board_visible: true, scheduled_at: at(D) })], 'risedtc', null, NOW)[0].movable).toBe(true)
  })
})

describe('this week: the one key and the date control', () => {
  it('Ivan: review = Approve, approved with a date = Schedule, armed / error / published = Open', () => {
    expect(primaryOf(row({}), 'ivan')).toBe('approve')
    expect(primaryOf(row({ status: 'approved', scheduled_at: at(D) }), 'ivan')).toBe('schedule')
    expect(primaryOf(row({ status: 'scheduled', scheduled_at: at(D) }), 'ivan')).toBe('open')
    expect(primaryOf(row({ status: 'error' }), 'ivan')).toBe('open')
    expect(primaryOf(row({ status: 'published', published_at: at(-H) }), 'ivan')).toBe('open')
  })

  it('Rise: in review and not on the board = Put on board, on the board = Open', () => {
    expect(primaryOf(row({ client_id: 'risedtc' }), 'risedtc')).toBe('board')
    expect(primaryOf(row({ client_id: 'risedtc', board_visible: true }), 'risedtc')).toBe('open')
  })

  it('the date control follows operator_set_schedule_date: review or scheduled, never published or approved', () => {
    const w = buildWeek([
      row({ id: 'rev', scheduled_at: at(D) }),
      row({ id: 'sch', status: 'scheduled', scheduled_at: at(D) }),
      row({ id: 'app', status: 'approved', scheduled_at: at(D) }),
      row({ id: 'pub', status: 'published', published_at: at(-H), scheduled_at: at(-2 * H) }),
    ], { now: NOW })
    const by = Object.fromEntries(w.groups.flatMap(g => g.cards).map(c => [c.r.id, c.canDate]))
    expect(by).toEqual({ rev: true, sch: true, app: false, pub: false })
  })
})

describe('the fold and the opening', () => {
  it('three lines, then …see more, cut on a word', () => {
    expect(foldText('One.\nTwo.\nThree.')).toEqual({ head: 'One.\nTwo.\nThree.', folded: false })
    expect(foldText('One.\n\nTwo.\nThree.')).toEqual({ head: 'One.\n\nTwo.', folded: true })
    const long = 'word '.repeat(40).trim()
    const f = foldText(long, 3, 20)
    expect(f.folded).toBe(true)
    expect(f.head.length).toBeLessThanOrEqual(60)
    expect(f.head.endsWith('word')).toBe(true)
  })

  it('the opening drops a leading [tag] and does not repeat the title line in the body', () => {
    const o = openingOf(row({ title: '[X outlier @x] Warsaw at night', post_body: 'Warsaw at night.\n\nThe rest of it.' }))
    expect(o).toEqual({ title: 'Warsaw at night', body: 'The rest of it.' })
  })

  it('lanes: null and ivan are Ivan, the two clients are theirs, anything else is dropped', () => {
    expect([null, 'ivan', 'risedtc', 'arch', 'audn'].map(c => laneOfRow({ client_id: c }))).toEqual(['ivan', 'ivan', 'risedtc', 'arch', null])
  })

  it('the window is seven Warsaw days from today', () => {
    expect(windowDays(NOW)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'])
  })
})
