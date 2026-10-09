// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { armUpdateReload, isEditing, placeOf } from './updateReload'

let clock = 0
const setup = (idleMs = 1000) => {
  const reload = vi.fn()
  const u = armUpdateReload({ reload, idleMs, hiddenMs: 100, checkMs: 50, now: () => clock })
  return { u, reload }
}
const hide = (h: boolean) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') })
  document.dispatchEvent(new Event('visibilitychange'))
}
const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }

beforeEach(() => { vi.useFakeTimers(); clock = 0; document.body.innerHTML = ''; hide(false) })
afterEach(() => { vi.useRealTimers() })

describe('a new build reloads only at a quiet moment (Ivan 09-28)', () => {
  it('does nothing before a new build takes over', () => {
    const { reload } = setup()
    clock = 10_000; vi.advanceTimersByTime(10_000); hide(true); vi.advanceTimersByTime(1000)
    expect(reload).not.toHaveBeenCalled()
  })

  it('never reloads while a field is focused, even idle or hidden', () => {
    const { u, reload } = setup()
    document.body.innerHTML = '<textarea data-autosave></textarea>'
    const ta = document.querySelector('textarea')!
    ta.focus(); expect(isEditing(document)).toBe(true)
    u.request()
    clock = 60_000; vi.advanceTimersByTime(1000)
    hide(true); vi.advanceTimersByTime(1000)
    expect(reload).not.toHaveBeenCalled()
    ta.blur(); vi.advanceTimersByTime(100)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('waits while typed reply text is unsent, even after blur; the self-saving draft does not hold it', () => {
    const { u, reload } = setup()
    document.body.innerHTML = '<textarea id="reply"></textarea><div data-autosave><textarea id="draft"></textarea></div>'
    const reply = document.getElementById('reply') as HTMLTextAreaElement
    const draft = document.getElementById('draft') as HTMLTextAreaElement
    type(draft, 'edited draft')
    type(reply, 'half a reply')
    u.request(); hide(true); vi.advanceTimersByTime(1000)
    expect(reload).not.toHaveBeenCalled()
    type(reply, '') // sent: the composer cleared
    vi.advanceTimersByTime(200)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads a few seconds into the background, not at once', () => {
    const { u, reload } = setup()
    u.request(); hide(true)
    vi.advanceTimersByTime(60)
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('iPhone: timers freeze in the background, so coming back after a while reloads', () => {
    const { u, reload } = setup()
    u.request(); hide(true)
    clock = 5_000 // iOS suspended the app: no timer ran while it was away
    hide(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('a quick look away and back does not reload', () => {
    const { u, reload } = setup()
    u.request(); hide(true); vi.advanceTimersByTime(40); hide(false); vi.advanceTimersByTime(40)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads after the idle window, and any touch restarts it', () => {
    const { u, reload } = setup(1000)
    u.request()
    clock = 900; window.dispatchEvent(new Event('pointerdown')); vi.advanceTimersByTime(50)
    clock = 1500; vi.advanceTimersByTime(50)
    expect(reload).not.toHaveBeenCalled()
    clock = 1950; vi.advanceTimersByTime(50)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('a change of place reloads; opening a conversation does not', () => {
    const { u, reload } = setup()
    u.request()
    const nav = (a: string, b: string) => window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: `https://x/#${a}`, newURL: `https://x/#${b}` }))
    nav('exp/d/dms', 'exp/d/dms?thread=abc')
    expect(reload).not.toHaveBeenCalled()
    nav('exp/d/dms?thread=abc', 'exp/d/lanes')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(placeOf('https://x/#exp/d/dms?thread=1')).toBe('exp/d/dms')
  })

  it('a page chunk that left with the deploy reloads at once', () => {
    const { u, reload } = setup()
    document.body.innerHTML = '<input type="text">'
    document.querySelector('input')!.focus()
    u.request()
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
