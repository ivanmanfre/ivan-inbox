// @vitest-environment jsdom
// The glance tasks strip: Done / Remove / Add call TODAY'S lib/ops writes (mocked here),
// and the one task insert writes exactly createBotTask's row shape with source 'inbox'.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import type { OpsDraft } from '../../lib/ops'

const insert = vi.fn(async (_row: unknown) => ({ error: null }))
const markDone = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({ insert }) } }))
const rows: OpsDraft[] = []
vi.mock('../../hooks/useOps', () => ({ useOps: () => ({ drafts: rows, loading: false, error: null, loadedAt: '2026-09-27T12:00:00Z', refresh: vi.fn(), markDone }) }))
vi.mock('../../lib/ops', async orig => {
  const real = await orig<typeof import('../../lib/ops')>()
  return { ...real, completeTask: vi.fn(async () => {}), discardOpsDraft: vi.fn(async () => {}), markTaskBooked: vi.fn(async () => ({ action: 'booked', prospect: null })) }
})
import * as lib from '../../lib/ops'
import { HomeTasks } from './Tasks'

const task = (id: string, body: string, due?: string): OpsDraft => ({
  id, client_id: 'ivan', kind: 'task', slack_channel: '', body, context: due ? { due_at: due } : {},
  created_at: '2026-09-27T10:00:00Z', approved_at: null, sent_at: null, send_blocked_reason: null,
})
const key = (v: string, i = 0) => document.querySelectorAll(`[data-verb="${v}"]`)[i] as HTMLElement

beforeEach(() => { vi.clearAllMocks(); rows.splice(0, rows.length, task('a', 'Undated one'), task('b', 'Send Liton the follow-up email', lib.localDay(Date.now() + 864e5))) })
afterEach(cleanup)

describe('home tasks', () => {
  it('dated before undated; Done completes that row', async () => {
    renderInFrame(<HomeTasks />, { hash: '#exp/d/home' })
    const titles = [...document.querySelectorAll('.gt-t')].map(e => e.textContent)
    expect(titles).toEqual(['Send Liton the follow-up email', 'Undated one'])
    fireEvent.click(key('tick'))
    await waitFor(() => expect(lib.completeTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' })))
    await waitFor(() => expect(markDone).toHaveBeenCalledWith('b'))
  })
  it('Remove asks with the danger confirm first, then discards', async () => {
    renderInFrame(<HomeTasks />, { hash: '#exp/d/home' })
    fireEvent.click(key('remove', 1))
    await waitFor(() => expect(document.querySelector('.d-confirm-danger')).toBeTruthy())
    expect(lib.discardOpsDraft).not.toHaveBeenCalled()
    fireEvent.click(key('confirm'))
    await waitFor(() => expect(lib.discardOpsDraft).toHaveBeenCalledWith('a', 'task'))
    await waitFor(() => expect(markDone).toHaveBeenCalledWith('a'))
  })
  it('does not remove a failed task, but removes a booked task after a successful save', async () => {
    vi.mocked(lib.completeTask).mockRejectedValueOnce(new Error('failed'))
    rows.splice(0, rows.length, task('book', 'Book their call'))
    rows[0].context = { action: 'book_link', prospect_name: 'Ada' }
    renderInFrame(<HomeTasks />, { hash: '#exp/d/home' })
    fireEvent.click(key('tick'))
    await waitFor(() => expect(document.querySelector('.gt-err')?.textContent).toBe('failed'))
    expect(markDone).not.toHaveBeenCalled()
    fireEvent.click(key('booked'))
    fireEvent.change(document.querySelector('input[type="datetime-local"]')!, { target: { value: '2026-10-12T10:00' } })
    fireEvent.click(key('booked-save'))
    await waitFor(() => expect(lib.markTaskBooked).toHaveBeenCalled())
    await waitFor(() => expect(markDone).toHaveBeenCalledWith('book'))
  })
  it('Add with Tomorrow inserts the one task row shape', async () => {
    renderInFrame(<HomeTasks />, { hash: '#exp/d/home' })
    fireEvent.change(document.querySelector('.gt-in')!, { target: { value: '  Call Basile  ' } })
    fireEvent.click(key('due-tomorrow'))
    fireEvent.click(key('add-task'))
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    const r = insert.mock.calls[0][0] as { client_id: string; kind: string; body: string; context: Record<string, string> }
    expect(r).toMatchObject({ client_id: 'ivan', kind: 'task', body: 'Call Basile', context: { source: 'inbox', due_at: lib.localDay(Date.now() + 864e5) } })
    expect(r.context.card_key).toMatch(/^inbox:/)
  })
  it('createBotTask still writes its own shape through the same insert', async () => {
    await lib.createBotTask('turn1', 2, 'Title', 'Detail')
    expect(insert).toHaveBeenCalledWith({ client_id: 'ivan', kind: 'task', body: 'Title\n\nDetail', context: { source: 'claude', card_key: 'bot:turn1:2' } })
  })
})
