// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmCtx, type ConfirmOpts } from '../../lib/confirm'
import type { ContentDraft } from '../../lib/content'
const sa = vi.hoisted(() => ({ clearHumanEdit: vi.fn(), restoreHumanEdit: vi.fn(), regenerateClientDraft: vi.fn(), regenerateDraft: vi.fn() }))
vi.mock('../../lib/studioActions', async orig => ({ ...await orig<typeof import('../../lib/studioActions')>(), ...sa }))
import { RetryDraft } from './actions'
const d = { id: 'client-error', client_id: 'risedtc', status: 'error', type: 'text', title: 'Client post', post_body: 'Edited by hand', taxonomy: { human_edited: true, register: 'tactical', story_ref: 'owned' } } as unknown as ContentDraft
const confirm = vi.fn(async (_options: ConfirmOpts) => true)
beforeEach(() => { vi.clearAllMocks(); confirm.mockResolvedValue(true); sa.clearHumanEdit.mockResolvedValue(undefined); sa.restoreHumanEdit.mockResolvedValue(true); sa.regenerateClientDraft.mockResolvedValue({ postFormat: 'Text' }) })
afterEach(cleanup)

describe('protected internal client recovery', () => {
  it('does not remove edit protection or regenerate when replacement is cancelled', async () => {
    confirm.mockResolvedValue(false)
    render(<ConfirmCtx.Provider value={confirm}><RetryDraft d={d} lane="risedtc" allowProtectedCopy onDone={() => {}} /></ConfirmCtx.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(confirm.mock.calls[0][0]).toMatchObject({ danger: true })
    expect(sa.clearHumanEdit).not.toHaveBeenCalled()
    expect(sa.regenerateClientDraft).not.toHaveBeenCalled()
  })

  it('requires explicit replacement and passes cleared protection while preserving client context', async () => {
    const done = vi.fn()
    render(<ConfirmCtx.Provider value={confirm}><RetryDraft d={d} lane="risedtc" allowProtectedCopy onDone={done} /></ConfirmCtx.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(sa.regenerateClientDraft).toHaveBeenCalled())
    expect(sa.clearHumanEdit).toHaveBeenCalledWith(d)
    expect(sa.regenerateClientDraft).toHaveBeenCalledWith(expect.objectContaining({ id: d.id, client_id: 'risedtc', taxonomy: { human_edited: 'false', register: 'tactical', story_ref: 'owned' } }), 'risedtc')
    expect(sa.regenerateDraft).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledOnce()
  })

  it.each([{ board_visible: true }, { status: 'review' }, { status: 'scheduled' }])('keeps protection for a draft outside internal recovery: %s', async fields => {
    render(<ConfirmCtx.Provider value={confirm}><RetryDraft d={{ ...d, ...fields }} lane="risedtc" allowProtectedCopy onDone={() => {}} /></ConfirmCtx.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(sa.clearHumanEdit).not.toHaveBeenCalled()
    expect(sa.regenerateClientDraft).not.toHaveBeenCalled()
  })

  it('retains a visible failure and does not regenerate when clearing edit protection fails', async () => {
    sa.clearHumanEdit.mockRejectedValueOnce(new Error('Protection could not be cleared'))
    render(<ConfirmCtx.Provider value={confirm}><RetryDraft d={d} lane="risedtc" allowProtectedCopy onDone={() => {}} /></ConfirmCtx.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Protection could not be cleared')
    expect(sa.regenerateClientDraft).not.toHaveBeenCalled()
  })

  it('restores edit protection when regeneration fails after clearing it', async () => {
    sa.regenerateClientDraft.mockRejectedValueOnce(new Error('Generation unavailable'))
    render(<ConfirmCtx.Provider value={confirm}><RetryDraft d={d} lane="risedtc" allowProtectedCopy onDone={() => {}} /></ConfirmCtx.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(/Manual copy is protected again/)
    expect(sa.restoreHumanEdit).toHaveBeenCalledWith(d)
  })

  it('reports a protection rollback failure without hiding the original generation error', async () => {
    sa.regenerateClientDraft.mockRejectedValueOnce(new Error('Generation unavailable'))
    sa.restoreHumanEdit.mockRejectedValueOnce(new Error('Rollback unavailable'))
    render(<ConfirmCtx.Provider value={confirm}><RetryDraft d={d} lane="risedtc" allowProtectedCopy onDone={() => {}} /></ConfirmCtx.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(/Generation unavailable.*Rollback unavailable/)
  })

  it('reports a changed row when protection cannot safely be restored', async () => {
    sa.regenerateClientDraft.mockRejectedValueOnce(new Error('Generation unavailable'))
    sa.restoreHumanEdit.mockResolvedValueOnce(false)
    render(<ConfirmCtx.Provider value={confirm}><RetryDraft d={d} lane="risedtc" allowProtectedCopy onDone={() => {}} /></ConfirmCtx.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(/draft changed.*Reload/)
  })

  it('does not offer a retry for an unsupported generator', () => {
    render(<ConfirmCtx.Provider value={confirm}><RetryDraft d={{ ...d, client_id: 'arch' }} lane="arch" allowProtectedCopy onDone={() => {}} /></ConfirmCtx.Provider>)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
