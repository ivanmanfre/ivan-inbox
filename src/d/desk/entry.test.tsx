// @vitest-environment jsdom
// The desk's entry points: the Desk key on the Content tab row (only with desk_enabled),
// the `content/desk` address, and the Claude place's nav slot (only with nav_visible).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'

let flags: Record<string, boolean> = { desk_enabled: true, nav_visible: false }
vi.mock('../../lib/supabase', async orig => {
  const real = await orig<typeof import('../../lib/supabase')>()
  return {
    ...real,
    supabase: new Proxy(real.supabase, {
      get(t, k) {
        if (k === 'from') return (table: string) => (table === 'desk_config'
          ? { select: () => Promise.resolve({ data: Object.entries(flags).map(([key, value]) => ({ key, value })), error: null }) }
          : t.from(table))
        return Reflect.get(t, k)
      },
    }),
  }
})

const { SubNav, subOf, contentRedirect } = await import('../content/SubNav')
const { renderInFrame } = await import('../test-utils')
const { claudeNav, saveDeskFlags, FLAGS_OFF } = await import('./navFlag')

afterEach(() => { cleanup(); localStorage.clear() })

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
})
