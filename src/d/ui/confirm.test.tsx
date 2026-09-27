// @vitest-environment jsdom
// The D confirm's danger rule: a danger confirm is red, the Cancel key has the focus, and Enter
// never confirms it. A plain confirm keeps today's behaviour (the confirm key is focused).
import { act, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderInFrame } from '../test-utils'
import { useDConfirm, type ConfirmOpts } from './confirm'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

let ask: ((o: ConfirmOpts) => Promise<boolean>) | null = null
function Grab() { ask = useDConfirm(); return null }

async function open(o: Partial<ConfirmOpts>) {
  renderInFrame(<Grab />)
  let result: boolean | 'pending' = 'pending'
  await act(async () => { void ask!({ title: 'Delete from the seat on LinkedIn?', confirmText: 'Delete from seat', verb: 'confirm-delete', ...o }).then(r => { result = r }) })
  return { get: () => result }
}
const enter = () => {
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  act(() => { window.dispatchEvent(ev) })
  return ev
}

describe('useDConfirm danger rule', () => {
  it('danger: red key, Cancel focused, Enter cancels (never confirms)', async () => {
    const r = await open({ danger: true })
    const ok = document.querySelector('[data-verb="confirm-delete"]')!
    expect(ok.className).toContain('d-key-d')
    expect(ok.className).not.toContain('d-key-p')
    expect(document.querySelector('.d-confirm')!.className).toContain('d-confirm-danger')
    expect(document.activeElement).toBe(document.querySelector('[data-verb="cancel"]'))
    const ev = enter()
    expect(ev.defaultPrevented).toBe(true)
    await act(async () => {})
    expect(r.get()).toBe(false)
    expect(document.querySelector('.d-confirm')).toBeNull()
  })

  it('danger: Enter with the red key focused is swallowed, the box stays open', async () => {
    const r = await open({ danger: true })
    const ok = document.querySelector<HTMLButtonElement>('[data-verb="confirm-delete"]')!
    ok.focus()
    const ev = enter()
    expect(ev.defaultPrevented).toBe(true)
    await act(async () => {})
    expect(r.get()).toBe('pending')
    expect(document.querySelector('.d-confirm')).not.toBeNull()
    // Only a real press on the red key confirms.
    fireEvent.click(ok)
    await act(async () => {})
    expect(r.get()).toBe(true)
  })

  it('plain confirm: the confirm key is focused and Enter is not swallowed', async () => {
    const r = await open({ title: 'Send to Ana?', confirmText: 'Approve & send', verb: 'confirm-send' })
    const ok = document.querySelector('[data-verb="confirm-send"]')!
    expect(ok.className).toContain('d-key-p')
    expect(document.activeElement).toBe(ok)
    const ev = enter()
    expect(ev.defaultPrevented).toBe(false)
    expect(r.get()).toBe('pending')
  })

  it('Escape cancels either kind', async () => {
    const r = await open({ danger: true })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await act(async () => {})
    expect(r.get()).toBe(false)
  })
})
