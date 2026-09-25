// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Turn } from '../exp/v2c/chat/events'
import type { TurnRow } from './turns'
import {
  THREAD_CACHE_CAP_CHARS, emptyOverKnown, keepIds, readThreadCache, threadCacheKey, writeThreadCache,
} from './threadCache'

const U = 'user-a'
const T = '11111111-1111-4111-8111-111111111111'
const turn = (i: number, role: Turn['role'] = 'user', text = `t${i}`): Turn =>
  ({ id: `t${i}`, role, text, tools: [], error: null, turnId: `row${i}` })
const fromRows = (rows: TurnRow[]): Turn[] => rows.map((r, i) => turn(i, 'user', r.prompt))

beforeEach(() => localStorage.clear())

describe('threadCache', () => {
  it('round-trips turns for the same user and re-mints ids', () => {
    expect(writeThreadCache(T, { turns: [turn(1), turn(2, 'assistant')] }, U)).toBe('written')
    const got = readThreadCache(T, fromRows, U)
    expect(got?.turns.map(t => t.text)).toEqual(['t1', 't2'])
    expect(got?.turns.map(t => t.id)).toEqual(['c0', 'c1'])
  })

  it('never serves another user', () => {
    writeThreadCache(T, { turns: [turn(1)] }, U)
    expect(readThreadCache(T, fromRows, 'user-b')).toBeNull()
    writeThreadCache(T, { turns: [turn(1)] }, 'user-b')
    expect(localStorage.getItem(threadCacheKey(U))).toBeNull()
  })

  it('refuses to write an empty transcript', () => {
    writeThreadCache(T, { turns: [turn(1)] }, U)
    expect(writeThreadCache(T, { turns: [] }, U)).toBe('empty')
    expect(readThreadCache(T, fromRows, U)?.turns).toHaveLength(1)
  })

  it('redacts capability links out of bodies', () => {
    writeThreadCache(T, { turns: [turn(1, 'assistant', 'go https://x.io/a?k=secret now')] }, U)
    const raw = localStorage.getItem(threadCacheKey(U))!
    expect(raw).not.toContain('secret')
    expect(readThreadCache(T, fromRows, U)?.turns[0].text).toBe('go [link] now')
  })

  it('stays under the cap by trimming the oldest turns', () => {
    const big = Array.from({ length: 400 }, (_, i) => turn(i, 'assistant', 'x'.repeat(1000)))
    expect(writeThreadCache(T, { turns: big }, U)).toBe('written')
    expect(localStorage.getItem(threadCacheKey(U))!.length).toBeLessThanOrEqual(THREAD_CACHE_CAP_CHARS)
    const got = readThreadCache(T, fromRows, U)!
    expect(got.turns[got.turns.length - 1].turnId).toBe('row399')
  })

  it('converts worker rows through the caller', () => {
    const row = { id: 'r1', thread_id: T, prompt: 'hi', answer: 'yo', status: 'done' } as unknown as TurnRow
    writeThreadCache(T, { rows: [row] }, U)
    expect(readThreadCache(T, fromRows, U)?.turns[0].text).toBe('hi')
  })

  it('keeps on-screen ids across a fresh read of the same rows', () => {
    const prev = [{ ...turn(1), id: 'c0' }, { ...turn(1, 'assistant'), id: 'c1' }]
    const fresh = [turn(1), turn(1, 'assistant'), turn(2)]
    expect(keepIds(prev, fresh).map(t => t.id)).toEqual(['c0', 'c1', 't2'])
  })

  it('treats empty over known-non-empty as a failure', () => {
    expect(emptyOverKnown([turn(1)], 0)).toBe(true)
    expect(emptyOverKnown([], 0)).toBe(false)
    expect(emptyOverKnown([turn(1)], 3)).toBe(false)
  })
})
