import { describe, expect, it, vi } from 'vitest'
import { createIntent } from './intents'

describe('createIntent', () => {
  it('runs the live listener right away', () => {
    const i = createIntent()
    const fn = vi.fn()
    i.listen(fn)
    expect(i.request()).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('parks an ask made before anything listens, and runs it once on mount', () => {
    const i = createIntent()
    expect(i.request()).toBe(false)
    expect(i.request()).toBe(false)
    const fn = vi.fn()
    i.listen(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    // A later listener does not replay it.
    const again = vi.fn()
    i.listen(again)
    expect(again).not.toHaveBeenCalled()
  })

  it('an unmounted listener no longer runs', () => {
    const i = createIntent()
    const fn = vi.fn()
    const off = i.listen(fn)
    off()
    expect(i.request()).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('createIntent without parking', () => {
  it('request(false) never leaves an ask behind for a later mount', () => {
    const i = createIntent()
    expect(i.request(false)).toBe(false)
    const fn = vi.fn()
    i.listen(fn)
    expect(fn).not.toHaveBeenCalled()
  })
})
