import { beforeEach, describe, expect, it } from 'vitest'
import { readPlace, readWorkTab, writePlace, writeWorkTab } from './place'

// This suite runs under vitest's default `node` environment (no jsdom, per
// test-setup.ts's own comment on why: no browser globals are assumed to
// exist). A tiny in-memory stub stands in for the real storage so the
// whitelist logic is exercised the same way it runs in a browser.
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null }
  setItem(k: string, v: string): void { this.map.set(k, v) }
  removeItem(k: string): void { this.map.delete(k) }
  clear(): void { this.map.clear() }
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
})

describe('place', () => {
  it('reads null when nothing is cached', () => {
    expect(readPlace()).toBeNull()
  })

  it('round-trips a valid place', () => {
    writePlace('feed')
    expect(readPlace()).toBe('feed')
  })

  it('rejects a value outside the whitelist', () => {
    localStorage.setItem('brain-a-place', 'somewhere-else')
    expect(readPlace()).toBeNull()
  })

  it('never throws when localStorage is unavailable', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(() => writePlace('ask')).not.toThrow()
    expect(readPlace()).toBeNull()
  })
})

describe('work tab', () => {
  it('defaults to content when nothing is cached', () => {
    expect(readWorkTab()).toBe('content')
  })

  it('round-trips a valid work job', () => {
    writeWorkTab('ops')
    expect(readWorkTab()).toBe('ops')
  })

  it('falls back to content for a job outside the work group', () => {
    localStorage.setItem('brain-a-worktab', 'settings')
    expect(readWorkTab()).toBe('content')
  })
})
