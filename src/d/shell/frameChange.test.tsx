// @vitest-environment jsdom
// SPEC-shell-spacing §4.2: the native frame handshake (brief:frame) and the main-column tier.
import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRIEF_FRAME_EVENT, useShellGeometry } from './useShellGeometry'

// jsdom has no layout: widths come from data-w, and ResizeObserver is a manual fake.
let ros: { cb: () => void; els: Element[] }[] = []
class FakeRO { cb: () => void; els: Element[] = []; constructor(cb: () => void) { this.cb = cb; ros.push(this) } observe(e: Element) { this.els.push(e) } disconnect() { ros = ros.filter(r => r !== this) } unobserve() {} }
const fireRO = () => ros.forEach(r => r.cb())
const rect = (w: number) => ({ width: w, height: 800, top: 0, left: 0, right: w, bottom: 800, x: 0, y: 0, toJSON() {} }) as DOMRect

function Frame({ claudeOpen, shell, out }: { claudeOpen: boolean; shell: boolean; out: { mode?: string; tier?: string | null } }) {
  const ref = useRef<HTMLDivElement>(null)
  const g = useShellGeometry(ref, { layout: 'desktop', claudeOpen, shell })
  out.mode = g.mode; out.tier = g.tier
  return <div ref={ref} className="d-app" data-w="0"><main className="d-main" data-w="0" />{claudeOpen && <aside className="d-claude" data-w="390" />}</div>
}

function setCanvas(container: HTMLElement, c: number, drawer: number) {
  container.querySelector<HTMLElement>('.d-app')!.dataset.w = String(c)
  container.querySelector<HTMLElement>('.d-main')!.dataset.w = String(c - drawer)
}

beforeEach(() => {
  ros = []
  vi.stubGlobal('ResizeObserver', FakeRO)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return rect(Number(this.dataset.w ?? 0)) })
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0 })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('useShellGeometry', () => {
  it('writes data-tier and --main-w on .d-main', () => {
    const out: { tier?: string | null } = {}
    const { container, rerender } = render(<Frame claudeOpen={false} shell out={out} />)
    setCanvas(container, 1144, 0)
    act(() => { fireRO() })
    rerender(<Frame claudeOpen={false} shell out={out} />)
    const main = container.querySelector<HTMLElement>('.d-main')!
    expect(main.dataset.tier).toBe('t1')
    expect(main.style.getPropertyValue('--main-w')).toBe('1144px')
  })

  it('a narrowing brief:frame applies synchronously; RO during the hold is ignored', () => {
    const out: { mode?: string; tier?: string | null } = {}
    const { container } = render(<Frame claudeOpen={false} shell out={out} />)
    setCanvas(container, 1272, 0); act(() => { fireRO() })
    expect(out.tier).toBe('t1')
    act(() => { window.dispatchEvent(new CustomEvent(BRIEF_FRAME_EVENT, { detail: { width: 808, ms: 380 } })) })
    expect(container.querySelector<HTMLElement>('.d-main')!.dataset.tier).toBe('t3')
    // Mid-animation the webview is still wide: ignored.
    setCanvas(container, 1100, 0); act(() => { fireRO() })
    expect(out.tier).toBe('t3')
    // After ms + 50 the truth wins.
    setCanvas(container, 808, 0)
    act(() => { vi.advanceTimersByTime(431) })
    expect(out.tier).toBe('t3')
  })

  it('a widening brief:frame holds the tier until the animation ends', () => {
    const out: { tier?: string | null } = {}
    const { container } = render(<Frame claudeOpen={false} shell out={out} />)
    setCanvas(container, 808, 0); act(() => { fireRO() })
    expect(out.tier).toBe('t3')
    act(() => { window.dispatchEvent(new CustomEvent(BRIEF_FRAME_EVENT, { detail: { width: 1272, ms: 380 } })) })
    expect(out.tier).toBe('t3')
    setCanvas(container, 1000, 0); act(() => { fireRO() })
    expect(out.tier).toBe('t3')
    setCanvas(container, 1272, 0)
    act(() => { vi.advanceTimersByTime(431) })
    expect(out.tier).toBe('t1')
  })

  it('a web view that lands late does not flip the tier back and forth', () => {
    const out: { mode?: string; tier?: string | null } = {}
    const { container } = render(<Frame claudeOpen shell out={out} />)
    setCanvas(container, 1092, 398); act(() => { fireRO() })
    expect(out).toMatchObject({ mode: 'dock', tier: 't3' })
    act(() => { window.dispatchEvent(new CustomEvent(BRIEF_FRAME_EVENT, { detail: { width: 964, ms: 380 } })) })
    expect(out).toMatchObject({ mode: 'over', tier: 't2' })
    // The native animation is over, the web view is still 1092 wide: nothing changes.
    setCanvas(container, 1092, 0)
    act(() => { vi.advanceTimersByTime(431) })
    expect(out).toMatchObject({ mode: 'over', tier: 't2' })
    setCanvas(container, 964, 0)
    act(() => { vi.advanceTimersByTime(60) })
    expect(out).toMatchObject({ mode: 'over', tier: 't2' })
  })

  it('the drawer docks at a 1144 canvas and goes over below 1064 (shell on); always docks with shell off', () => {
    const out: { mode?: string } = {}
    const { container, rerender } = render(<Frame claudeOpen shell out={out} />)
    setCanvas(container, 1144, 398); act(() => { fireRO() })
    expect(out.mode).toBe('dock')
    setCanvas(container, 964, 398); act(() => { fireRO() })
    expect(out.mode).toBe('over')
    rerender(<Frame claudeOpen shell={false} out={out} />)
    expect(out.mode).toBe('dock')
  })

  it('no listener leaks after unmount', () => {
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener')
    const out = {}
    const { unmount } = render(<Frame claudeOpen={false} shell out={out} />)
    unmount()
    const added = add.mock.calls.filter(c => String(c[0]) === BRIEF_FRAME_EVENT).length
    const removed = remove.mock.calls.filter(c => String(c[0]) === BRIEF_FRAME_EVENT).length
    expect(added).toBeGreaterThan(0)
    expect(removed).toBe(added)
    expect(ros.length).toBe(0)
  })
})
