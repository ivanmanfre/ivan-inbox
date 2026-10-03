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
    expect(rowCaps(row({ client_id: 'arch' }), 'arch')).toEqual(['promote', 'delete'])
    expect(rowCaps(row({ client_id: 'arch', board_visible: true }), 'arch')).toEqual([])
    expect(rowVerbsFor(row({ client_id: 'arch' }), 'arch')).toEqual(['board', 'delete'])
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
    renderInFrame(<Queue lane="arch" setLane={vi.fn()} seat={seat} fresh={[row({ client_id: 'arch' })]} older={[]} counts={{ ivan: 0, risedtc: 0, arch: 1 }} openId={null} onOpen={vi.fn()} />)
    fireEvent.click(document.querySelector('[data-verb="row-board"]')!)
    fireEvent.click(await screen.findByText('Put it on his board'))
    await waitFor(() => expect(lib.setBoardVisible).toHaveBeenCalledWith('r1', true))
  })
})

describe('run 39: a brain draft in review or error is judged, never bulk-approved, skipped or deleted', () => {
  const brain = (o: Partial<ContentDraft> = {}) => row({ cb34_p2_member: true, ...o })
  it('rowCaps drops approve, skip and delete for a brain draft in review or error', () => {
    expect(rowCaps(brain(), 'ivan')).toEqual([])
    expect(rowCaps(brain({ status: 'error' }), 'ivan')).toEqual([])
    expect(rowCaps(row({ taxonomy: { source: 'content-brain' } }), 'ivan')).toEqual([])
    expect(rowCaps(brain({ client_id: 'arch' }), 'arch')).toEqual(['promote'])
    expect(rowVerbsFor(brain({ client_id: 'arch' }), 'arch')).toEqual(['board'])
    expect(rowVerbsFor(brain(), 'ivan')).toEqual([])
  })
  it('a brain draft past review keeps today’s caps, and a normal draft is untouched', () => {
    expect(rowCaps(brain({ status: 'approved' }), 'ivan')).toEqual(['delete'])
    expect(rowCaps(row({ cb34_p2_member: false }), 'ivan')).toEqual(['approve', 'skip', 'delete'])
  })
})
