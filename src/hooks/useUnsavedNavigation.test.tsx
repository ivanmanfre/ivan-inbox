// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashNavigationAllowed } from '../lib/navigationGuard'
import { useUnsavedNavigation } from './useUnsavedNavigation'

beforeEach(() => history.replaceState(null, '', '#exp/d/content/now?draft=one'))
afterEach(cleanup)

function move(hash: string) {
  history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

describe('unsaved editor navigation', () => {
  it('keeps the editor and its hash when a dirty navigation is cancelled', async () => {
    let answer!: (ok: boolean) => void
    const confirm = vi.fn(() => new Promise<boolean>(resolve => { answer = resolve }))
    renderHook(() => useUnsavedNavigation(true, confirm))
    const routeChanged = vi.fn()
    window.addEventListener('hashchange', routeChanged)
    try {
      act(() => move('#exp/d/content/ideas'))
      expect(location.hash).toBe('#exp/d/content/now?draft=one')
      expect(routeChanged).not.toHaveBeenCalled()
      await act(async () => answer(false))
      expect(location.hash).toBe('#exp/d/content/now?draft=one')
    } finally { window.removeEventListener('hashchange', routeChanged) }
  })

  it('continues to the requested destination once after explicit discard', async () => {
    const confirm = vi.fn(async () => true)
    const historyLength = history.length
    renderHook(() => useUnsavedNavigation(true, confirm))
    await act(async () => move('#exp/d/content/results'))
    await waitFor(() => expect(location.hash).toBe('#exp/d/content/results'))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(history.length).toBe(historyLength)
  })

  it('uses the latest dirty state without replacing the route listener', async () => {
    const confirm = vi.fn(async () => false)
    const { rerender } = renderHook(({ dirty }) => useUnsavedNavigation(dirty, confirm), { initialProps: { dirty: false } })
    act(() => move('#exp/d/content/now?draft=two'))
    rerender({ dirty: true })
    await act(async () => move('#exp/d/content/ideas'))
    expect(location.hash).toBe('#exp/d/content/now?draft=two')
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('asks once for repeated local exit requests and permits clean exits', async () => {
    let answer!: (ok: boolean) => void
    const confirm = vi.fn(() => new Promise<boolean>(resolve => { answer = resolve }))
    const { result, rerender } = renderHook(({ dirty }) => useUnsavedNavigation(dirty, confirm), { initialProps: { dirty: true } })
    const first = result.current.canLeave()
    expect(await result.current.canLeave()).toBe(false)
    answer(false)
    expect(await first).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    rerender({ dirty: false })
    expect(await result.current.canLeave()).toBe(true)
  })

  it('warns before unloading dirty text and stops warning once clean', () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedNavigation(dirty, async () => false), { initialProps: { dirty: true } })
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    rerender({ dirty: false })
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
  })
})

it('restores the last accepted replaceState destination rather than the initial editor route', async () => {
  const { result } = renderHook(() => useUnsavedNavigation(true, async () => false))
  history.replaceState(null, '', '#exp/d/content/strategy?lane=arch&section=direction')
  result.current.rememberHash()
  await act(async () => move('#exp/d/content/ideas'))
  expect(location.hash).toBe('#exp/d/content/strategy?lane=arch&section=direction')
})

it('vetoes routing explicitly even when the router runs before the native hash listener', async () => {
  const confirm = vi.fn(async () => false), routeChanged = vi.fn()
  const router = () => { if (hashNavigationAllowed()) routeChanged() }
  renderHook(() => useUnsavedNavigation(true, confirm))
  await act(async () => {
    history.replaceState(null, '', '#exp/d/content/ideas')
    router()
  })
  expect(routeChanged).not.toHaveBeenCalled()
  expect(confirm).toHaveBeenCalledOnce()
  expect(location.hash).toContain('draft=one')
})
