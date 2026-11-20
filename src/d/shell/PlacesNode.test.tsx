// @vitest-environment jsdom
// daily-brief-trim Task 9.1: Brief's native sidebar follows the page's place list, read from a hidden node.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

vi.mock('../counts/inbox', () => ({
  useDInbox: () => ({ refresh: () => {} }),
  useDInboxMaybe: () => null,
  DInboxProvider: ({ children }: { children: ReactNode }) => children,
}))
// The Glance reads the network on a timer; it is not what these tests look at.
vi.mock('./Glance', () => ({ Glance: () => null }))

const { PlacesNode } = await import('./PlacesNode')
const { Side } = await import('./Side')
const { renderInFrame } = await import('../test-utils')

afterEach(() => { cleanup(); document.documentElement.classList.remove('brief-native') })

// bridge.js (apps/daily-brief) has a test that feeds placesOf this exact string: keep the two in step.
const WIRE = '[{"id":"home","label":"Home","group":"main"},{"id":"dms","label":"DMs","group":"main"},{"id":"content","label":"Content","group":"main"},{"id":"ops","label":"Ops","group":"main"},{"id":"sales","label":"Sales","group":"main"},{"id":"lanes","label":"Lanes","group":"main"},{"id":"intel","label":"Intel","group":"main"},{"id":"settings","label":"Settings","group":"low"}]'

describe('PlacesNode', () => {
  it('lists the seven main places and Settings in order, with labels, and no hidden place', () => {
    const { container } = render(<PlacesNode />)
    const node = container.querySelector('span[data-places]') as HTMLElement
    expect(node).toBeTruthy()
    expect(node.hidden).toBe(true)
    expect(node.textContent).toBe(WIRE)
    const list = JSON.parse(node.textContent!) as Array<{ id: string; label: string; group: string }>
    expect(list.map(p => p.id)).toEqual(['home', 'dms', 'content', 'ops', 'sales', 'lanes', 'intel', 'settings'])
    expect(list.map(p => p.id)).not.toContain('claude')
  })

  it('sits inside the side panel beside the glance line when the page runs in Brief', () => {
    document.documentElement.classList.add('brief-native')
    const { container } = renderInFrame(<Side />, { hash: '#exp/d/home' })
    expect(container.querySelector('aside.d-side span[data-places]')?.textContent).toBe(WIRE)
  })

  it('is not drawn in a plain browser', () => {
    const { container } = renderInFrame(<Side />, { hash: '#exp/d/home' })
    expect(container.querySelector('[data-places]')).toBeNull()
  })
})
