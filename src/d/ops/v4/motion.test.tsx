// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { animateOps, useDeferredLoading } from './motion'
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); document.documentElement.classList.remove('brief-motion-off') })
describe('Ops motion gates', () => {
  it('does not animate under reduced motion or native Motion Off', () => {
    const el = document.createElement('div'); el.animate = vi.fn()
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    animateOps(el, [{ opacity: 0 }, { opacity: 1 }], 240)
    expect(el.animate).not.toHaveBeenCalled()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    document.documentElement.classList.add('brief-motion-off')
    animateOps(el, [{ opacity: 0 }, { opacity: 1 }], 240)
    expect(el.animate).not.toHaveBeenCalled()
  })
  it('a loading skeleton waits 120ms then holds for 380ms', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ loading }) => useDeferredLoading(loading), { initialProps: { loading: true } })
    act(() => vi.advanceTimersByTime(119)); expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1)); expect(result.current).toBe(true)
    rerender({ loading: false })
    act(() => vi.advanceTimersByTime(379)); expect(result.current).toBe(true)
    act(() => vi.advanceTimersByTime(1)); expect(result.current).toBe(false)
  })
})

it('uses 420ms overshoot only for a successful approve, and off skips completion effects', async () => {
  const { finishAction } = await import('./motion')
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const root = document.createElement('div'); root.innerHTML = '<div data-card="a"><div class="op-kp"><span class="d-face">Approve</span></div></div>'
  const face = root.querySelector<HTMLElement>('.d-face')!
  const animate = vi.fn(() => ({ finished: Promise.resolve(), finish: vi.fn() }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true })
  await finishAction(root, 'a', 'Approved', null)
  expect(animate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ transform: 'scale(1.3)' })]), expect.objectContaining({ duration: 420 }))
  animate.mockClear()
  await finishAction(root, 'a', 'Discarded', null)
  expect(animate).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 0 }], expect.objectContaining({ duration: 120 }))
  animate.mockClear(); document.documentElement.classList.add('brief-motion-off')
  await finishAction(root, 'a', 'Approved', null)
  expect(animate).not.toHaveBeenCalled(); expect(face.querySelector('.op4-check')).toBeNull()
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate
})
