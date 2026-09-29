// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import type { ContentDraft } from '../../lib/content'

const lib = vi.hoisted(() => ({ approveDraft: vi.fn(), skipDraft: vi.fn(), setBoardVisible: vi.fn(), deleteClientDraft: vi.fn(), deleteDraft: vi.fn() }))
vi.mock('../../lib/content', async orig => ({ ...(await orig<typeof import('../../lib/content')>()), ...lib }))
import { Queue } from './Queue'
import { rowCaps, rowVerbsFor } from './rowVerbs'
import { flushDecisions, resetDecisionsForTest } from './decisions'

const row = (o: Partial<ContentDraft>): ContentDraft => ({ id: 'r1', client_id: null, status: 'review', type: 'text', title: 'Row one', topic: null, post_body: '', scheduled_at: null, published_at: null,
  created_at: '2026-09-26T10:00:00Z', updated_at: '2026-09-26T10:00:00Z', image_urls: null, taxonomy: null, board_visible: null, ...o } as ContentDraft)
const seat = { rows: [], loading: false, error: null, loadedAt: 'x', refresh: vi.fn() }
afterEach(() => { cleanup(); resetDecisionsForTest() })

describe('queue row writes (today’s inline Approve / Skip / To board / Delete)', () => {
  it('caps match today’s Card: a board row is never deletable or promotable from here', () => {
    expect(rowCaps(row({}), 'ivan')).toEqual(['approve', 'skip', 'delete'])
    expect(rowCaps(row({ client_id: 'risedtc' }), 'risedtc')).toEqual(['promote', 'delete'])
    expect(rowCaps(row({ client_id: 'risedtc', board_visible: true }), 'risedtc')).toEqual([])
    expect(rowVerbsFor(row({ client_id: 'risedtc' }), 'risedtc')).toEqual(['board', 'delete'])
  })
  it('ARCH rows carry no row verb and no bulk cap (view only: its publisher posts from review)', () => {
    expect(rowCaps(row({ client_id: 'arch' }), 'arch')).toEqual([])
    expect(rowVerbsFor(row({ client_id: 'arch' }), 'arch')).toEqual([])
  })
  it('Skip on a row is one tap: no confirm, the write waits on its Undo receipt, then lands', async () => {
    lib.skipDraft.mockResolvedValue(undefined)
    renderInFrame(<Queue lane="ivan" setLane={vi.fn()} seat={seat} fresh={[row({})]} older={[]} counts={{ ivan: 1, risedtc: 0, arch: 0 }} openId={null} onOpen={vi.fn()} />)
    fireEvent.click(document.querySelector('[data-verb="row-skip"]')!)
    expect(document.querySelector('.d-confirm')).toBeNull()
    expect(await screen.findByText('Skipped.')).toBeTruthy()
    expect(lib.skipDraft).not.toHaveBeenCalled()
    await flushDecisions()
    expect(lib.skipDraft).toHaveBeenCalledWith('r1')
  })
  it('To board on a client row writes setBoardVisible(true) after the confirm', async () => {
    lib.setBoardVisible.mockResolvedValue(undefined)
    renderInFrame(<Queue lane="risedtc" setLane={vi.fn()} seat={seat} fresh={[row({ client_id: 'risedtc' })]} older={[]} counts={{ ivan: 0, risedtc: 1, arch: 0 }} openId={null} onOpen={vi.fn()} />)
    fireEvent.click(document.querySelector('[data-verb="row-board"]')!)
    fireEvent.click(await screen.findByText('Put it on his board'))
    await waitFor(() => expect(lib.setBoardVisible).toHaveBeenCalledWith('r1', true))
  })
})
