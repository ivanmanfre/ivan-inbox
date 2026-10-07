// @vitest-environment jsdom
// S0 (SPEC-shell-spacing §2.1) and the Daily Brief sidebar contract (SPEC-foundation §2.5, §5.4).
import { cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

vi.mock('../counts/inbox', () => ({
  useDInbox: () => ({ refresh: () => {} }),
  useDInboxMaybe: () => null,
  DInboxProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../claude/Drawer', () => ({ default: () => <div className="dcl" data-claude-drawer><div className="dcl-head"><button data-verb="chats">c</button></div></div> }))

const { Desktop } = await import('../Shell')
const { renderInFrame } = await import('../test-utils')

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
    for (const place of ['home', 'dms', 'content', 'lanes', 'ops', 'sales', 'claude']) {
      expect(container.querySelector(`.d-nav a[href="#exp/d/${place}"]`), place).toBeTruthy()
    }
    expect(container.querySelector('[data-verb="workflows"]')).toBeTruthy()
  })
})
