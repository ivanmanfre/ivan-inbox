// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useHoverIntent } from './useHoverIntent'

const el = () => document.createElement('button')
const ptr = (target: HTMLElement, pointerType = 'mouse') => ({ currentTarget: target, pointerType }) as unknown as React.PointerEvent<HTMLElement>
const foc = (target: HTMLElement) => ({ currentTarget: target }) as unknown as React.FocusEvent<HTMLElement>
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useHoverIntent', () => {
  it('opens after 500 ms, not at 499', () => {
    const { result } = renderHook(() => useHoverIntent())
    const a = el()
    act(() => result.current.bind('a').onPointerEnter(ptr(a)))
    tick(499)
    expect(result.current.open).toBeNull()
    tick(1)
    expect(result.current.open).toBe('a')
    expect(result.current.anchor).not.toBeNull()
  })

  it('a second card within 900 ms of the last one opens after 80 ms', () => {
    const { result } = renderHook(() => useHoverIntent())
    const a = el(), b = el()
    act(() => result.current.bind('a').onPointerEnter(ptr(a)))
    tick(500)
    act(() => result.current.bind('a').onPointerLeave(ptr(a)))
    tick(140)
    expect(result.current.open).toBeNull()
    tick(400) // 400 ms after it closed: still warm
    act(() => result.current.bind('b').onPointerEnter(ptr(b)))
    tick(79)
    expect(result.current.open).toBeNull()
    tick(1)
    expect(result.current.open).toBe('b')
  })

  it('moving straight from an open card to the next opens it after 80 ms, even when the first was open long', () => {
    const { result } = renderHook(() => useHoverIntent())
    const a = el(), b = el()
    act(() => result.current.bind('a').onPointerEnter(ptr(a)))
    tick(3000)
    act(() => { result.current.bind('a').onPointerLeave(ptr(a)); result.current.bind('b').onPointerEnter(ptr(b)) })
    tick(80)
    expect(result.current.open).toBe('b')
  })

  it('cold again 900 ms after the last card closed', () => {
    const { result } = renderHook(() => useHoverIntent())
    const a = el(), b = el()
    act(() => result.current.bind('a').onPointerEnter(ptr(a)))
    tick(500)
    act(() => result.current.bind('a').onPointerLeave(ptr(a)))
    tick(140 + 900)
    act(() => result.current.bind('b').onPointerEnter(ptr(b)))
    tick(80)
    expect(result.current.open).toBeNull()
    tick(420)
    expect(result.current.open).toBe('b')
  })

  it('leaving closes after 140 ms', () => {
    const { result } = renderHook(() => useHoverIntent())
    const a = el()
    act(() => result.current.bind('a').onPointerEnter(ptr(a)))
    tick(500)
    act(() => result.current.bind('a').onPointerLeave(ptr(a)))
    tick(139)
    expect(result.current.open).toBe('a')
    tick(1)
    expect(result.current.open).toBeNull()
  })

  it('leaving before it opens cancels the open', () => {
    const { result } = renderHook(() => useHoverIntent())
    const a = el()
    act(() => result.current.bind('a').onPointerEnter(ptr(a)))
    tick(300)
    act(() => result.current.bind('a').onPointerLeave(ptr(a)))
    tick(1000)
    expect(result.current.open).toBeNull()
  })

  it('keyboard focus opens like hover; blur closes', () => {
    const { result } = renderHook(() => useHoverIntent())
    const a = el()
    act(() => result.current.bind('a').onFocus(foc(a)))
    tick(499)
    expect(result.current.open).toBeNull()
    tick(1)
    expect(result.current.open).toBe('a')
    act(() => result.current.bind('a').onBlur(foc(a)))
    tick(140)
    expect(result.current.open).toBeNull()
  })

  it('close() shuts it at once and cancels pending timers', () => {
    const { result } = renderHook(() => useHoverIntent())
    const a = el(), b = el()
    act(() => result.current.bind('a').onPointerEnter(ptr(a)))
    tick(500)
    act(() => result.current.bind('b').onPointerEnter(ptr(b)))
    act(() => result.current.close())
    expect(result.current.open).toBeNull()
    tick(2000)
    expect(result.current.open).toBeNull()
  })

  it('touch never opens it, and nothing opens when it is off', () => {
    const { result } = renderHook(() => useHoverIntent())
    const a = el()
    act(() => result.current.bind('a').onPointerEnter(ptr(a, 'touch')))
    tick(1000)
    expect(result.current.open).toBeNull()
    const off = renderHook(() => useHoverIntent(false))
    act(() => { off.result.current.bind('a').onPointerEnter(ptr(a)); off.result.current.bind('a').onFocus(foc(a)) })
    tick(1000)
    expect(off.result.current.open).toBeNull()
  })
})
