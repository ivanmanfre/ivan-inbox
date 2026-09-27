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
const calls = vi.hoisted(() => [] as string[])
vi.mock('../../lib/supabase', () => {
  const q = () => {
    const chain: Record<string, unknown> = {}
    for (const k of ['select', 'order', 'in', 'eq', 'not']) chain[k] = () => chain
    chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
    return chain
  }
  const from = (t: string) => { calls.push(t); const c = q() as Record<string, unknown>; const eq = c.eq as () => unknown; c.eq = (col: string, v: unknown) => { calls.push(`${t}.eq.${col}=${String(v)}`); return eq() }; return c }
  return { supabase: { from, auth } }
})
const mrr = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('../../lib/money', async orig => ({ ...(await orig()), fetchMrrRows: async () => mrr.rows, fetchCashConfig: async () => ({ cashOnHandUsd: null, cashAsOfDate: null, observedAt: null }) }))

vi.mock('../../wb/money', () => ({ MoneyView: () => <div data-testid="money-view">old money view</div> }))
import { renderInFrame } from '../test-utils'
import { parseDHash } from '../route'
import { pushBlocked } from './prefs'
import SettingsPage from './index'

const props = () => ({ layout: 'desktop' as const, route: parseDHash('#exp/d/settings'), navigate: vi.fn() })
beforeEach(() => { mrr.rows = []; push.state = 'off'; push.enable.mockClear(); push.disable.mockClear(); auth.signOut.mockClear() })
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

describe('Settings parity pass 2', () => {
  it('a stored Light theme from the old app shows Reset, which stores dark and flips the page back', async () => {
    localStorage.setItem('inbox-theme', 'light')
    renderInFrame(<SettingsPage {...props()} />)
    const k = await waitFor(() => document.querySelector('[data-verb="theme-reset"]') as HTMLButtonElement)
    fireEvent.click(k)
    expect(localStorage.getItem('inbox-theme')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    await waitFor(() => expect(document.querySelector('[data-verb="theme-reset"]')).toBeNull())
  })
  it('the device list reads only this app\'s push rows', async () => {
    renderInFrame(<SettingsPage {...props()} />)
    await waitFor(() => expect(calls).toContain('push_subscriptions.eq.device_label=ivan-inbox'))
  })
  it('sign-out names both ways back in', async () => {
    renderInFrame(<SettingsPage {...props()} />)
    fireEvent.click(document.querySelector('[data-verb="sign-out"]')!)
    await waitFor(() => expect(screen.getByText(/6-digit code or the email link/)).toBeTruthy())
  })
})

describe('Money inside D', () => {
  it('#exp/d/settings/money mounts today\'s Money view under one D title, with a way back', async () => {
    const nav = vi.fn()
    renderInFrame(<SettingsPage layout="desktop" route={parseDHash('#exp/d/settings/money')} navigate={nav} />)
    await waitFor(() => expect(screen.getByTestId('money-view')).toBeTruthy())
    expect(document.querySelector('.ds2-moneyview')).toBeTruthy()
  })
})

describe('Money plate in plain English (final gate 09-27)', () => {
  it('never prints memory_claim, a file path or MEMORY.md; keeps unverified and stale', async () => {
    const old = new Date(Date.now() - 25 * 86_400_000).toISOString()
    mrr.rows = [
      { id: 'a1', client_id: 'arch', kind: 'mrr', amount_usd: 3000, currency: 'USD', occurred_on: '2026-08-31', source_kind: 'memory_claim', source_ref: 'memory/arch-billing-date-moved-2026-08-31.md', observed_at: old, verified: false, note: null },
      { id: 'r1', client_id: 'risedtc', kind: 'mrr', amount_usd: null, currency: 'USD', occurred_on: '2026-08-30', source_kind: 'memory_claim', source_ref: 'memory/rise-first-closed-wons-2026-08-30.md', observed_at: old, verified: false, note: 'resolve live: no memory file states the amount; MEMORY.md core-refs says "MATTAN PAID 07-17 = 1st client $3k" (a mention, not a reading).' },
    ]
    renderInFrame(<SettingsPage {...props()} />)
    const plate = await waitFor(() => { const m = document.querySelector('.ds2-money'); expect(m).not.toBeNull(); return m! })
    const text = plate.textContent ?? ''
    expect(text).not.toMatch(/memory_claim|\.md|MEMORY|core-refs|_/)
    expect(text).toContain('$3,000')
    expect(text).toContain('unverified, waiting on a Stripe read · from a note, not a Stripe reading · observed 25 days ago · stale')
    expect(text).toContain('Not recorded in any table yet. Waiting on a Stripe read.')
  })
})
