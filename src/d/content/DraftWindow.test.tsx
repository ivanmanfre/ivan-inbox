// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
// The inline Fix row mounts today's wb components, which read matchMedia (jsdom has none).
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia

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

const lib = vi.hoisted(() => ({ saveDraftBody: vi.fn(), approveDraft: vi.fn(), skipDraft: vi.fn(), setBoardVisible: vi.fn(), setDraftImage: vi.fn(), setDraftMedia: vi.fn(), listClientPhotos: vi.fn(), listStills: vi.fn() }))
vi.mock('../../lib/content', async orig => {
  const real = await orig<typeof import('../../lib/content')>()
  return { ...real, saveDraftBody: lib.saveDraftBody, approveDraft: lib.approveDraft, skipDraft: lib.skipDraft, setBoardVisible: lib.setBoardVisible, setDraftImage: lib.setDraftImage, setDraftMedia: lib.setDraftMedia, listClientPhotos: lib.listClientPhotos, listStills: lib.listStills }
})
const sa = vi.hoisted(() => ({ scheduleDraft: vi.fn() }))
vi.mock('./writes', () => ({ scheduleGuarded: sa.scheduleDraft }))

import { DraftSaveConflict } from '../../lib/content'
import { DraftWindow } from './DraftWindow'
import { flushDecisions, resetDecisionsForTest } from './decisions'

const props = (over = {}) => ({
  id: 'd1', lane: 'ivan' as const, queue: ['d0', 'd1', 'd2'], onPick: vi.fn(), onClose: vi.fn(), refresh: vi.fn(),
  days: [], armed: new Set<string>(), armedFailed: false, ...over,
})

beforeEach(() => { current = detail; Object.values(lib).forEach(f => f.mockReset()); sa.scheduleDraft.mockReset(); resetDecisionsForTest() })
afterEach(cleanup)

