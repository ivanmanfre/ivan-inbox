// @vitest-environment jsdom
// S0 (SPEC-shell-spacing §2.1) and the Daily Brief sidebar contract (SPEC-foundation §2.5, §5.4).
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'

vi.mock('../counts/inbox', () => ({
  useDInbox: () => ({ refresh: () => {} }),
  useDInboxMaybe: () => null,
  DInboxProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../claude/Drawer', () => ({ default: () => <div className="dcl" data-claude-drawer><div className="dcl-head"><button data-verb="chats">c</button></div></div> }))
// The phone drawer's Glance card reads the network on a timer; it is not what these tests look at.
vi.mock('./Glance', () => ({ Glance: () => null }))

const { Desktop } = await import('../Shell')
const { PhonePanel } = await import('./Phone')
const { renderInFrame } = await import('../test-utils')
const { FrameCtx, useFrame } = await import('./frame')
const { parseDHash } = await import('../route')
const { PLACES, PLACE_ORDER } = await import('../places')

afterEach(cleanup)

function renderDesktop(claudeOpen: boolean) {
  return renderInFrame(<Desktop setTitleSlot={() => {}} setToolsSlot={() => {}} sideMin={false} setSideMin={() => {}} />,
    { layout: 'desktop', hash: '#exp/d/home', frame: { claudeOpen } })
}

describe('S0: the Claude drawer is beside the main column', () => {
  it('aside.d-claude is a child of .d-app, not of .d-bodyrow; the band is inside .d-main', async () => {
    const { container } = renderDesktop(true)
    const app = container.querySelector('.d-app')!
    const aside = await waitFor(() => { const a = container.querySelector('aside.d-claude'); expect(a).toBeTruthy(); return a! })
    expect(aside.parentElement).toBe(app)
    expect(aside.closest('.d-bodyrow')).toBeNull()
    expect(aside.closest('.d-main')).toBeNull()
    expect(container.querySelector('.d-main > header.d-ans')).toBeTruthy()
    expect(container.querySelector('.d-bodyrow')!.classList.contains('d-with-claude')).toBe(false)
  })
  it('Brief 4 claude section: no drawer column on the Claude workspace, even while open', () => {
    const { container } = renderInFrame(<Desktop setTitleSlot={() => {}} setToolsSlot={() => {}} sideMin={false} setSideMin={() => {}} drawer={false} />,
      { layout: 'desktop', hash: '#exp/d/claude', frame: { claudeOpen: true } })
    expect(container.querySelector('aside.d-claude')).toBeNull()
  })
  it('no drawer when closed', () => {
    const { container } = renderDesktop(false)
    expect(container.querySelector('aside.d-claude')).toBeNull()
  })
})

describe('Brief sidebar contract: the selectors bridge.js scrapes stay rendered on desktop', () => {
  it('.d-side with nav links for every place, counts and the workflows key', () => {
    const { container } = renderDesktop(false)
    expect(container.querySelector('.d-app .d-side')).toBeTruthy()
    for (const place of ['home', 'dms', 'content', 'lanes', 'ops', 'sales']) {
      expect(container.querySelector(`.d-nav a[href="#exp/d/${place}"]`), place).toBeTruthy()
    }
    // Claude and Intel left the nav (daily-brief-trim Task 6.2): no link for the bridge to read.
    for (const place of ['claude', 'intel']) expect(container.querySelector(`.d-nav a[href="#exp/d/${place}"]`), place).toBeNull()
    // Hidden from view (Ivan 10-08) but still in the DOM for Brief's bridge.
    expect(container.querySelector('[data-verb="workflows"]')?.hasAttribute('hidden')).toBe(true)
  })
})

/** The side panel's place links, in drawn order, as place ids. */
function sideIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLAnchorElement>('.d-side .d-nav a')].map(a => a.getAttribute('href')!.replace('#exp/d/', ''))
}

/** Desktop inside a frame whose Claude drawer flag is real state, so a click can flip it. */
function DesktopWithDrawerState({ min = false }: { min?: boolean }) {
  const f = useFrame()
  const [claudeOpen, setClaudeOpen] = useState(false)
  return (
    <FrameCtx.Provider value={{ ...f, claudeOpen, setClaudeOpen }}>
      <Desktop setTitleSlot={() => {}} setToolsSlot={() => {}} sideMin={min} setSideMin={() => {}} />
    </FrameCtx.Provider>
  )
}

describe('daily-brief-trim Task 6.2: Claude and Intel leave the nav, stay reachable', () => {
  it('the side panel lists six places and settings', () => {
    expect(PLACE_ORDER).toEqual(['home', 'dms', 'content', 'ops', 'sales', 'lanes', 'intel', 'claude', 'settings'])
    expect(PLACE_ORDER.filter(id => PLACES[id].nav !== 'hidden')).toEqual(['home', 'dms', 'content', 'ops', 'sales', 'lanes', 'settings'])
    const { container } = renderDesktop(false)
    expect(sideIds(container)).toEqual(['home', 'dms', 'content', 'ops', 'sales', 'lanes', 'settings'])
  })
  it('the phone panel lists the same six places and settings', () => {
    renderInFrame(<PhonePanel onClose={() => {}} />, { layout: 'phone', hash: '#exp/d/home' })
    const ids = [...document.querySelectorAll<HTMLAnchorElement>('.d-pn .d-nav a')].map(a => a.getAttribute('href')!.replace('#exp/d/', ''))
    expect(ids).toEqual(['home', 'dms', 'content', 'ops', 'sales', 'lanes', 'settings'])
  })
  it('a hidden place still routes', () => {
    expect(parseDHash('#exp/d/claude?thread=t1').place).toBe('claude'); expect(parseDHash('#exp/d/intel').place).toBe('intel')
    expect(PLACES.claude.nav).toBe('hidden'); expect(PLACES.intel.nav).toBe('hidden')
  })
  it('the Claude key toggles the drawer', () => {
    const { container } = renderInFrame(<DesktopWithDrawerState />, { layout: 'desktop', hash: '#exp/d/home' })
    const key = screen.getByRole('button', { name: 'Claude' })
    expect(key.closest('.d-side')).toBeTruthy()
    expect(key.textContent).toContain('⌘J')
    expect(key.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('aside.d-claude')).toBeNull()
    fireEvent.click(key)
    expect(screen.getByRole('button', { name: 'Claude' }).getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('aside.d-claude')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    expect(screen.getByRole('button', { name: 'Claude' }).getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('aside.d-claude')).toBeNull()
  })
  it('the Claude key keeps its name and works in the collapsed panel', () => {
    const { container } = renderInFrame(<DesktopWithDrawerState min />, { layout: 'desktop', hash: '#exp/d/home' })
    expect(container.querySelector('.d-side-min')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    expect(container.querySelector('aside.d-claude')).toBeTruthy()
  })
})
