// @vitest-environment jsdom
import { useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useStickToEnd } from './motion'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('follows late conversation growth only while the reader is at the end', () => {
  const observed = new Map<Element, () => void>()
  class ResizeObserverStub {
    private callback: () => void
    constructor(callback: () => void) { this.callback = callback }
    observe(element: Element) { observed.set(element, this.callback) }
    disconnect() { observed.clear() }
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  function Thread() {
    const scroll = useRef<HTMLDivElement>(null)
    useStickToEnd(scroll, true)
    return <div data-testid="scroll" ref={scroll}><div data-testid="conversation" /></div>
  }
  const { getByTestId } = render(<Thread />)
  const scroll = getByTestId('scroll')
  const conversation = getByTestId('conversation')
  let height = 500
  Object.defineProperty(scroll, 'scrollHeight', { get: () => height })
  Object.defineProperty(scroll, 'clientHeight', { get: () => 200 })
  scroll.scrollTop = 300
  fireEvent.scroll(scroll)
  height = 650
  observed.get(conversation)?.()
  expect(scroll.scrollTop).toBe(650)
  scroll.scrollTop = 100
  fireEvent.scroll(scroll)
  height = 800
  observed.get(conversation)?.()
  expect(scroll.scrollTop).toBe(100)
})
