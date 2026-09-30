// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Row } from './kit'

afterEach(cleanup)

describe('Row independent controls', () => {
  it('gives the title a native open button without nesting the checkbox or link inside it', () => {
    const open = vi.fn()
    const { container } = render(<Row title="Draft body" onClick={open}
      lead={<button role="checkbox" aria-checked="false">Select draft</button>}
      actions={<a href="#landing">Landing page</a>} />)
    const title = screen.getByRole('button', { name: 'Draft body' })
    expect(title.tagName).toBe('BUTTON')
    expect(container.querySelector('.a-row')?.getAttribute('role')).toBeNull()
    expect(title.contains(screen.getByRole('checkbox'))).toBe(false)
    expect(title.contains(screen.getByRole('link'))).toBe(false)
    fireEvent.click(title)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it.each(['Enter', ' '])('does not open from a child checkbox %s key', key => {
    const open = vi.fn()
    render(<Row title="Draft body" onClick={open}
      lead={<button role="checkbox" aria-checked="false">Select draft</button>} />)
    fireEvent.keyDown(screen.getByRole('checkbox'), { key })
    expect(open).not.toHaveBeenCalled()
  })

  it('opens from the row surface and keeps sibling actions independent', () => {
    const open = vi.fn()
    const action = vi.fn()
    const { container } = render(<Row title="Draft body" sub="Read this summary" onClick={open}
      actions={<button onClick={action}>Retry</button>} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(action).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.a-row-sub')!)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('keeps a row without an open action as readable content', () => {
    const { container } = render(<Row title="Recorded note" sub="Read only" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.textContent).toBe('Recorded noteRead only')
    expect(container.querySelector('.a-row')?.hasAttribute('data-interactive')).toBe(false)
  })
})
