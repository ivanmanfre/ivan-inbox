import { describe, expect, it } from 'vitest'
import { asMessage, cacheable, holdLeft, holdStart, linksIn, mergeRows, optimisticPair, parseSse, type DeskMessage } from './model'
import { keyboardInset } from './useKeyboardInset'

const row = (over: Partial<DeskMessage> & { id: string }): DeskMessage => asMessage({ role: 'assistant', origin: 'desk', body: 'x', created_at: '2026-11-18T10:00:00.000Z', ...over })

describe('mergeRows', () => {
  it('replaces the optimistic user row and the stream placeholder when the stored rows land', () => {
    const [me, ph] = optimisticPair('whats going out', 'k1', new Date('2026-11-18T10:00:00.000Z'))
    let list = [me, ph]
    list = mergeRows(list, [row({ id: 'u1', role: 'user', origin: 'operator', client_key: 'k1', body: 'whats going out', created_at: '2026-11-18T10:00:00.100Z' })])
    expect(list.map(m => m.id)).toEqual(['u1', 'stream:k1'])
    list = mergeRows(list, [row({ id: 'a1', created_at: '2026-11-18T10:00:02.000Z', body: 'Four posts.' })])
    expect(list.map(m => m.id)).toEqual(['u1', 'a1'])
  })
  it('an UPDATE replaces the row with the same id, never duplicates', () => {
    const list = mergeRows([row({ id: 'a1', body: 'old' })], [row({ id: 'a1', body: 'new' })])
    expect(list).toHaveLength(1)
    expect(list[0].body).toBe('new')
  })
  it('a proactive row does not eat a stream that is still open', () => {
    const [me, ph] = optimisticPair('hi', 'k2', new Date('2026-11-18T10:00:00.000Z'))
    const list = mergeRows([me, ph], [row({ id: 'p1', origin: 'proactive', created_at: '2026-11-18T10:00:01.000Z' })])
    expect(list.map(m => m.id)).toContain('stream:k2')
  })
  it('an older history row does not replace the open stream', () => {
    const [me, ph] = optimisticPair('hi', 'k3', new Date('2026-11-18T10:00:00.000Z'))
    const list = mergeRows([me, ph], [row({ id: 'old', created_at: '2026-11-17T09:00:00.000Z' })])
    expect(list.map(m => m.id)).toEqual(['old', 'local:k3', 'stream:k3'])
  })
  it('a history read landing mid-stream keeps the open stream and the order', () => {
    const [me, ph] = optimisticPair('hi', 'k5', new Date('2026-11-18T10:00:00.000Z'))
    const acked = { ...me, id: 'u5', local: undefined }
    const list = mergeRows([acked, ph], [
      row({ id: 'h1', created_at: '2026-11-17T09:00:00.000Z' }),
      row({ id: 'u5', role: 'user', origin: 'operator', client_key: 'k5', body: 'hi', created_at: '2026-11-18T10:00:00.060Z' }),
    ])
    expect(list.map(m => m.id)).toEqual(['h1', 'u5', 'stream:k5'])
    const done = mergeRows(list.filter(m => m.id !== 'stream:k5'), [row({ id: 'a5', created_at: '2026-11-18T10:00:01.000Z' })])
    expect(done.map(m => m.id)).toEqual(['h1', 'u5', 'a5'])
  })
  it('a question and its answer stamped in the same millisecond keep their order', () => {
    const at = '2026-11-18T10:00:00.060Z'
    const list = mergeRows([], [row({ id: 'r-12', created_at: at }), row({ id: 'u-11', role: 'user', origin: 'operator', created_at: at })])
    expect(list.map(m => m.id)).toEqual(['u-11', 'r-12'])
  })
  it('the cache keeps stored rows only', () => {
    const [me, ph] = optimisticPair('hi', 'k4', new Date())
    expect(cacheable([row({ id: 'a' }), me, ph]).map(m => m.id)).toEqual(['a'])
  })
})

describe('parseSse', () => {
  it('splits whole frames and keeps the unfinished rest', () => {
    const { frames, rest } = parseSse('event: ack\ndata: {"user_message_id":"u1","client_key":"k"}\n\nevent: delta\ndata: {"text":"Fo"}\n\nevent: del')
    expect(frames).toEqual([
      { event: 'ack', data: { user_message_id: 'u1', client_key: 'k' } },
      { event: 'delta', data: { text: 'Fo' } },
    ])
    expect(rest).toBe('event: del')
  })
  it('ignores comments and tolerates CRLF', () => {
    const { frames } = parseSse(': ping\r\n\r\nevent: final\r\ndata: {"message":{"id":"a"}}\r\n\r\n')
    expect(frames).toEqual([{ event: 'final', data: { message: { id: 'a' } } }])
  })
})

describe('held actions', () => {
  it('a fresh hold counts the whole 8 s from when it is seen', () => {
    const now = Date.parse('2026-11-18T10:00:05Z')
    expect(holdStart('2026-11-18T10:00:03Z', now, 8000)).toBe(now)
    expect(holdLeft(now, 8000, now + 2500)).toBe(6)
    expect(holdLeft(now, 8000, now + 9000)).toBe(0)
  })
  it('a hold from a closed app is stale, never committed silently', () => {
    expect(holdStart('2026-11-18T09:00:00Z', Date.parse('2026-11-18T10:00:00Z'), 8000)).toBe('stale')
  })
})

describe('small helpers', () => {
  it('finds links without trailing punctuation', () => {
    expect(linksIn('copy this https://example.com/post/1, and https://example.com/post/1.')).toEqual(['https://example.com/post/1'])
  })
  it('keyboard inset is the covered height, 0 when the bars just wobble', () => {
    expect(keyboardInset(844, 844, 0)).toBe(0)
    expect(keyboardInset(844, 820, 0)).toBe(0)
    expect(keyboardInset(844, 508, 0)).toBe(336)
  })
})
