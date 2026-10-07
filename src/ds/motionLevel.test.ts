// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { motionLevel, useMotionLevel } from './motionLevel'

const none = { reduced: false, off: false, subtle: false, hidden: false }

describe('motionLevel', () => {
  it('full by default', () => expect(motionLevel(none)).toBe('full'))
  it('Reduce Motion → off', () => expect(motionLevel({ ...none, reduced: true, subtle: true })).toBe('off'))
  it('brief-motion-off → off', () => expect(motionLevel({ ...none, off: true })).toBe('off'))
  it('brief-motion-subtle → subtle', () => expect(motionLevel({ ...none, subtle: true })).toBe('subtle'))
  it('a hidden page → off', () => expect(motionLevel({ ...none, hidden: true })).toBe('off'))
})

describe('useMotionLevel', () => {
  afterEach(() => { document.documentElement.className = ''; vi.restoreAllMocks() })
  it('follows the native classes live', async () => {
    window.matchMedia = window.matchMedia ?? ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
    const { result } = renderHook(() => useMotionLevel())
    expect(result.current).toBe('full')
    await act(async () => { document.documentElement.classList.add('brief-motion-subtle'); await Promise.resolve() })
    expect(result.current).toBe('subtle')
    await act(async () => { document.documentElement.classList.add('brief-motion-off'); await Promise.resolve() })
    expect(result.current).toBe('off')
  })
  it('reads prefers-reduced-motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(q => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
    const { result } = renderHook(() => useMotionLevel())
    expect(result.current).toBe('off')
  })
})
