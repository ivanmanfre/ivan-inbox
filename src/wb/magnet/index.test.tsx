// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceDetail } from '../../lib/styles'
import { ConfirmProvider } from '../chrome/ConfirmSheet'
import { MagnetWindow, type MagnetQueueItem } from './index'

const io = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), note: vi.fn() }))
vi.mock('../../lib/styles', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/styles')>(), fetchResourceDetail: io.read,
}))
vi.mock('../../lib/studioActions', () => ({
  saveLmField: io.save, appendAgentNote: io.note, regenLmContent: vi.fn(), regenLmCover: vi.fn(),
}))

const detail = (id: string): ResourceDetail => ({
  id, topic: `Magnet ${id}`, format: 'guide', status: 'review', updated_at: '2026-09-30T12:00:00Z',
  resource_url: null, landing_url: null, cover_url: null, landing_slug: null,
  description: null, post_body: 'Original promo', email_copy: 'Original email', resource_html: null,
  gate_keyword: null, slug: null, vertical_slug: null, og_url: null, video_url: null,
  source: null, source_ref: null, campaign_id: null, workflow_file_id: null, created_at: null,
  landing_copy: null, notes: null, spec: null, covers: null, qa: null, agent_log: null, topic_strength: null,
})
const queue: MagnetQueueItem[] = ['first', 'second'].map(id => ({
  id, title: `Magnet ${id}`, type: 'guide', updated_at: '2026-09-30T12:00:00Z', status: 'review',
}))

