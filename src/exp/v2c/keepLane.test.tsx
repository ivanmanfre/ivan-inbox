// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { KeepLane, LaneShownCtx, sameTree } from './KeepLane'

let renders = 0
function Probe({ n }: { n: number; on?: () => void }) {
  renders += 1
  return <p>value {n}</p>
}

describe('sameTree', () => {
  it('treats functions as equal and compares values and element types', () => {
    expect(sameTree(<Probe n={1} on={() => 1} />, <Probe n={1} on={() => 2} />)).toBe(true)
    expect(sameTree(<Probe n={1} />, <Probe n={2} />)).toBe(false)
    expect(sameTree(<><Probe n={1} />{false}</>, <><Probe n={1} />{false}</>)).toBe(true)
    expect(sameTree(<p key="a" />, <p key="b" />)).toBe(false)
    // Plain objects by identity: a new object is new content.
    expect(sameTree(<Probe n={1} {...{ o: {} }} />, <Probe n={1} {...{ o: {} }} />)).toBe(false)
  })
})

describe('KeepLane', () => {
  it('keeps a hidden lane mounted, inert and frozen, and re-renders it only on change', () => {
    renders = 0
    const view = (active: boolean, n: number) => (
      <KeepLane lane="dms" active={active}><Probe n={n} /></KeepLane>
    )
    const r = render(view(true, 1))
    expect(renders).toBe(1)
    r.rerender(view(true, 1))
    expect(renders).toBe(1) // same tree, same minute: no render
    r.rerender(view(false, 2))
    expect(renders).toBe(1) // hidden: frozen at the last render
    const host = r.container.querySelector('.wb-lane')!
    expect(host.hasAttribute('data-off')).toBe(true)
    expect(host.hasAttribute('inert')).toBe(true)
    expect(r.container.textContent).toBe('value 1')
    r.rerender(view(true, 2))
    expect(renders).toBe(2) // shown with new data: renders once
    expect(host.hasAttribute('data-off')).toBe(false)
    expect(r.container.textContent).toBe('value 2')
  })

  it('stays frozen under a cover and catches up when uncovered', () => {
    renders = 0
    const view = (shown: boolean, n: number) => (
      <LaneShownCtx.Provider value={shown}>
        <KeepLane lane="today" active><Probe n={n} /></KeepLane>
      </LaneShownCtx.Provider>
    )
    const r = render(view(true, 1))
    r.rerender(view(false, 5))
    expect(r.container.textContent).toBe('value 1')
    r.rerender(view(true, 5))
    expect(r.container.textContent).toBe('value 5')
    expect(renders).toBe(2)
  })
})
