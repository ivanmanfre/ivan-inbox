// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

const push = vi.hoisted(() => ({ state: 'off' as string, enable: vi.fn(async () => true), disable: vi.fn(async () => true) }))
vi.mock('../../lib/push', () => ({
  getPushState: vi.fn(async () => push.state),
  enablePush: push.enable,
  disablePush: push.disable,
}))
const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })) }))
vi.mock('../../lib/supabase', () => {
  const q = () => {
    const chain: Record<string, unknown> = {}
    for (const k of ['select', 'order', 'in', 'eq', 'not']) chain[k] = () => chain
    chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
    return chain
  }
  return { supabase: { from: q, auth } }
})
vi.mock('../../lib/money', async orig => ({ ...(await orig()), fetchMrrRows: async () => [], fetchCashConfig: async () => ({ cashOnHandUsd: null, cashAsOfDate: null, observedAt: null }) }))

import { renderInFrame } from '../test-utils'
import { parseDHash } from '../route'
import { pushBlocked } from './prefs'
import SettingsPage from './index'

const props = () => ({ layout: 'desktop' as const, route: parseDHash('#exp/d/settings'), navigate: vi.fn() })
beforeEach(() => { push.state = 'off'; push.enable.mockClear(); push.disable.mockClear(); auth.signOut.mockClear() })
afterEach(() => { cleanup(); localStorage.clear() })

describe('Settings keys', () => {
  it('Push On calls today\'s enablePush once, and the pressed key follows', async () => {
    renderInFrame(<SettingsPage {...props()} />)
    const on = await waitFor(() => { const k = document.querySelector('[data-verb="push-on"]') as HTMLButtonElement; expect(k.disabled).toBe(false); return k })
    fireEvent.click(on)
    await waitFor(() => expect(push.enable).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(document.querySelector('[data-verb="push-on"]')!.getAttribute('aria-pressed')).toBe('true'))
    expect(push.disable).not.toHaveBeenCalled()
  })

  it('Push Off calls disablePush when this device is on', async () => {
    push.state = 'on'
    renderInFrame(<SettingsPage {...props()} />)
    await waitFor(() => expect(document.querySelector('[data-verb="push-on"]')!.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(document.querySelector('[data-verb="push-off"]')!)
    await waitFor(() => expect(push.disable).toHaveBeenCalledTimes(1))
  })

  it('the /next/ preview never subscribes push: the keys are blocked with the reason', () => {
    expect(pushBlocked('off', true)).toMatch(/preview never turns push on or off/)
    expect(pushBlocked('off', false)).toBeNull()
    expect(pushBlocked('denied', false)).toMatch(/blocked for this site/)
  })

  it('sound and density write only their localStorage keys', async () => {
    renderInFrame(<SettingsPage {...props()} />)
    fireEvent.click(document.querySelector('[data-verb="sound-off"]')!)
    expect(localStorage.getItem('inbox-chime')).toBe('off')
    fireEvent.click(document.querySelector('[data-verb="density-compact"]')!)
    expect(localStorage.getItem('inbox-density')).toBe('compact')
    expect(document.documentElement.dataset.density).toBe('compact')
    fireEvent.click(document.querySelector('[data-verb="density-comfortable"]')!)
    expect(localStorage.getItem('inbox-density')).toBe('comfortable')
    expect(push.enable).not.toHaveBeenCalled()
  })

  it('Sign out asks first and signs out only on confirm', async () => {
    renderInFrame(<SettingsPage {...props()} />)
    fireEvent.click(document.querySelector('[data-verb="sign-out"]')!)
    fireEvent.click(await screen.findByText('Cancel').catch(() => document.querySelector('[data-verb="cancel"]') as HTMLElement))
    await new Promise(r => setTimeout(r, 0))
    expect(auth.signOut).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('[data-verb="sign-out"]')!)
    await waitFor(() => expect(document.querySelector('[data-verb="confirm"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-verb="confirm"]')!)
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1))
  })

  it('no lime on saved preferences: the selected key is pressed, never primary', () => {
    renderInFrame(<SettingsPage {...props()} />)
    expect(document.querySelectorAll('.ds2-pair .d-key-p')).toHaveLength(0)
  })
})
