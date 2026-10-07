// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { __resetSkinForTests } from '../../ds/skin'
import { DESK_MQ, DESK_MQ_SHELL, deskQuery } from './layoutQuery'

// A tiny evaluator for the two predicates, so the matrix is checked as numbers.
function matches(q: string, w: number, pointer: 'fine' | 'coarse'): boolean {
  return q.split(',').some(part => {
    const min = Number(/min-width:\s*(\d+)px/.exec(part)?.[1] ?? 0)
    const p = /pointer:\s*(fine|coarse)/.exec(part)?.[1]
    return w >= min && (!p || p === pointer)
  })
}

afterEach(() => __resetSkinForTests())

describe('the desktop predicate', () => {
  it('flag off: 1000px, as today', () => {
    expect(deskQuery()).toBe(DESK_MQ)
    expect(matches(DESK_MQ, 964, 'fine')).toBe(false)
  })
  it('shell on: a fine pointer from 720px is desktop; touch stays phone below 1000', () => {
    __resetSkinForTests(new Set(['shell']))
    expect(deskQuery()).toBe(DESK_MQ_SHELL)
    expect(matches(DESK_MQ_SHELL, 764, 'fine')).toBe(true)
    expect(matches(DESK_MQ_SHELL, 1024, 'coarse')).toBe(true)
    expect(matches(DESK_MQ_SHELL, 820, 'coarse')).toBe(false)
    expect(matches(DESK_MQ_SHELL, 390, 'fine')).toBe(false)
    expect(matches(DESK_MQ_SHELL, 390, 'coarse')).toBe(false)
  })
})
