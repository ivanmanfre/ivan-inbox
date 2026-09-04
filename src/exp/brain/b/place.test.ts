import { beforeEach, describe, expect, it } from 'vitest'
import { readPlace, resolveBootPlace, tabForJob, writePlace } from './place'

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
