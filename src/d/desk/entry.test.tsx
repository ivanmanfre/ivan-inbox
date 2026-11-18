// @vitest-environment jsdom
// The desk's entry points: the Desk key on the Content tab row (only with desk_enabled),
// the `content/desk` address, and the Claude place's nav slot (only with nav_visible).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'

let flagGate: Promise<void> | null = null
let flags: Record<string, boolean> = { desk_enabled: true, nav_visible: false }
vi.mock('../../lib/supabase', async orig => {
  const real = await orig<typeof import('../../lib/supabase')>()
  return {
    ...real,
    supabase: new Proxy(real.supabase, {
      get(t, k) {
        if (k === 'from') return (table: string) => (table === 'desk_config'
          ? { select: async () => { await flagGate; return { data: Object.entries(flags).map(([key, value]) => ({ key, value })), error: null } } }
          : t.from(table))
        return Reflect.get(t, k)
      },
    }),
  }
})

const { SubNav, subOf, contentRedirect } = await import('../content/SubNav')
const { renderInFrame } = await import('../test-utils')
const { claudeNav, saveDeskFlags, FLAGS_OFF, resetDeskFlagStore } = await import('./navFlag')
const { resetDeskFlagReads } = await import('./flags')
const { PLACES } = await import('../places')

afterEach(() => { cleanup(); localStorage.clear(); resetDeskFlagStore(); resetDeskFlagReads() })

describe('desk entry points', () => {
  it('the Content tab row carries a Desk key when desk_enabled is on', async () => {
    flags = { desk_enabled: true, nav_visible: false }
    renderInFrame(<SubNav on="plan" v2 />, { layout: 'phone', hash: '#exp/d/content/plan' })
    const key = await screen.findByText('Desk')
    expect(key.getAttribute('href')).toBe('#exp/d/content/desk')
  })
  it('no Desk key while the flag is off', async () => {
    flags = { desk_enabled: false, nav_visible: false }
    renderInFrame(<SubNav on="plan" v2 />, { layout: 'phone', hash: '#exp/d/content/plan' })
    await waitFor(() => expect(localStorage.getItem('desk-flags-v1')).toContain('"desk_enabled":false'))
    expect(screen.queryByText('Desk')).toBeNull()
  })
  it('content/desk is its own address', () => {
    expect(subOf('desk')).toBe('desk')
    expect(contentRedirect('desk', new URLSearchParams())).toBeNull()
  })
  it('the Claude place returns to the main nav only once nav_visible was read true', () => {
    expect(claudeNav()).toBe('hidden')
    saveDeskFlags({ ...FLAGS_OFF, desk_enabled: true, nav_visible: true })
    expect(claudeNav()).toBe('main')
  })
  it('the nav slot follows a later read in the same session (never captured at load)', () => {
    saveDeskFlags({ ...FLAGS_OFF, desk_enabled: true, nav_visible: true })
    expect(PLACES.claude.nav).toBe('main')
    saveDeskFlags({ ...FLAGS_OFF, desk_enabled: true, nav_visible: false })
    expect(PLACES.claude.nav).toBe('hidden')
  })
})

vi.mock('./Desk', () => ({ Desk: () => <div data-desk-bypass>Desk opened</div> }))
const { default: DeskPage } = await import('./index')
const { Side } = await import('../shell/Side')

it('does not mount a disabled Desk while its authenticated flag read is pending', async () => {
  const initial = { ...FLAGS_OFF, desk_enabled: true, nav_visible: true }
  localStorage.setItem('desk-flags-v1', JSON.stringify(initial))
  flags = { desk_enabled: false, nav_visible: false }
  let release!: () => void
  flagGate = new Promise(r => { release = r })
  renderInFrame(<DeskPage layout="desktop" />)
  const beforeRead = !!screen.queryByText('Desk opened')
  await act(async () => { release() })
  flagGate = null
  expect(screen.getByText('The Content Desk is off.')).toBeTruthy()
  expect(beforeRead).toBe(false)
})

it('removes the Claude nav link when the flag store sends a disable without navigation', async () => {
  saveDeskFlags({ ...FLAGS_OFF, desk_enabled: true, nav_visible: true })
  const { container } = renderInFrame(<Side />, { hash: '#exp/d/home' })
  await waitFor(() => expect(container.querySelector('a[href="#exp/d/claude"]')).toBeTruthy())
  await act(async () => {})
  act(() => { saveDeskFlags(FLAGS_OFF) })
  expect(PLACES.claude.nav).toBe('hidden')
  expect(container.querySelector('a[href="#exp/d/claude"]')).toBeNull()
})
