// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { Notes } from './Notes'
import type { OpsNote } from '../../lib/opsNotes'

const server = new Map<string, OpsNote>()
const saves: Array<[string, string]> = []
const deletes: string[] = []
let uid = 'u1'
let holdDelete: Promise<void> | null = null
vi.mock('../../lib/opsNotes', async orig => ({
  ...await orig<typeof import('../../lib/opsNotes')>(),
  watchOpsNotesSession: (cb: (s: { uid: string; token: string }) => void) => { setTimeout(() => cb({ uid, token: 't' }), 0); return () => {} },
  flushOpsNote: vi.fn(),
  fetchOpsNotes: vi.fn(async () => [...server.values()]),
  saveOpsNote: vi.fn(async (id: string, body: string) => {
    saves.push([id, body])
    const now = new Date().toISOString()
    const row = { id, body, created_at: server.get(id)?.created_at ?? now, updated_at: now }
    server.set(id, row)
    return row
  }),
  deleteOpsNote: vi.fn(async (id: string) => {
    if (holdDelete) await holdDelete
    deletes.push(id); server.delete(id)
  }),
}))

const old: OpsNote = { id: 'n1', body: 'Call Mattan\nabout the Monday lane', created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' }
const editor = () => document.querySelector<HTMLTextAreaElement>('.op-ne textarea')
const listText = () => document.querySelector('.op-notes')?.textContent ?? ''
const cache = (u: string, notes: OpsNote[], srv: [string, string][]) => localStorage.setItem(`ops-notes-v2:${u}`, JSON.stringify({ notes, server: srv }))

beforeEach(() => {
  server.clear(); saves.length = 0; deletes.length = 0; localStorage.clear(); uid = 'u1'; holdDelete = null
  server.set(old.id, old)
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => 'new-1' })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

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

  it('a new note closed empty goes away without a write', async () => {
    renderInFrame(<Notes />)
    await screen.findByText('Call Mattan')
    fireEvent.click(screen.getByText('New note'))
    fireEvent.keyDown(editor()!, { key: 'Escape' })
    expect(editor()).toBeNull()
    await act(async () => { await new Promise(r => setTimeout(r, 700)) })
    expect(saves).toEqual([]); expect(deletes).toEqual([])
  })

  it('Done and blur save at once, without waiting for the pause', async () => {
    renderInFrame(<Notes />)
    fireEvent.click(await screen.findByText('Call Mattan'))
    fireEvent.change(editor()!, { target: { value: 'Call Mattan today' } })
    fireEvent.blur(editor()!)
    await waitFor(() => expect(saves).toEqual([['n1', 'Call Mattan today']]))
    fireEvent.change(editor()!, { target: { value: 'Call Mattan tonight' } })
    fireEvent.click(screen.getByText('Done'))
    await waitFor(() => expect(saves.at(-1)).toEqual(['n1', 'Call Mattan tonight']))
  })

  it('delete is one tap, and Undo brings the note back', async () => {
    renderInFrame(<Notes />)
    fireEvent.click(await screen.findByText('Call Mattan'))
    fireEvent.click(screen.getByText('delete'))
    expect(listText()).not.toContain('Call Mattan')
    await waitFor(() => expect(deletes).toEqual(['n1']))
    expect(screen.getByText('Note deleted.')).toBeTruthy()
    fireEvent.click(screen.getByText('Undo'))
    await waitFor(() => expect(listText()).toContain('Call Mattan'))
    await waitFor(() => expect(saves).toEqual([['n1', 'Call Mattan\nabout the Monday lane']]))
  })

  it('Undo tapped while the delete is still in flight saves after it, so the note stays', async () => {
    let release!: () => void
    holdDelete = new Promise(r => { release = r })
    renderInFrame(<Notes />)
    fireEvent.click(await screen.findByText('Call Mattan'))
    fireEvent.click(screen.getByText('delete'))
    fireEvent.click(screen.getByText('Undo'))
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(saves).toEqual([])
    release()
    await waitFor(() => expect(saves).toEqual([['n1', 'Call Mattan\nabout the Monday lane']]))
    expect(deletes).toEqual(['n1'])
    expect(server.has('n1')).toBe(true)
  })

  it('emptying a saved note and closing it deletes it with Undo, never saving it empty', async () => {
    renderInFrame(<Notes />)
    fireEvent.click(await screen.findByText('Call Mattan'))
    fireEvent.change(editor()!, { target: { value: '' } })
    await act(async () => { await new Promise(r => setTimeout(r, 700)) })
    expect(saves).toEqual([])
    fireEvent.click(screen.getByText('Done'))
    await waitFor(() => expect(deletes).toEqual(['n1']))
    fireEvent.click(screen.getByText('Undo'))
    await waitFor(() => expect(server.get('n1')?.body).toBe('Call Mattan\nabout the Monday lane'))
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

  it('a note typed but never saved (offline, tab closed) survives the next read and is saved then', async () => {
    const offline = { id: 'n2', body: 'Typed on the train', created_at: '2026-10-22T09:00:00Z', updated_at: '2026-10-22T09:00:00Z' }
    cache('u1', [offline, old], [['n1', old.body]])
    renderInFrame(<Notes />)
    await waitFor(() => expect(saves).toEqual([['n2', 'Typed on the train']]))
    expect(listText()).toContain('Typed on the train')
    expect(listText()).toContain('Call Mattan')
  })

  it('a note deleted on another device leaves this one too', async () => {
    const elsewhere = { id: 'n3', body: 'Gone on the phone', created_at: '2026-10-21T09:00:00Z', updated_at: '2026-10-21T09:00:00Z' }
    cache('u1', [elsewhere, old], [['n1', old.body], ['n3', elsewhere.body]])
    renderInFrame(<Notes />)
    await screen.findByText('Call Mattan')
    await waitFor(() => expect(listText()).not.toContain('Gone on the phone'))
    expect(saves).toEqual([])
  })

  it('another account never paints the cached notes of the last one', async () => {
    cache('u2', [{ ...old, id: 'secret', body: 'Someone else' }], [['secret', 'Someone else']])
    renderInFrame(<Notes />)
    await screen.findByText('Call Mattan')
    expect(listText()).not.toContain('Someone else')
  })
})
