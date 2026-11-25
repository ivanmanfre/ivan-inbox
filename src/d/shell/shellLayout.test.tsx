// @vitest-environment jsdom
// S0 (SPEC-shell-spacing §2.1) and the Daily Brief sidebar contract (SPEC-foundation §2.5, §5.4).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
const { ClaudeValueProvider } = await import('../claude/ClaudeProvider')
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
    for (const place of ['home', 'dms', 'content', 'lanes', 'ops', 'sales', 'intel', 'claude']) {
      expect(container.querySelector(`.d-nav a[href="#exp/d/${place}"]`), place).toBeTruthy()
    }
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
    <FrameCtx.Provider value={{ ...f, claudeOpen, setClaudeOpen, claudeShown: claudeOpen, toggleClaude: () => setClaudeOpen(o => !o) }}>
      <Desktop setTitleSlot={() => {}} setToolsSlot={() => {}} sideMin={min} setSideMin={() => {}} />
    </FrameCtx.Provider>
  )
}

describe('daily-brief-trim Task 10.1: Content sub-pages are listed once', () => {
  it('on Content the side panel keeps the place link and draws no sub-page links', () => {
    const { container } = renderInFrame(<Desktop setTitleSlot={() => {}} setToolsSlot={() => {}} sideMin={false} setSideMin={() => {}} />, { layout: 'desktop', hash: '#exp/d/content/calendar' })
    expect(container.querySelector('.d-side .d-nav a[href="#exp/d/content/calendar"]')).toBeNull()
    expect(container.querySelector('.d-side .d-navsub')).toBeNull()
    const link = container.querySelector('.d-side .d-nav a[href="#exp/d/content"]')
    expect(link).toBeTruthy()
    expect(link!.classList.contains('d-on')).toBe(true)
    expect(link!.getAttribute('aria-current')).toBe('page')
  })
})

describe('daily-brief-trim Task 10.1: the alert popup leaves the thread header alone', () => {
  const css = readFileSync(join(__dirname, 'ForegroundAlerts.css'), 'utf8')
  const rule = css.split('\n').find(l => l.startsWith('.d-foreground{'))!
  it('sits at the bottom right, past the Claude drawer, not at the top', () => {
    expect(rule).not.toMatch(/top:74px/)
    expect(rule).toMatch(/bottom:calc\(16px \+ var\(--toast-clear,0px\)\)/)
    expect(rule).toMatch(/right:calc\(16px \+ var\(--drawer-col,0px\)\)/)
  })
  it('the phone rule is unchanged', () => {
    expect(css).toContain('.d-phone .d-foreground,.wb-foreground-phone .d-foreground{top:auto;right:10px;left:10px;bottom:calc(var(--dock-h,56px) + 40px + env(safe-area-inset-bottom));width:auto}')
  })
})

describe('daily-brief-trim Task 6.2: Claude and Intel leave the nav, stay reachable', () => {
  it('the side panel lists seven places and settings', () => {
    expect(PLACE_ORDER).toEqual(['home', 'dms', 'content', 'ops', 'sales', 'lanes', 'intel', 'claude', 'settings'])
    expect(PLACE_ORDER.filter(id => PLACES[id].nav !== 'hidden')).toEqual(['home', 'dms', 'content', 'ops', 'sales', 'lanes', 'intel', 'claude', 'settings'])
    const { container } = renderDesktop(false)
    expect(sideIds(container)).toEqual(['home', 'dms', 'content', 'ops', 'sales', 'lanes', 'intel', 'claude', 'settings'])
  })
  it('the phone panel lists the same seven places and settings', () => {
    renderInFrame(<PhonePanel onClose={() => {}} />, { layout: 'phone', hash: '#exp/d/home' })
    const ids = [...document.querySelectorAll<HTMLAnchorElement>('.d-pn .d-nav a')].map(a => a.getAttribute('href')!.replace('#exp/d/', ''))
    expect(ids).toEqual(['home', 'dms', 'content', 'ops', 'sales', 'lanes', 'intel', 'claude', 'settings'])
  })
  it('a hidden place still routes', () => {
    expect(parseDHash('#exp/d/claude?thread=t1').place).toBe('claude')
    expect(PLACES.claude.nav).toBe('main'); expect(PLACES.intel.nav).toBe('main')
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
  it('the hint is drawn while idle and left out while a working or new pill shows', () => {
    const chat = (o: object) => ({ chat: { busy: false, runningElsewhere: false, botUnread: false, ...o }, landed: null, clearLanded: () => {}, since: Date.now() }) as never
    const { container } = renderInFrame(<DesktopWithDrawerState />, { layout: 'desktop', hash: '#exp/d/home' })
    const key = () => screen.getByRole('button', { name: 'Claude' })
    expect(key().querySelector('.d-kh')?.textContent).toBe('⌘J')
    expect(key().hasAttribute('aria-describedby')).toBe(false)
    cleanup()
    for (const [state, word] of [[{ busy: true }, 'working'], [{ botUnread: true }, 'new']] as const) {
      renderInFrame(<ClaudeValueProvider value={chat(state)}><DesktopWithDrawerState /></ClaudeValueProvider>, { layout: 'desktop', hash: '#exp/d/home' })
      expect(key().querySelector('.d-kh'), word).toBeNull()
      expect(key().textContent).toContain(word)
      expect(key().getAttribute('aria-label')).toBe('Claude')
      expect(key().getAttribute('aria-keyshortcuts')).toBe('Meta+J')
      const pill = container.ownerDocument.getElementById(key().getAttribute('aria-describedby')!)
      expect(pill?.textContent).toBe(word)
      cleanup()
    }
  })
  it('the key is not pressed when no drawer is drawn, and a click uses the frame toggle', () => {
    const toggleClaude = vi.fn()
    renderInFrame(<Desktop setTitleSlot={() => {}} setToolsSlot={() => {}} sideMin={false} setSideMin={() => {}} drawer={false} />,
      { layout: 'desktop', hash: '#exp/d/claude', frame: { claudeOpen: true, claudeShown: false, toggleClaude } })
    const key = screen.getByRole('button', { name: 'Claude' })
    expect(key.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(key)
    expect(toggleClaude).toHaveBeenCalledTimes(1)
  })
})

describe('the one Claude toggle (Shell frame)', () => {
  it('on the Claude page the key and the keyboard shortcut focus the chat box; elsewhere they toggle the drawer', async () => {
    const { default: DShell } = await import('../Shell')
    const box = document.createElement('div'); box.className = 'dcl-ws'
    const area = document.createElement('textarea'); box.appendChild(area); document.body.appendChild(box)
    location.hash = '#exp/d/claude'
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
    const { container } = render(<DShell />)
    const key = await screen.findByRole('button', { name: 'Claude' })
    expect(document.activeElement).not.toBe(area)
    fireEvent.click(key)
    expect(document.activeElement).toBe(area)
    area.blur()
    fireEvent.keyDown(window, { key: 'j', metaKey: true })
    expect(document.activeElement).toBe(area)
    expect(container.querySelector('aside.d-claude')).toBeNull()
    box.remove(); vi.unstubAllGlobals(); location.hash = ''
  })
})