function Harness({ mobile = false }: { mobile?: boolean }) {
  const [id, setId] = useState<string | null>('first')
  return <ConfirmProvider>{id
    ? <MagnetWindow id={id} lane="ivan" queue={queue} onPick={setId} onClose={() => setId(null)} mobile={mobile} />
    : <div>Window closed</div>}</ConfirmProvider>
}
async function open(mobile = false) {
  render(<Harness mobile={mobile} />)
  await screen.findByText('Original promo')
}
function editPromo() {
  fireEvent.click(screen.getByText('Original promo'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Post body' }), { target: { value: 'Unsaved promo' } })
}
const ask = () => screen.findByRole('dialog', { name: 'Discard unsaved edits?' })

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '#content-magnets')
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  io.read.mockReset().mockImplementation(async (id: string) => detail(id))
  io.save.mockReset().mockResolvedValue(undefined)
  io.note.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Magnet editor navigation', () => {
  it('keeps changed promo copy when a dirty Close is cancelled and closes only after discard', async () => {
    await open(); editPromo()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    const dialog = await ask()
    expect(screen.queryByText('Window closed')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Post body' }) as HTMLTextAreaElement).value).toBe('Unsaved promo'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(within(await ask()).getByRole('button', { name: 'Discard edits' }))
    await screen.findByText('Window closed')
    expect(io.save).not.toHaveBeenCalled()
  })

  it.each(['Back', 'backdrop'])('guards dirty %s navigation', async control => {
    await open(control === 'Back'); editPromo()
    if (control === 'Back') fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    else fireEvent.click(document.querySelector('.a-tk-scrim')!)
    const dialog = await ask()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect((screen.getByRole('textbox', { name: 'Post body' }) as HTMLTextAreaElement).value).toBe('Unsaved promo')
  })

  it.each(['Next', 'j', 'rail'])('guards dirty queue navigation from %s', async control => {
    await open(); editPromo()
    screen.getByRole('button', { name: 'Close' }).focus()
    if (control === 'Next') fireEvent.click(screen.getByRole('button', { name: /Next$/ }))
    else if (control === 'rail') fireEvent.click(screen.getByText('Magnet second'))
    else fireEvent.keyDown(window, { key: 'j' })
    const dialog = await ask()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('heading', { name: 'Magnet first' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Post body' }) as HTMLTextAreaElement).value).toBe('Unsaved promo')
  })

  it('does not prompt for unchanged edit mode', async () => {
    await open()
    fireEvent.click(screen.getByText('Original promo'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await screen.findByText('Window closed')
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved edits?' })).toBeNull()
  })

  it('switches after discard and leaves the next unedited item without another prompt', async () => {
    await open(); editPromo()
    fireEvent.click(screen.getByRole('button', { name: /Next$/ }))
    fireEvent.click(within(await ask()).getByRole('button', { name: 'Discard edits' }))
    await screen.findByRole('heading', { name: 'Magnet second' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await screen.findByText('Window closed')
  })

  it('retains dirty copy after a failed save', async () => {
    io.save.mockRejectedValueOnce(new Error('Save unavailable'))
    await open(); editPromo()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Save unavailable')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(within(await ask()).getByRole('button', { name: 'Keep editing' }))
    expect((screen.getByRole('textbox', { name: 'Post body' }) as HTMLTextAreaElement).value).toBe('Unsaved promo')
  })

  it('guards new edits after discarding to another queue item', async () => {
    await open(); editPromo()
    fireEvent.click(screen.getByRole('button', { name: /Next$/ }))
    fireEvent.click(within(await ask()).getByRole('button', { name: 'Discard edits' }))
    await screen.findByRole('heading', { name: 'Magnet second' })
    editPromo()
    await act(async () => { location.hash = '#other-content' })
    await waitFor(() => expect(location.hash).toBe('#content-magnets'))
    fireEvent.click(within(await ask()).getByRole('button', { name: 'Keep editing' }))
    expect((screen.getByRole('textbox', { name: 'Post body' }) as HTMLTextAreaElement).value).toBe('Unsaved promo')
  })

  it('blocks Close and queue navigation while an edited field is saving', async () => {
    let finish!: () => void
    io.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    await open(); editPromo()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: /Next$/ }))
    await act(async () => {})
    expect(screen.queryByText('Window closed')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Magnet first' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved edits?' })).toBeNull()
    await act(async () => { finish() })
  })

  it('protects email and unsent notes, including edits in a collapsed fold', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Email copy' }), { target: { value: 'Unsaved email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    fireEvent.click(screen.getByRole('button', { name: /Generation register/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a note to the generation register' }), { target: { value: 'Unsent note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(within(await ask()).getByRole('button', { name: 'Keep editing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect((screen.getByRole('textbox', { name: 'Email copy' }) as HTMLTextAreaElement).value).toBe('Unsaved email')
    expect((screen.getByRole('textbox', { name: 'Add a note to the generation register' }) as HTMLTextAreaElement).value).toBe('Unsent note')
  })

  it('keeps the editor mounted when dirty hash navigation is cancelled', async () => {
    await open(); editPromo()
    await act(async () => { location.hash = '#other-content' })
    fireEvent.click(within(await ask()).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(location.hash).toBe('#content-magnets'))
    expect((screen.getByRole('textbox', { name: 'Post body' }) as HTMLTextAreaElement).value).toBe('Unsaved promo')
  })

  it('offers a retry that recovers a failed detail read', async () => {
    io.read.mockRejectedValueOnce(new Error('Temporary read failure'))
    render(<Harness />)
    await screen.findByText('Temporary read failure')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Original promo')
    expect(screen.queryByText('Temporary read failure')).toBeNull()
  })

  it('preserves another dirty field when the detail refresh after a save fails', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Email copy' }), { target: { value: 'Unsaved email' } })
    editPromo()
    io.read.mockRejectedValueOnce(new Error('Refresh unavailable'))
    fireEvent.click(within(document.querySelector('.li-card') as HTMLElement).getByRole('button', { name: 'Save' }))
    await screen.findByText('Refresh unavailable')
    expect((screen.getByRole('textbox', { name: 'Email copy' }) as HTMLTextAreaElement).value).toBe('Unsaved email')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText('Refresh unavailable')).toBeNull())
    expect((screen.getByRole('textbox', { name: 'Email copy' }) as HTMLTextAreaElement).value).toBe('Unsaved email')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await ask()).toBeTruthy()
  })
})
