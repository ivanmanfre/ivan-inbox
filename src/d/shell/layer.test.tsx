// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getFocusId, getSelected, isLayerMounted, registerRow, resetStore,
} from '../../exp/v2c/commandStore'
import { renderInFrame } from '../test-utils'
import { DLayer, layerCommands } from './Layer'
import { move, toggleFocused, visibleRows } from './layerDom'

// jsdom has no layout: every element reports offsetParent null. Rows "on screen" here.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return document.body } })
  resetStore()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

function page(rows: string[]) {
  return (
    <div className="d-body">
      <div className="cn-legacy wb-work">
        <input type="search" aria-label="Search posts" />
        {rows.map(id => <button type="button" key={id} data-wbrow={id} onClick={() => { (window as unknown as { opened?: string }).opened = id }}>{id}</button>)}
      </div>
    </div>
  )
}

function register(ids: string[]) {
  for (const id of ids) registerRow({ id, kind: 'draft', label: `Post ${id}`, caps: ['approve', 'delete'] })
}

const press = (key: string, init: KeyboardEventInit = {}) => {
  act(() => { fireEvent.keyDown(window, { key, ...init }) })
  act(() => { vi.runOnlyPendingTimers() })
}

describe('today\'s command layer in D', () => {
  it('announces itself so old rows draw their selection marks', () => {
    renderInFrame(<DLayer />)
    expect(isLayerMounted()).toBe(true)
  })

  it('walks the old rows inside the page with j / k and selects with x', () => {
    renderInFrame(<>{page(['a', 'b', 'c'])}</>)
    register(['a', 'b', 'c'])
    expect(visibleRows().map(r => r.getAttribute('data-wbrow'))).toEqual(['a', 'b', 'c'])
    move(1); expect(getFocusId()).toBe('a')
    move(1); expect(getFocusId()).toBe('b')
    move(-1); expect(getFocusId()).toBe('a')
    toggleFocused(); expect(getSelected().map(r => r.id)).toEqual(['a'])
  })

  it('binds j / x / Enter / ? / Escape, and stands down when a page handled the key', () => {
    vi.useFakeTimers()
    renderInFrame(<><DLayer />{page(['a', 'b'])}</>)
    register(['a', 'b'])
    press('j'); expect(getFocusId()).toBe('a')
    press('x'); expect(getSelected().map(r => r.id)).toEqual(['a'])
    press('Enter'); expect((window as unknown as { opened?: string }).opened).toBe('a')
    press('Escape'); expect(getSelected()).toEqual([])
    // A page listener that handled j (DMs, Ops) prevents the default: the layer does nothing.
    const mine = (e: KeyboardEvent) => { if (e.key === 'j') e.preventDefault() }
    window.addEventListener('keydown', mine)
    press('j'); expect(getFocusId()).toBe('a')
    window.removeEventListener('keydown', mine)
    press('?'); expect(screen.getByText('Keyboard')).toBeTruthy()
  })

  it('never takes a key typed into a field', () => {
    vi.useFakeTimers()
    renderInFrame(<><DLayer />{page(['a'])}</>)
    register(['a'])
    const input = screen.getByLabelText('Search posts')
    input.focus()
    press('j')
    expect(getFocusId()).toBeNull()
  })

  it('lists today\'s Move / Select / Act rows over old rows, and a page\'s own command wins its id', () => {
    renderInFrame(<>{page(['a', 'b'])}</>)
    register(['a', 'b'])
    const run = vi.fn()
    const cmds = layerCommands({
      page: [{ id: 'select.all', title: 'Page select all', group: 'Select', key: null, hint: '', ready: true, run }],
      openSheet: () => {}, closeTop: () => {}, runBulk: () => {},
    })
    const ids = cmds.map(c => c.id)
    expect(ids).toContain('move.next')
    expect(ids).toContain('act.approve')
    expect(ids).toContain('open.a')
    expect(ids.filter(i => i === 'select.all')).toHaveLength(1)
    expect(cmds.find(c => c.id === 'select.all')?.title).toBe('Page select all')
    expect(ids.some(i => i.startsWith('go.'))).toBe(false)
  })

  it('keeps only the sheet row on a page with no old rows', () => {
    renderInFrame(<div className="d-body" />)
    const ids = layerCommands({ page: [], openSheet: () => {}, closeTop: () => {}, runBulk: () => {} }).map(c => c.id)
    expect(ids).toEqual(['move.sheet'])
  })
})
