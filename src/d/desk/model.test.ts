import { describe, expect, it } from 'vitest'
import { asMessage, cacheable, cleanLabel, labelRef, holdLeft, holdStart, linksIn, mergeRows, optimisticPair, parseSse, type DeskMessage } from './model'
import { keyboardInset, keyboardOpen } from './useKeyboardInset'

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
    // iOS panned the visual viewport up: nothing covered below, the keyboard is still open.
    expect(keyboardInset(844, 508, 336)).toBe(0)
    expect(keyboardOpen(844, 508)).toBe(true)
    expect(keyboardOpen(844, 820)).toBe(false)
  })
})

describe('cleanLabel: server sentences read once, with no ref and no duplicated state', () => {
  const tgt = { first_line: 'A made up post about trains in the rain and a long platform wait.' }
  it('a held proposal drops Proposed and the ref, keeps the UTC offset, and names the post as this post', () => {
    const r = cleanLabel('Proposed (ref 1a2b3c4d): move "A made up post about trains in the rain and a long\n\nplatform wait." (no date) to Tue 9 Mar 2027, 10:45 (UTC+01:00).', tgt)
    expect(r).toEqual({ text: 'Move this post to Tue 9 Mar 2027, 10:45 (UTC+01:00).', stated: true })
  })
  it('an opener with a quote and "to" inside is replaced whole or not at all', () => {
    const line = 'A made up post: "send it to the team" was the whole brief'
    expect(cleanLabel(`Proposed (ref 1a2b3c4d): move "${line}" (no date) to Thu 26 Nov, 09:30 (UTC+01:00).`, { first_line: line }).text)
      .toBe('Move this post to Thu 26 Nov, 09:30 (UTC+01:00).')
    expect(cleanLabel(`Proposed (ref 1a2b3c4d): move "A different opener" to Thu 26 Nov.`, { first_line: line }).text)
      .toBe('Move "A different opener" to Thu 26 Nov.')
  })
  it('a quote inside the post does not cut it short', () => {
    const r = cleanLabel('Proposed (ref 1a2b3c4d): pull "A made up post about trains in the rain, "late again" said the man" (Thu 19 Nov, 18:30).', { first_line: 'A made up post about trains in the rain, "late again" said the man' })
    expect(r.text).toBe('Pull this post (Thu 19 Nov, 18:30).')
  })
  it('a done sentence stays as written and is marked stated', () => {
    expect(cleanLabel('Moved "A made up post about trains…" to Tue 9 Mar, 10:45', tgt)).toEqual({ text: 'Moved this post to Tue 9 Mar, 10:45', stated: true })
    expect(cleanLabel('Done (ref 1a2b3c4d): approve "A made up post about trains in the rain and a long platform wait."', tgt).text).toBe('Approve this post')
  })
  it('a bare state word becomes a plain sentence', () => {
    expect(cleanLabel('Undone.')).toEqual({ text: 'Back as it was.', stated: true })
    expect(cleanLabel('Cancelled. Nothing changed.')).toEqual({ text: 'Nothing changed.', stated: true })
  })
  it('"(no date)" and a ref inside a quote stay as written', () => {
    expect(cleanLabel('Saved as an idea: "Posts with (no date) and (ref 1a2b3c4d) in them". The scorer picks it up next.').text)
      .toBe('Saved as an idea: "Posts with (no date) and (ref 1a2b3c4d) in them". The scorer picks it up next.')
  })
  it('an imperative label keeps its prefix (not stated)', () => {
    expect(cleanLabel('Approve the trains post')).toEqual({ text: 'Approve the trains post', stated: false })
  })
  it('without a matching target the post text stays', () => {
    expect(cleanLabel('Saved as an idea: "Post on DMs". The scorer picks it up next.').text).toBe('Saved as an idea: "Post on DMs". The scorer picks it up next.')
  })
})

describe('labelRef: only the reference of the card itself', () => {
  it('reads the opening ref and never one quoted in a reason', () => {
    expect(labelRef('Proposed (ref 1a2b3c4d): delete "A made up post" (no date).')).toBe('1a2b3c4d')
    expect(labelRef('Moved (ref 5e6f7a8b) "A made up post" to Tue 9 Mar')).toBe('5e6f7a8b')
    expect(labelRef('Not done: it clashes with the post at (ref 9c9c9c9c), so I left it.')).toBeNull()
  })
})
