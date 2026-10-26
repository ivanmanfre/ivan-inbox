// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QuickDiscard } from './QuickDiscard'
const discard = vi.fn(async () => {})
const open = vi.fn()
function mount() { return render(<QuickDiscard name="Dana" run={discard}><div role="button" onClick={open}>Dana</div></QuickDiscard>) }
// jsdom does not implement PointerEvent or capture. MouseEvent carries the coordinates we use.
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('PointerEvent', MouseEvent); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 2000) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
const swipe = (x: number, y = 0, cancel = false) => {
  const row = screen.getByText('Dana')
  fireEvent.pointerDown(row, { clientX: 10, clientY: 10, button: 0 })
  fireEvent.pointerMove(row, { clientX: 10 + x, clientY: 10 + y, button: 0 })
  fireEvent[cancel ? 'pointerCancel' : 'pointerUp'](row, { clientX: 10 + x, clientY: 10 + y, button: 0 })
}
it('keeps the bin hidden until a right swipe reveals it', async () => {
  mount()
  expect(screen.queryByRole('button', { name: 'Discard draft to Dana' })).toBeNull()
  await act(async () => swipe(65))
  expect(discard).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Discard draft to Dana' })))
  expect(discard).toHaveBeenCalledTimes(1)
  expect(open).not.toHaveBeenCalled()
})
it('reveals the bin with a right drag and consumes its click', async () => {
  mount()
  await act(async () => swipe(105))
  fireEvent.click(screen.getByText('Dana'))
  expect(discard).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Discard draft to Dana' })).toBeTruthy()
  expect(open).not.toHaveBeenCalled()
})
it('leaves short drags, left drags, vertical scrolling and cancelled gestures alone', () => {
  mount()
  swipe(30); swipe(-110); swipe(100, 120); swipe(105, 0, true)
  expect(discard).not.toHaveBeenCalled()
})
it('does not turn a gesture starting on a button into a discard', async () => {
  mount()
  await act(async () => swipe(65))
  const button = screen.getByRole('button', { name: 'Discard draft to Dana' })
  fireEvent.pointerDown(button, { clientX: 10, clientY: 10, button: 0 })
  fireEvent.pointerMove(button, { clientX: 120, clientY: 10, button: 0 })
  fireEvent.pointerUp(button, { clientX: 120, clientY: 10, button: 0 })
  expect(discard).not.toHaveBeenCalled()
})
it('supports rightward trackpad swipes and ignores momentum on the next row', async () => {
  const view = mount()
  const row = screen.getByText('Dana')
  fireEvent.wheel(row, { deltaX: -50, deltaY: 1 })
  await act(async () => fireEvent.wheel(row, { deltaX: -55, deltaY: 1 }))
  expect(discard).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Discard draft to Dana' })).toBeTruthy()
  view.unmount(); mount()
  await act(async () => fireEvent.wheel(screen.getByText('Dana'), { deltaX: -120, deltaY: 1 }))
  expect(discard).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Discard draft to Dana' })).toBeNull()
})
it('keeps vertical wheel scrolling available and normal taps opening the row', () => {
  mount()
  expect(fireEvent.wheel(screen.getByText('Dana'), { deltaX: -5, deltaY: 70 })).toBe(true)
  fireEvent.click(screen.getByText('Dana'))
  expect(discard).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalledTimes(1)
})
it('blocks repeated button presses until the write finishes', async () => {
  let finish!: () => void
  discard.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  mount()
  await act(async () => swipe(65))
  const button = screen.getByRole('button', { name: 'Discard draft to Dana' })
  fireEvent.click(button); fireEvent.click(button)
  expect(discard).toHaveBeenCalledTimes(1)
  await act(async () => finish())
})

it('supports keyboard reveal and Escape to close the bin', () => {
  mount()
  fireEvent.keyDown(screen.getByText('Dana'), { key: 'ArrowRight' })
  expect(screen.getByRole('button', { name: 'Discard draft to Dana' })).toBeTruthy()
  fireEvent.keyDown(screen.getByText('Dana'), { key: 'Escape' })
  expect(screen.queryByRole('button', { name: 'Discard draft to Dana' })).toBeNull()
  expect(discard).not.toHaveBeenCalled()
})
