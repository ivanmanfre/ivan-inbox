// @vitest-environment jsdom
// Invented fixtures only: no real names, ids or message text.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { webcrypto } from 'node:crypto'

const rpc = vi.hoisted(() => ({ calls: [] as { fn: string; args: unknown }[], answers: {} as Record<string, unknown> }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: async (fn: string, args?: unknown) => {
  rpc.calls.push({ fn, args })
  const a = rpc.answers[fn]
  if (a instanceof Error) return { data: null, error: a }
  return { data: typeof a === 'function' ? (a as (x: unknown) => unknown)(args) : a ?? null, error: null }
} } }))

import { WarmDm4Review, WarmDm4Sheet } from './WarmDm4Review'
import type { WarmDm4Item } from '../../lib/warmDm4Review'

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
if (!URL.createObjectURL) Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} })

const pngBytes = (n: number, fill = 7) => { const b = new Uint8Array(new ArrayBuffer(n)); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); b.fill(fill, 8); return b }
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const hex = async (b: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), x => x.toString(16).padStart(2, '0')).join('')
const folds = { isOpen: () => true, toggle: () => {} }

async function item(over: Partial<WarmDm4Item> = {}, bytes = pngBytes(3000)): Promise<WarmDm4Item> {
  return {
    id: '00000000-0000-4000-8000-0000000000a1', step: 4, state: 'held', reason: 'waiting_for_ivan', variant: 'image',
    bubbles: ["Hey Alex 🙂 mocked up what Example Co's next month on LinkedIn could look like", '[scan trailer image]', 'want to see the whole thing?'],
    preview_sha256: 'f'.repeat(64), image_sha256: await hex(bytes), image_bytes: bytes.length, name: 'Alex Example', headline: 'Founder at Example Co',
    company: 'Example Co', linkedin_url: null, campaign: 'Warm test', claimed_at: '2026-11-20T15:00:00Z', send_after: '2026-11-21T12:00:00Z',
    receipts: 0, attempts: 0, ...over,
  }
}

beforeEach(() => { cleanup(); rpc.calls = []; rpc.answers = {} })

describe('Warm DM4 review', () => {
  it('shows nothing when no DM4 is held', async () => {
    rpc.answers.ivan_warm_review_queue = []
    const { container } = render(<WarmDm4Review folds={folds} />)
    await waitFor(() => expect(rpc.calls.length).toBe(1))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the bubbles in send order with the verified image between them, and approves that exact pairing', async () => {
    const bytes = pngBytes(3000)
    const it0 = await item({}, bytes)
    rpc.answers.ivan_warm_review_image = { sha256: it0.image_sha256, bytes: bytes.length, png_base64: b64(bytes) }
    const done = vi.fn()
    render(<WarmDm4Sheet item={it0} onClose={() => {}} onDone={done} />)
    const list = screen.getByRole('list', { name: 'Messages in send order' })
    expect(list.querySelectorAll('li')[0]).toHaveTextContent('mocked up what Example Co')
    const img = await screen.findByRole('img', { name: 'Campaign preview image that will be sent' })
    expect(screen.getByRole('button', { name: /Approve this DM4/ })).toBeDisabled()
    fireEvent.load(img)
    expect(list.querySelectorAll('li')[1].getAttribute('data-bubble')).toBe('image')
    expect(list.querySelectorAll('li')[2]).toHaveTextContent('want to see the whole thing?')
    fireEvent.click(screen.getByRole('button', { name: /Approve this DM4/ }))
    await waitFor(() => expect(done).toHaveBeenCalled())
    const call = rpc.calls.find(c => c.fn === 'ivan_warm_review_approve')
    expect(call?.args).toEqual({ p_rung_id: it0.id, p_preview_sha256: it0.preview_sha256, p_image_sha256: await hex(bytes) })
  })

  it('never offers Approve when the image bytes differ from the held digest', async () => {
    const it0 = await item({}, pngBytes(3000))
    const other = pngBytes(3000, 9)
    rpc.answers.ivan_warm_review_image = { sha256: it0.image_sha256, bytes: other.length, png_base64: b64(other) }
    render(<WarmDm4Sheet item={it0} onClose={() => {}} onDone={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match the draft')
    expect(screen.getByRole('button', { name: /Approve this DM4/ })).toBeDisabled()
    expect(rpc.calls.some(c => c.fn === 'ivan_warm_review_approve')).toBe(false)
  })

  it('a draft that changed after it was opened is refused by the database and the error is shown', async () => {
    const it0 = await item({ variant: 'text', bubbles: ['Hey Alex 🙂 want me to mock up what your next month on LinkedIn could look like?'], image_sha256: null, image_bytes: null })
    rpc.answers.ivan_warm_review_approve = new Error('The draft changed after you opened it. Refresh and look again.')
    render(<WarmDm4Sheet item={it0} onClose={() => {}} onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Approve this DM4/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed after you opened it')
  })

  it('discard sends the fingerprint it was shown', async () => {
    const it0 = await item({ variant: 'text', bubbles: ['Hey Alex 🙂 want me to mock up what your next month on LinkedIn could look like?'], image_sha256: null, image_bytes: null })
    const done = vi.fn()
    render(<WarmDm4Sheet item={it0} onClose={() => {}} onDone={done} />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(rpc.calls.find(c => c.fn === 'ivan_warm_review_discard')?.args).toEqual({ p_rung_id: it0.id, p_preview_sha256: it0.preview_sha256 })
  })

  it('lists a delivery that needs a look without any send key', async () => {
    rpc.answers.ivan_warm_review_queue = [await item({ state: 'uncertain', reason: 'provider_outcome_uncertain_bubble_2', receipts: 1, attempts: 2 })]
    render(<WarmDm4Review folds={folds} />)
    expect(await screen.findByText(/1 of 3 bubbles confirmed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
  })

  it('uses only its own approval call: never a write to outreach_messages', async () => {
    const it0 = await item({ variant: 'text', bubbles: ['Hey Alex 🙂 want me to mock up what your next month on LinkedIn could look like?'], image_sha256: null, image_bytes: null })
    render(<WarmDm4Sheet item={it0} onClose={() => {}} onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Approve this DM4/ }))
    await waitFor(() => expect(rpc.calls.length).toBeGreaterThan(0))
    expect(rpc.calls.map(c => c.fn)).toEqual(['ivan_warm_review_approve'])
  })

  it('an image that fails to display can never be approved', async () => {
    const bytes = pngBytes(3000)
    const it0 = await item({}, bytes)
    rpc.answers.ivan_warm_review_image = { sha256: it0.image_sha256, bytes: bytes.length, png_base64: b64(bytes) }
    render(<WarmDm4Sheet item={it0} onClose={() => {}} onDone={() => {}} />)
    fireEvent.error(await screen.findByRole('img', { name: 'Campaign preview image that will be sent' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be displayed')
    fireEvent.click(screen.getByRole('button', { name: /Approve this DM4/ }))
    expect(rpc.calls.some(c => c.fn === 'ivan_warm_review_approve')).toBe(false)
  })
})