describe('draft window', () => {
  it('shows the post, its place in the queue, QA scores and the first issue', () => {
    renderInFrame(<DraftWindow {...props()} />)
    expect(screen.getByText('2 of 3')).toBeTruthy()
    expect(screen.getByText('Para two.')).toBeTruthy()
    expect(screen.getByText('DISTINCT')).toBeTruthy()
    expect(screen.getByText('Opener reuses a sample.')).toBeTruthy()
  })

  it('approve is one tap: it walks on at once, holds the write for Undo, then writes through approveDraft', async () => {
    const p = props()
    lib.approveDraft.mockResolvedValue(undefined)
    renderInFrame(<DraftWindow {...p} />)
    fireEvent.click(document.querySelector('[data-verb="approve"]')!)
    expect(p.onPick).toHaveBeenCalledWith('d2')
    expect(document.querySelector('.d-confirm')).toBeNull()
    expect(await screen.findByText('Approved.')).toBeTruthy()
    expect(lib.approveDraft).not.toHaveBeenCalled()
    await flushDecisions()
    expect(lib.approveDraft).toHaveBeenCalledWith('d1')
  })

  it('Undo on the approve receipt means nothing is ever written', async () => {
    renderInFrame(<DraftWindow {...props()} />)
    fireEvent.click(document.querySelector('[data-verb="approve"]')!)
    fireEvent.click(await screen.findByText('Undo'))
    await flushDecisions()
    expect(lib.approveDraft).not.toHaveBeenCalled()
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

  it('a Rise row offers Put on his board (confirmed) and never Approve', async () => {
    current = { ...detail, client_id: 'risedtc', board_visible: false }
    lib.setBoardVisible.mockResolvedValue(undefined)
    renderInFrame(<DraftWindow {...props({ lane: 'risedtc' })} />)
    expect(document.querySelector('[data-verb="approve"]')).toBeNull()
    fireEvent.click(document.querySelector('[data-verb="board-on"]')!)
    await screen.findByText('Put this on Mattan’s board?')
    fireEvent.click(document.querySelector('[data-verb="confirm"]')!)
    await waitFor(() => expect(lib.setBoardVisible).toHaveBeenCalledWith('d1', true))
  })

  it('ARCH is view only: no board, date, approve, skip or delete key; Edit and the Picture row stay', () => {
    for (const board_visible of [false, true]) {
      current = { ...detail, client_id: 'arch', board_visible }
      renderInFrame(<DraftWindow {...props({ lane: 'arch' })} />)
      for (const v of ['board-on', 'board-off', 'delete', 'approve', 'skip', 'schedule', 'schedule-open']) {
        expect(document.querySelector(`[data-verb="${v}"]`), v).toBeNull()
      }
      expect(document.querySelector('[data-verb="edit"]')).toBeTruthy()
      expect(document.querySelector('.cn-pic2')).toBeTruthy()
      expect(screen.getByText(/View only on Arch/)).toBeTruthy()
      cleanup()
    }
    expect(lib.setBoardVisible).not.toHaveBeenCalled()
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

  it('Skip is one tap with Undo: no confirm, and Undo writes nothing', async () => {
    const p = props()
    renderInFrame(<DraftWindow {...p} />)
    fireEvent.click(document.querySelector('[data-verb="skip"]')!)
    expect(document.querySelector('.d-confirm')).toBeNull()
    expect(p.onPick).toHaveBeenCalledWith('d2')
    fireEvent.click(await screen.findByText('Undo'))
    await flushDecisions()
    expect(lib.skipDraft).not.toHaveBeenCalled()
  })

  it('the QA override keeps its confirm: approving an errored draft asks first', async () => {
    current = { ...detail, status: 'error' }
    renderInFrame(<DraftWindow {...props()} />)
    fireEvent.click(document.querySelector('[data-verb="approve"]')!)
    expect(await screen.findByText('Approve this draft anyway?')).toBeTruthy()
  })

  it('Fix or remove are keys in the open post, Regenerate named for what it does', () => {
    renderInFrame(<DraftWindow {...props()} />)
    const fix = document.querySelector('.cn-fix2')!
    expect(fix).toBeTruthy()
    const labels = [...fix.querySelectorAll('button')].map(b => b.textContent)
    expect(labels).toEqual(['Rewrite the copy', 'Back to idea', 'Delete draft'])
    expect(document.querySelector('[data-verb="fix"]')).toBeNull()
  })

  it('the preview folds like the feed: three lines, then …see more', () => {
    current = { ...detail, post_body: 'Line one of the hook.\nLine two.\nLine three.\nLine four is below the fold.' }
    renderInFrame(<DraftWindow {...props()} />)
    expect(screen.queryByText(/Line four/)).toBeNull()
    fireEvent.click(document.querySelector('[data-verb="see-more"]')!)
    expect(screen.getByText(/Line four/)).toBeTruthy()
  })
})

describe('the picture, under the post (every lane)', () => {
  const img = 'https://x.supabase.co/storage/v1/object/public/post-stills/selfie-pool-a/selfie-12.jpg'
  const arch = 'https://x.supabase.co/storage/v1/object/public/client-photos/arch-agency/davorin-1.jpg'
  const verb = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLButtonElement | null
  const previewImg = () => document.querySelector('.cn-liimg') as HTMLImageElement | null

  it('a scheduled text post offers Change and Remove; Remove goes through the gated RPC and says so', async () => {
    current = { ...detail, status: 'scheduled', scheduled_at: '2026-09-29T18:16:00Z', image_urls: [img] }
    lib.setDraftMedia.mockResolvedValue('')
    const refresh = vi.fn()
    renderInFrame(<DraftWindow {...props({ refresh })} />)
    expect(verb('picture-change')!.textContent).toBe('Change')
    fireEvent.click(verb('picture-remove')!)
    await waitFor(() => expect(lib.setDraftMedia).toHaveBeenCalledWith('d1', null))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(await screen.findByText('Picture removed.')).toBeTruthy()
    expect(lib.setDraftImage).not.toHaveBeenCalled()
  })

  it('an image-less post offers Add, not Remove', () => {
    renderInFrame(<DraftWindow {...props()} />)
    expect(verb('picture-change')!.textContent).toBe('Add')
    expect(verb('picture-remove')).toBeNull()
  })

  it('a carousel gets no picture row at all: one photo would replace the deck', () => {
    current = { ...detail, type: 'carousel', image_urls: [img, img] }
    renderInFrame(<DraftWindow {...props()} />)
    expect(document.querySelector('.cn-pic2')).toBeNull()
    expect(verb('picture-change')).toBeNull()
  })

  it('a published post gets no picture row', () => {
    current = { ...detail, status: 'published', published_at: '2026-09-28T08:00:00Z', image_urls: [img] }
    renderInFrame(<DraftWindow {...props()} />)
    expect(document.querySelector('.cn-pic2')).toBeNull()
  })

  it("a client post gets the row too, and picks from the client's own library", async () => {
    current = { ...detail, client_id: 'arch', status: 'review', board_visible: true, image_urls: null }
    lib.listClientPhotos.mockResolvedValue([{ name: 'davorin-1.jpg', url: arch, thumb: arch + '?w=200' }])
    let resolve!: (v: string) => void
    lib.setDraftMedia.mockImplementation(() => new Promise<string>(r => { resolve = r }))
    const refresh = vi.fn()
    renderInFrame(<DraftWindow {...props({ lane: 'arch', refresh })} />)
    fireEvent.click(verb('picture-change')!)
    await waitFor(() => expect(lib.listClientPhotos).toHaveBeenCalledWith('arch-agency'))
    fireEvent.click(await screen.findByLabelText('Use davorin-1.jpg'))
    // Optimistic: the preview shows the pick before the database answers.
    await waitFor(() => expect(previewImg()?.getAttribute('src')).toBe(arch))
    expect(lib.setDraftMedia).toHaveBeenCalledWith('d1', arch)
    resolve(arch)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(await screen.findByText('Davorin’s board shows it now.')).toBeTruthy()
  })

  it('a refused write puts the old picture back and raises a failed toast', async () => {
    current = { ...detail, image_urls: [img] }
    lib.listStills.mockResolvedValue([{ name: 'b.jpg', folder: 'library', url: 'https://x/b.jpg', thumb: 'https://x/b.jpg' }])
    lib.setDraftMedia.mockRejectedValue(new Error('Only a draft at Needs review, Approved or Scheduled can change its picture. Nothing changed.'))
    const refresh = vi.fn()
    renderInFrame(<DraftWindow {...props({ refresh })} />)
    fireEvent.click(verb('picture-change')!)
    fireEvent.click(await screen.findByLabelText('Use b.jpg'))
    expect(await screen.findByText(/can change its picture/)).toBeTruthy()
    await waitFor(() => expect(previewImg()?.getAttribute('src')).toBe(img))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('a client post at Approved gets no row (the board function refuses it)', () => {
    current = { ...detail, client_id: 'risedtc', status: 'approved' }
    renderInFrame(<DraftWindow {...props({ lane: 'risedtc' })} />)
    expect(document.querySelector('.cn-pic2')).toBeNull()
  })
})
