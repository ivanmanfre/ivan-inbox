import { describe, expect, it } from 'vitest'
import { canonicalHash, dHash, hitHash, parseDHash, toDHash } from './route'
import { subOf } from './content/SubNav'
import { PLACE_ORDER } from './places'

describe('parseDHash', () => {
  it('reads place, sub and the raw query', () => {
    const r = parseDHash('#exp/d/dms?thread=abc&turn=t1')
    expect(r.place).toBe('dms')
    expect(r.sub).toBeNull()
    expect(r.query.get('thread')).toBe('abc')
    expect(r.query.get('turn')).toBe('t1')
    expect(parseDHash('#exp/d/content/magnets?lane=arch')).toMatchObject({ place: 'content', sub: 'magnets' })
  })
  it('falls back to Lanes, maps old job ids', () => {
    expect(parseDHash('#exp/d').place).toBe('home')
    expect(parseDHash('#exp/d/nowhere').place).toBe('home')
    expect(parseDHash('#exp/d/sends').place).toBe('lanes')
    expect(parseDHash('#exp/d/money')).toMatchObject({ place: 'settings', sub: 'money' })
    expect(parseDHash('#exp/dms').place).toBe('home')
  })
})

describe('dHash', () => {
  it('writes the grammar back', () => {
    expect(dHash('dms', null, { thread: 'x' })).toBe('#exp/d/dms?thread=x')
    expect(dHash('content', 'magnets')).toBe('#exp/d/content/magnets')
    expect(dHash('lanes')).toBe('#exp/d/lanes')
    expect(dHash('ops', null, '?warm=1')).toBe('#exp/d/ops?warm=1')
  })
})

describe('toDHash (old addresses land in D)', () => {
  it.each([
    ['#exp/brain-b/dms?thread=abc', '#exp/d/dms?thread=abc'],
    ['#exp/v2/dms?warm=1', '#exp/d/dms?warm=1'],
    ['#exp/v2/ask?thread=t&turn=u', '#exp/d/claude?thread=t&turn=u'],
    ['#exp/v2/inbox/chat', '#exp/d/claude'],
    ['#exp/brain-b/sends', '#exp/d/lanes'],
    ['#exp/v2/today', '#exp/d/home'],
    ['#exp/v2/inbox', '#exp/d/dms'],
    ['#exp/brain-b/magnets', '#exp/d/content/magnets'],
    ['#exp/v2/money', '#exp/d/settings/money'],
    ['#exp/v2/orbit', '#exp/d/sales/orbit'],
    ['#exp/v2?section=sales', '#exp/d/sales?section=sales'],
    ['#thread/abc', '#exp/d/dms?thread=abc'],
    ['#exp/d/ops', '#exp/d/ops'],
  ])('%s -> %s', (from, to) => { expect(toDHash(from)).toBe(to) })
  it('is null for a hash that is not an app route', () => {
    expect(toDHash('#doc?slug=x')).toBeNull()
    expect(toDHash('')).toBeNull()
  })
  it('canonicalHash sends anything else home', () => {
    expect(canonicalHash('')).toBe('#exp/d/home')
    expect(canonicalHash('#exp/brain-b/ops')).toBe('#exp/d/ops')
  })
})

// X became a Content tab (daily-brief-trim Task 6.1): pushes and runner links still carry the
// X desk's address and the older Ops one, so both land on the tab with their query.
describe('X lives in Content', () => {
  it('old X addresses land on the Content tab, query kept', () => {
    expect(canonicalHash('#exp/d/x?id=abc')).toBe('#exp/d/content/x?id=abc')
    expect(canonicalHash('#exp/d/ops/x?id=abc')).toBe('#exp/d/content/x?id=abc')
    expect(canonicalHash('#exp/d/x')).toBe('#exp/d/content/x')
  })
  it('x is a content sub, not a place', () => {
    expect(subOf('x')).toBe('x'); expect(PLACE_ORDER).not.toContain('x')
  })
  it('the X address is written under Content', () => {
    expect(dHash('content', 'x', { id: 'abc' })).toBe('#exp/d/content/x?id=abc')
    expect(parseDHash('#exp/d/x?id=abc')).toMatchObject({ place: 'content', sub: 'x' })
    expect(parseDHash('#exp/d/x?id=abc').query.get('id')).toBe('abc')
  })
})

describe('hitHash (⌘K search hits)', () => {
  it('opens each surface in its D place', () => {
    expect(hitHash({ surface: 'dm', id: 'p1', title: '', sub: '', snippet: '', lane: 'ivan' })).toBe('#exp/d/dms?seat=ivan&thread=p1')
    expect(hitHash({ surface: 'dm', id: 'p2', title: '', sub: '', snippet: '', lane: 'arch' })).toBe('#exp/d/dms?seat=arch&thread=p2')
    expect(hitHash({ surface: 'draft', id: 'd1', title: '', sub: '', snippet: '', lane: 'risedtc' })).toBe('#exp/d/content?draft=d1&lane=risedtc')
    expect(hitHash({ surface: 'magnet', id: 'm1', title: '', sub: '', snippet: '', lane: 'arch' })).toBe('#exp/d/content/magnets?magnet=m1&lane=arch')
  })
})
