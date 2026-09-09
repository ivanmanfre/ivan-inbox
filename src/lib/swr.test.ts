import { describe, expect, it, beforeEach } from 'vitest'
import {
  SWR_CAP_BYTES, dropForeignKeys, okToCache, readSwr, readUserIdFrom,
  swrKey, swrKeyUser, swrSafe, writeSwr,
} from './swr'

// A localStorage stand-in with the two properties the layer actually uses
// (index access via key(i)/length, and a throwing setItem for the quota path).
class MemStore {
  map = new Map<string, string>()
  throwOnSet = false
  get length() { return this.map.size }
  key(i: number) { return [...this.map.keys()][i] ?? null }
  getItem(k: string) { return this.map.get(k) ?? null }
  setItem(k: string, v: string) { if (this.throwOnSet) throw new Error('QuotaExceeded'); this.map.set(k, v) }
  removeItem(k: string) { this.map.delete(k) }
  clear() { this.map.clear() }
}

let store: MemStore
beforeEach(() => {
  store = new MemStore()
  ;(globalThis as unknown as { localStorage: MemStore }).localStorage = store
})

describe('key derivation', () => {
  it('carries the user id and the query, in that order', () => {
    expect(swrKey('user-a', 'dms/threads')).toBe('swr1:user-a:dms/threads')
  })
  it('reads the owner back out of a key', () => {
    expect(swrKeyUser('swr1:user-a:dms/threads')).toBe('user-a')
  })
  it('claims no key it does not own', () => {
    expect(swrKeyUser('today-cache')).toBeNull()
    expect(swrKeyUser('sb-abc-auth-token')).toBeNull()
  })
})

describe('the user id behind the key', () => {
  it('prefers the session object user id', () => {
    expect(readUserIdFrom(JSON.stringify({ user: { id: 'uid-1' } }))).toBe('uid-1')
  })
  it('falls back to the JWT sub claim', () => {
    const body = btoa(JSON.stringify({ sub: 'uid-2' }))
    expect(readUserIdFrom(JSON.stringify({ access_token: `h.${body}.s` }))).toBe('uid-2')
  })
  it('is null on junk, never a guess', () => {
    expect(readUserIdFrom(null)).toBeNull()
    expect(readUserIdFrom('not json')).toBeNull()
    expect(readUserIdFrom(JSON.stringify({}))).toBeNull()
  })
})

describe('the 4xx guard', () => {
  it('lets a 2xx through', () => {
    expect(okToCache(200)).toBe(true)
    expect(okToCache(206)).toBe(true)
  })
  it('refuses every failure, and a redirect it did not follow', () => {
    for (const s of [301, 400, 401, 403, 404, 409, 429, 500, 502, 503]) {
      expect(okToCache(s)).toBe(false)
    }
  })
})

describe('the capability-link lock', () => {
  it('refuses a payload carrying a bearer link', () => {
    expect(swrSafe(JSON.stringify({ a: 1 }))).toBe(true)
    expect(swrSafe(JSON.stringify({ approve_url: 'x' }))).toBe(false)
    expect(swrSafe(JSON.stringify({ u: 'https://x.dev/scan?k=secret' }))).toBe(false)
    expect(swrSafe(JSON.stringify({ skip_url: 'x' }))).toBe(false)
    expect(swrSafe(JSON.stringify({ action_url: 'x' }))).toBe(false)
  })
  it('refuses the write outright rather than stripping it', () => {
    expect(writeSwr('q', { approve_url: 'https://x/a' }, 'user-a')).toBe('unsafe')
    expect(store.getItem(swrKey('user-a', 'q'))).toBeNull()
  })
})

describe('write from the reconciled state', () => {
  it('round-trips what it was handed', () => {
    expect(writeSwr('dms/threads', { rows: ['a', 'b'] }, 'user-a')).toBe('written')
    expect(readSwr<{ rows: string[] }>('dms/threads', 'user-a')?.payload.rows).toEqual(['a', 'b'])
  })
  it('a second write REPLACES, so a row removed locally does not come back', () => {
    writeSwr('dms/threads', { rows: ['a', 'b'] }, 'user-a')
    writeSwr('dms/threads', { rows: ['a'] }, 'user-a')
    expect(readSwr<{ rows: string[] }>('dms/threads', 'user-a')?.payload.rows).toEqual(['a'])
  })
  it('stamps savedAt and the owner on every entry', () => {
    writeSwr('q', { n: 1 }, 'user-a')
    const e = readSwr<{ n: number }>('q', 'user-a')
    expect(e?.user).toBe('user-a')
    expect(Number.isNaN(Date.parse(e!.savedAt))).toBe(false)
  })
  it('writes nothing at all with no user', () => {
    expect(writeSwr('q', { n: 1 }, null)).toBe('no-user')
    expect(store.length).toBe(0)
  })
  it('refuses a payload over the cap rather than truncating it', () => {
    const big = { blob: 'x'.repeat(SWR_CAP_BYTES + 10) }
    expect(writeSwr('q', big, 'user-a')).toBe('too-big')
    expect(store.getItem(swrKey('user-a', 'q'))).toBeNull()
  })
  it('reports a quota failure instead of half-writing', () => {
    store.throwOnSet = true
    expect(writeSwr('q', { n: 1 }, 'user-a')).toBe('failed')
  })
})

describe('one user never reads another', () => {
  it('reads a miss for a different sub', () => {
    writeSwr('dms/threads', { rows: ['a'] }, 'user-a')
    expect(readSwr('dms/threads', 'user-b')).toBeNull()
  })
  it('reads a miss when signed out', () => {
    writeSwr('dms/threads', { rows: ['a'] }, 'user-a')
    expect(readSwr('dms/threads', null)).toBeNull()
  })
  it('refuses an entry whose stamped owner does not match its key', () => {
    store.setItem(swrKey('user-a', 'q'), JSON.stringify({ savedAt: 'x', user: 'user-b', payload: { n: 1 } }))
    expect(readSwr('q', 'user-a')).toBeNull()
  })
  it('drops the other account keys on the next write', () => {
    writeSwr('dms/threads', { rows: ['a'] }, 'user-a')
    writeSwr('dms/threads', { rows: ['z'] }, 'user-b')
    expect(store.getItem(swrKey('user-a', 'dms/threads'))).toBeNull()
    expect(readSwr<{ rows: string[] }>('dms/threads', 'user-b')?.payload.rows).toEqual(['z'])
  })
  it('never touches a key outside its own prefix', () => {
    store.setItem('today-cache', 'keep me')
    store.setItem('sb-ref-auth-token', 'keep me too')
    dropForeignKeys('user-a')
    expect(store.getItem('today-cache')).toBe('keep me')
    expect(store.getItem('sb-ref-auth-token')).toBe('keep me too')
  })
})
