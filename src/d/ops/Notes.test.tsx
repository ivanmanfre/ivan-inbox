// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { Notes } from './Notes'
import type { OpsNote } from '../../lib/opsNotes'

const server = new Map<string, OpsNote>()
const saves: Array<[string, string]> = []
const deletes: string[] = []
vi.mock('../../lib/opsNotes', async orig => ({
  ...await orig<typeof import('../../lib/opsNotes')>(),
  fetchOpsNotes: vi.fn(async () => [...server.values()]),
  saveOpsNote: vi.fn(async (id: string, body: string) => {
    saves.push([id, body])
    const now = new Date().toISOString()
    const row = { id, body, created_at: server.get(id)?.created_at ?? now, updated_at: now }
    server.set(id, row)
    return row
  }),
  deleteOpsNote: vi.fn(async (id: string) => { deletes.push(id); server.delete(id) }),
}))

const old: OpsNote = { id: 'n1', body: 'Call Mattan\nabout the Monday lane', created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' }
const editor = () => document.querySelector<HTMLTextAreaElement>('.op-ne textarea')

beforeEach(() => {
  server.clear(); saves.length = 0; deletes.length = 0; localStorage.clear()
  server.set(old.id, old)
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => 'new-1' })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Ops notes', () => {
  it('lists saved notes by their first line', async () => {
    renderInFrame(<Notes />)
    await screen.findByText('Call Mattan')
    expect(screen.getByText('about the Monday lane')).toBeTruthy()
    expect(document.querySelector('.op-notes .op-sec b')?.textContent).toBe('1')
  })

  it('New note opens a focused editor and saves itself after a pause', async () => {
    renderInFrame(<Notes />)
    await screen.findByText('Call Mattan')
    fireEvent.click(screen.getByText('New note'))
    const ta = editor()!
    expect(document.activeElement).toBe(ta)
    fireEvent.change(ta, { target: { value: 'Buy flowers' } })
    await waitFor(() => expect(saves).toEqual([['new-1', 'Buy flowers']]), { timeout: 2000 })
    await screen.findByText('Saved')
    fireEvent.click(screen.getByText('Done'))
    expect(editor()).toBeNull()
    expect(screen.getByText('Buy flowers')).toBeTruthy()
    expect(document.querySelector('.op-notes .op-sec b')?.textContent).toBe('2')
  })

  it('a note closed empty goes away without a write', async () => {
    renderInFrame(<Notes />)
    await screen.findByText('Call Mattan')
    fireEvent.click(screen.getByText('New note'))
    fireEvent.keyDown(editor()!, { key: 'Escape' })
    expect(screen.queryByText('Empty note')).toBeNull()
    await act(async () => { await new Promise(r => setTimeout(r, 700)) })
    expect(saves).toEqual([]); expect(deletes).toEqual([])
  })

  it('Done saves at once, without waiting for the pause', async () => {
    renderInFrame(<Notes />)
    fireEvent.click(await screen.findByText('Call Mattan'))
    fireEvent.change(editor()!, { target: { value: 'Call Mattan today' } })
    fireEvent.click(screen.getByText('Done'))
    await waitFor(() => expect(saves).toEqual([['n1', 'Call Mattan today']]))
  })

  it('delete is one tap, and Undo brings the note back', async () => {
    renderInFrame(<Notes />)
    fireEvent.click(await screen.findByText('Call Mattan'))
    fireEvent.click(screen.getByText('delete'))
    expect(document.querySelector('.op-notes')?.textContent).not.toContain('Call Mattan')
    await waitFor(() => expect(deletes).toEqual(['n1']))
    expect(screen.getByText('Note deleted.')).toBeTruthy()
    fireEvent.click(screen.getByText('Undo'))
    await waitFor(() => expect(document.querySelector('.op-notes')?.textContent).toContain('Call Mattan'))
    await waitFor(() => expect(saves).toEqual([['n1', 'Call Mattan\nabout the Monday lane']]))
  })

  it('a failed save says so and Retry tries again', async () => {
    const lib = await import('../../lib/opsNotes')
    vi.mocked(lib.saveOpsNote).mockRejectedValueOnce(new Error('offline'))
    renderInFrame(<Notes />)
    fireEvent.click(await screen.findByText('Call Mattan'))
    fireEvent.change(editor()!, { target: { value: 'x' } })
    await screen.findByText(/Not saved/, {}, { timeout: 2000 })
    fireEvent.click(screen.getByText('Retry'))
    await screen.findByText('Saved')
    expect(server.get('n1')?.body).toBe('x')
  })
})
