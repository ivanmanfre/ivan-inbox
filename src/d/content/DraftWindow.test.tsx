// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'

const detail = {
  id: 'd1', client_id: null, status: 'review', type: 'text', title: 'A profitable cold email channel', topic: null,
  post_body: 'Para one.\n\nPara two.', scheduled_at: null, source_post_id: null, image_urls: null,
  taxonomy: { pillar: 'trust' }, updated_at: '2026-09-26T21:10:00Z', created_at: '2026-09-20T10:00:00Z',
  board_visible: null, funnel_stage: 'trust',
  qa: { score: 88, verdict: 'PASS', feedback: 'Scores:\n  VOICE: 8/10\n  DISTINCT: 4/10\nIssues:\n- Opener reuses a sample.' },
  agent_log: [{ agent: 'QA', body: 'VERDICT: PASS', ts: '2026-09-20T10:00:00Z' }], source_detail: null,
}
let current: Record<string, unknown> = detail

vi.mock('../../hooks/useContent', () => ({
  useDraftDetail: () => ({ detail: current, missing: false, loading: false, error: null }),
}))

const lib = vi.hoisted(() => ({ saveDraftBody: vi.fn(), approveDraft: vi.fn(), skipDraft: vi.fn(), setBoardVisible: vi.fn(), setDraftImage: vi.fn() }))
vi.mock('../../lib/content', async orig => {
  const real = await orig<typeof import('../../lib/content')>()
  return { ...real, saveDraftBody: lib.saveDraftBody, approveDraft: lib.approveDraft, skipDraft: lib.skipDraft, setBoardVisible: lib.setBoardVisible, setDraftImage: lib.setDraftImage }
})
const sa = vi.hoisted(() => ({ scheduleDraft: vi.fn() }))
vi.mock('./writes', () => ({ scheduleGuarded: sa.scheduleDraft }))

import { DraftSaveConflict } from '../../lib/content'
import { DraftWindow } from './DraftWindow'

const props = (over = {}) => ({
  id: 'd1', lane: 'ivan' as const, queue: ['d0', 'd1', 'd2'], onPick: vi.fn(), onClose: vi.fn(), refresh: vi.fn(),
  days: [], armed: new Set<string>(), armedFailed: false, ...over,
})

beforeEach(() => { current = detail; Object.values(lib).forEach(f => f.mockReset()); sa.scheduleDraft.mockReset() })
afterEach(cleanup)

