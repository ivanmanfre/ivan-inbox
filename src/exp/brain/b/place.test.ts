import { beforeEach, describe, expect, it } from 'vitest'
import { readPlace, resolveBootPlace, tabForJob, jobForTab, TABS, writePlace } from './place'

// This suite runs under vitest's default `node` environment (no jsdom), which
// has no global localStorage. place.ts already treats a missing/throwing
// localStorage as "nothing persisted" (private-mode / quota rule), so a tiny
// in-memory stub is enough to exercise the round-trip without pulling jsdom
// into the whole repo's test config.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  } as Storage
}

describe('tabForJob', () => {
  it('folds every work job onto the Content tab', () => {
    expect(tabForJob('content')).toBe('content')
    expect(tabForJob('magnets')).toBe('content')
    expect(tabForJob('styles')).toBe('content')
    expect(tabForJob('strategy')).toBe('content')
  })
  it('sends the five lanes back to themselves', () => {
    expect(tabForJob('today')).toBe('today')
    expect(tabForJob('dms')).toBe('dms')
    expect(tabForJob('sends')).toBe('sends')
    expect(tabForJob('ops')).toBe('ops')
  })
  it('a job with no tab of its own lands on Today rather than throwing', () => {
    expect(tabForJob('settings')).toBe('today')
    expect(tabForJob('money')).toBe('today')
  })
})

describe('readPlace / writePlace', () => {
  beforeEach(() => localStorage.clear())
  it('round-trips a real tab', () => {
    writePlace('dms')
    expect(readPlace()).toBe('dms')
  })
  it('never trusts garbage in storage', () => {
    localStorage.setItem('brain-b-place', 'not-a-real-tab')
    expect(readPlace()).toBeNull()
  })
  it('returns null when nothing was ever written', () => {
    expect(readPlace()).toBeNull()
  })
})

describe('resolveBootPlace', () => {
  it('a feed deep link opens Ask underneath the sheet', () => {
    expect(resolveBootPlace({ feed: true }, 'ops')).toBe('ask')
  })
  it('a thread deep link always wins over what was persisted', () => {
    expect(resolveBootPlace({ thread: 'x' }, 'content')).toBe('ask')
  })
  it('with no deep link, the persisted place survives', () => {
    expect(resolveBootPlace({}, 'sends')).toBe('sends')
  })
  it('with nothing persisted and no deep link, Ask is the default landing', () => {
    expect(resolveBootPlace({}, null)).toBe('ask')
  })
})

describe('a link that names a place', () => {
  it('opens that place instead of the persisted one', () => {
    expect(resolveBootPlace({ place: 'sales' }, 'ops')).toBe('sales')
  })
  it('still loses to a feed deep link (the feed is a sheet OVER whatever place is under it)', () => {
    expect(resolveBootPlace({ feed: true, place: 'sales' }, 'ops')).toBe('ask')
  })
  // W2-1: a hash that NAMES a place (e.g. `#exp/brain-b/dms?thread=<uuid>`)
  // must win over a bare thread id — that thread is a DM peer opening on the
  // place the hash named, not an Ask conversation. Only a thread with NO
  // place segment (the Ask push's own `#exp/v2/ask?thread=<uuid>` shape)
  // still means Ask, covered by the 'a thread deep link' case above.
  it('a place beats a thread id on the SAME boot', () => {
    expect(resolveBootPlace({ thread: 'abc', place: 'sales' }, 'ops')).toBe('sales')
    expect(resolveBootPlace({ thread: 'abc', place: 'dms' }, 'ops')).toBe('dms')
  })
  it('a bare boot still lands where he left off', () => {
    expect(resolveBootPlace({ place: null }, 'ops')).toBe('ops')
  })
  it('Sales is a tab and the Sales job maps to it', () => {
    expect(TABS).toContain('sales')
    expect(tabForJob('sales')).toBe('sales')
    expect(jobForTab('sales')).toBe('sales')
  })
})