describe('draft window', () => {
  it('shows the post, its place in the queue, QA scores and the first issue', () => {
    renderInFrame(<DraftWindow {...props()} />)
    expect(screen.getByText('2 of 3')).toBeTruthy()
    expect(screen.getByText('Para two.')).toBeTruthy()
    expect(screen.getByText('DISTINCT')).toBeTruthy()
    expect(screen.getByText('Opener reuses a sample.')).toBeTruthy()
  })

  it('approve writes through approveDraft and walks to the next row (no confirm on a clean approve)', async () => {
    const p = props()
    lib.approveDraft.mockResolvedValue(undefined)
    renderInFrame(<DraftWindow {...p} />)
    fireEvent.click(document.querySelector('[data-verb="approve"]')!)
    await waitFor(() => expect(lib.approveDraft).toHaveBeenCalledWith('d1'))
    await waitFor(() => expect(p.onPick).toHaveBeenCalledWith('d2'))
  })

  it('j/k walk the queue and wait while editing', () => {
    const p = props()
    renderInFrame(<DraftWindow {...p} />)
    fireEvent.keyDown(window, { key: 'k' })
    expect(p.onPick).toHaveBeenCalledWith('d0')
    fireEvent.click(document.querySelector('[data-verb="edit"]')!)
    fireEvent.keyDown(window, { key: 'j' })
    expect(p.onPick).toHaveBeenCalledTimes(1)
  })

  it('a save conflict never picks a winner; keep mine re-bases on theirs and saves again', async () => {
    lib.saveDraftBody.mockRejectedValueOnce(new DraftSaveConflict({ kind: 'conflict', theirs: 'THEIR TEXT', theirUpdatedAt: '2026-09-26T21:10:00Z' }))
    lib.saveDraftBody.mockResolvedValueOnce(undefined)
    renderInFrame(<DraftWindow {...props()} />)
    fireEvent.click(document.querySelector('[data-verb="edit"]')!)
    fireEvent.change(document.querySelector('.cn-ed')!, { target: { value: 'MINE' } })
    fireEvent.click(document.querySelector('[data-verb="save"]')!)
    await screen.findByText('This draft changed in the database while you were editing it.')
    expect(screen.getByText('THEIR TEXT')).toBeTruthy()
    expect(lib.saveDraftBody.mock.calls[0].slice(0, 4)).toEqual(['d1', 'MINE', detail.taxonomy, 'Para one.\n\nPara two.'])
    fireEvent.click(document.querySelector('[data-verb="keep-mine"]')!)
    await waitFor(() => expect(lib.saveDraftBody).toHaveBeenCalledTimes(2))
    expect(lib.saveDraftBody.mock.calls[1].slice(0, 4)).toEqual(['d1', 'MINE', detail.taxonomy, 'THEIR TEXT'])
  })

  it('schedule asks first, then arms the picked time', async () => {
    sa.scheduleDraft.mockResolvedValue(undefined)
    renderInFrame(<DraftWindow {...props()} />)
    fireEvent.click(document.querySelector('[data-verb="schedule"]')!)
    await screen.findByText('Put this post on LinkedIn?')
    expect(sa.scheduleDraft).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('[data-verb="confirm"]')!)
    await waitFor(() => expect(sa.scheduleDraft).toHaveBeenCalledTimes(1))
    const at = new Date(sa.scheduleDraft.mock.calls[0][1])
    expect([at.getHours(), at.getMinutes()]).toEqual([10, 45])
    expect([0, 6]).not.toContain(at.getDay())
  })

  it('a client row offers Put on his board (confirmed) and never Approve', async () => {
    current = { ...detail, client_id: 'arch', board_visible: false }
    lib.setBoardVisible.mockResolvedValue(undefined)
    renderInFrame(<DraftWindow {...props({ lane: 'arch' })} />)
    expect(document.querySelector('[data-verb="approve"]')).toBeNull()
    fireEvent.click(document.querySelector('[data-verb="board-on"]')!)
    await screen.findByText('Put this on Davorin’s board?')
    fireEvent.click(document.querySelector('[data-verb="confirm"]')!)
    await waitFor(() => expect(lib.setBoardVisible).toHaveBeenCalledWith('d1', true))
  })

  it('HAZARD: no Schedule on a published, errored or generating draft, and the verb refuses', () => {
    for (const st of [{ status: 'published', published_at: '2026-09-20T09:00:00Z' }, { status: 'error' }, { status: 'generating' }, { status: 'idea' }]) {
      current = { ...detail, ...st }
      renderInFrame(<DraftWindow {...props()} />)
      expect(document.querySelector('[data-verb="schedule"]')).toBeNull()
      expect(document.querySelector('[data-verb="schedule-open"]')).toBeNull()
      expect(screen.getByText(/Schedule is not offered/)).toBeTruthy()
      cleanup()
    }
    expect(sa.scheduleDraft).not.toHaveBeenCalled()
  })

  it('an armed row keeps Reschedule behind its toggle (today: folded on a scheduled row)', async () => {
    current = { ...detail, status: 'scheduled', scheduled_at: '2026-10-01T08:45:00Z' }
    renderInFrame(<DraftWindow {...props()} />)
    expect(document.querySelector('[data-verb="schedule"]')).toBeNull()
    fireEvent.click(document.querySelector('[data-verb="schedule-open"]')!)
    expect(document.querySelector('[data-verb="schedule"]')!.textContent).toContain('Reschedule')
  })

  it('Skip asks with the red danger confirm and Enter never confirms it', async () => {
    renderInFrame(<DraftWindow {...props()} />)
    fireEvent.click(document.querySelector('[data-verb="skip"]')!)
    await screen.findByText('Skip this draft?')
    expect(document.querySelector('.d-confirm-danger')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(lib.skipDraft).not.toHaveBeenCalled()
  })
})

describe('the picture, under the post', () => {
  const img = 'https://x.supabase.co/storage/v1/object/public/post-stills/selfie-pool-a/selfie-12.jpg'
  it('a scheduled text post offers Change and Remove without opening Fix or remove, and Remove clears it', async () => {
    current = { ...detail, status: 'scheduled', scheduled_at: '2026-09-29T18:16:00Z', image_urls: [img] }
    lib.setDraftImage.mockResolvedValue(undefined)
    const refresh = vi.fn()
    renderInFrame(<DraftWindow {...props({ refresh })} />)
    expect(screen.getByText('Change picture')).toBeTruthy()
    fireEvent.click(screen.getByText('Remove picture'))
    await waitFor(() => expect(lib.setDraftImage).toHaveBeenCalledWith('d1', null))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
  it('an image-less post offers Add, not Remove', () => {
    renderInFrame(<DraftWindow {...props()} />)
    expect(screen.getByText('Add picture')).toBeTruthy()
    expect(screen.queryByText('Remove picture')).toBeNull()
  })
  it('a carousel gets no picture controls: one photo would replace the deck', () => {
    current = { ...detail, type: 'carousel', image_urls: [img, img] }
    renderInFrame(<DraftWindow {...props()} />)
    expect(screen.queryByText('Change picture')).toBeNull()
    expect(screen.queryByText('Remove picture')).toBeNull()
  })
})
