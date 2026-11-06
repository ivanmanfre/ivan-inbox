// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
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

const lib = vi.hoisted(() => ({ saveDraftBody: vi.fn(), approveDraft: vi.fn(), skipDraft: vi.fn(), setBoardVisible: vi.fn(), setDraftImage: vi.fn(), setDraftMedia: vi.fn(), setDraftPhotos: vi.fn(), listClientPhotos: vi.fn(), listStills: vi.fn() }))
vi.mock('../../lib/content', async orig => {
  const real = await orig<typeof import('../../lib/content')>()
  return { ...real, saveDraftBody: lib.saveDraftBody, approveDraft: lib.approveDraft, skipDraft: lib.skipDraft, setBoardVisible: lib.setBoardVisible, setDraftImage: lib.setDraftImage, setDraftMedia: lib.setDraftMedia, setDraftPhotos: lib.setDraftPhotos, listClientPhotos: lib.listClientPhotos, listStills: lib.listStills }
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
  it('shows the post, QA scores and the first issue; the header is the title and close only', () => {
    renderInFrame(<DraftWindow {...props()} />)
    expect(screen.queryByText('2 of 3')).toBeNull()
    expect(document.querySelector('.cn-av')).toBeNull()
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

  it('hides saved-copy checks while unsaved words are displayed', () => {
    renderInFrame(<DraftWindow {...props()} />)
    fireEvent.click(document.querySelector('[data-verb="edit"]')!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Post text' }), { target: { value: 'Changed words' } })
    expect(screen.getByText('Unsaved copy needs recheck.')).toBeTruthy()
    expect(document.querySelector('[aria-label="Current copy checks"]')!.textContent).not.toContain('QA checked')
  })

  it('keeps the draft open when Escape or post-navigation keys are pressed inside the image viewer', () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
    current = { ...detail, type: 'carousel', image_urls: ['https://example.test/one.png', 'https://example.test/two.png'] }
    const p = props()
    renderInFrame(<DraftWindow {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open slide 1 of 2' }))
    const viewer = screen.getByRole('dialog', { name: 'Image viewer' })
    fireEvent.keyDown(viewer, { key: 'j' })
    fireEvent.keyDown(viewer, { key: 'k' })
    expect(p.onPick).not.toHaveBeenCalled()
    fireEvent.keyDown(viewer, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Image viewer' })).toBeNull()
    expect(p.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Draft' })).toBeTruthy()
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

  it('locks the editor and keyboard exits during a deferred save, then retains text on failure', async () => {
    let reject!: (e: Error) => void
    lib.saveDraftBody.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const p = props()
    renderInFrame(<DraftWindow {...p} />)
    fireEvent.click(document.querySelector('[data-verb="edit"]')!)
    const editor = screen.getByRole('textbox', { name: 'Post text' }) as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'Unsaved copy' } })
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    expect(editor.disabled).toBe(true)
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(editor, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(lib.saveDraftBody).toHaveBeenCalledOnce()
    expect(p.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Post text' })).toBe(editor)
    await act(async () => reject(new Error('Save unavailable')))
    await screen.findByText('Save unavailable')
    expect(editor.disabled).toBe(false)
    expect(editor.value).toBe('Unsaved copy')
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

  it('after a save the panel keeps the saved text while the detail is still the old one, and a quick re-edit starts from it', async () => {
    lib.saveDraftBody.mockResolvedValue(undefined)
    renderInFrame(<DraftWindow {...props()} />)
    fireEvent.click(document.querySelector('[data-verb="edit"]')!)
    fireEvent.change(document.querySelector('.cn-ed')!, { target: { value: 'NEW COPY' } })
    fireEvent.click(document.querySelector('[data-verb="save"]')!)
    await screen.findByText('Saved.')
    // the detail refetch has not landed: d.post_body is still the old text
    expect(screen.getByText('NEW COPY')).toBeTruthy()
    expect(screen.queryByText('Para two.')).toBeNull()
    fireEvent.click(document.querySelector('[data-verb="edit"]')!)
    expect((document.querySelector('.cn-ed') as HTMLTextAreaElement).value).toBe('NEW COPY')
    fireEvent.change(document.querySelector('.cn-ed')!, { target: { value: 'NEWER COPY' } })
    fireEvent.click(document.querySelector('[data-verb="save"]')!)
    await waitFor(() => expect(lib.saveDraftBody).toHaveBeenCalledTimes(2))
    expect(lib.saveDraftBody.mock.calls[1].slice(0, 4)).toEqual(['d1', 'NEWER COPY', detail.taxonomy, 'NEW COPY'])
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

  it('the review panel shows the whole post and marks where the feed cuts (Ivan 2026-10-30)', () => {
    current = { ...detail, post_body: 'Line one of the hook.\nLine two.\nLine three.\nLine four is below the fold.\n\nA second paragraph.' }
    renderInFrame(<DraftWindow {...props()} />)
    const post = document.querySelector('.cn-lib')!
    expect(post.textContent).toContain('Line four is below the fold.')
    expect(post.textContent).toContain('A second paragraph.')
    expect(document.querySelector('[data-verb="see-more"]')).toBeNull()
    const mark = document.querySelector('[data-verb="fold-mark"]')!
    expect(mark.previousSibling?.textContent).toBe('Line one of the hook.\nLine two.\nLine three.')
    expect(post.querySelectorAll('p')).toHaveLength(2)
  })
})

describe('the picture, under the post (every lane)', () => {
  const img = 'https://x.supabase.co/storage/v1/object/public/post-stills/selfie-pool-a/selfie-12.jpg'
  const arch = 'https://x.supabase.co/storage/v1/object/public/client-photos/arch-agency/davorin-1.jpg'
  const verb = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLButtonElement | null
  const previewImg = () => document.querySelector('.cn-liimg') as HTMLImageElement | null

  it("a scheduled post of Ivan's: No photo writes an empty list through the gated RPC and says so", async () => {
    current = { ...detail, status: 'scheduled', scheduled_at: '2026-09-29T18:16:00Z', image_urls: [img] }
    lib.setDraftPhotos.mockResolvedValue([])
    const refresh = vi.fn()
    renderInFrame(<DraftWindow {...props({ refresh })} />)
    expect(verb('picture-change')!.textContent).toBe('+All photos')
    fireEvent.click(verb('picture-remove')!)
    await waitFor(() => expect(lib.setDraftPhotos).toHaveBeenCalledWith('d1', []))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(await screen.findByText('Photo taken off the post.')).toBeTruthy()
    expect(lib.setDraftMedia).not.toHaveBeenCalled()
    expect(lib.setDraftImage).not.toHaveBeenCalled()
  })

  it("an image-less post of Ivan's: No photo still stamps the opt-out until it is stamped", async () => {
    lib.setDraftPhotos.mockResolvedValue([])
    renderInFrame(<DraftWindow {...props()} />)
    expect(verb('picture-change')!.textContent).toBe('+All photos')
    expect(verb('picture-remove')!.getAttribute('aria-pressed')).toBe('true')
    expect(verb('picture-remove')!.disabled).toBe(false)
    expect(document.querySelectorAll('[data-verb="picture-option"]')).toHaveLength(0)
    fireEvent.click(verb('picture-remove')!)
    await waitFor(() => expect(lib.setDraftPhotos).toHaveBeenCalledWith('d1', []))
    cleanup()
    current = { ...detail, taxonomy: { no_photo: true } }
    renderInFrame(<DraftWindow {...props()} />)
    expect(verb('picture-remove')!.disabled).toBe(true)
  })

  describe("Ivan's multi-photo post (Rome, 2aa68333: 3 photos)", () => {
    const rome = [1, 2, 3].map(n => `https://x.supabase.co/storage/v1/object/public/post-stills/x-tracked/denisyurchak/2118384446910935081-${n}.jpg`)
    const options = () => [...document.querySelectorAll('[data-verb="picture-option"]')] as HTMLButtonElement[]
    const checked = () => options().map(b => b.getAttribute('aria-checked'))
    const previewSrcs = () => [...document.querySelectorAll('.cn-liimg, .cn-slides img')].map(i => i.getAttribute('src'))

    it('shows every photo checked and numbered; the preview shows all three', () => {
      current = { ...detail, image_urls: rome }
      renderInFrame(<DraftWindow {...props()} />)
      expect(options()).toHaveLength(3)
      expect(checked()).toEqual(['true', 'true', 'true'])
      expect(options().map(b => b.querySelector('.xr-pick-cap')!.textContent)).toEqual(['Photo 1', 'Photo 2', 'Photo 3'])
      expect(screen.getByText('3 photos post together in one post, in this order. Tap a photo to take it off.')).toBeTruthy()
      expect(previewSrcs()).toHaveLength(3)
    })

    it('tapping photo 2 takes only photo 2 off, keeps it as an option, and Undo puts it back', async () => {
      current = { ...detail, image_urls: rome }
      lib.setDraftPhotos.mockImplementation(async (_id: string, urls: string[]) => urls)
      const refresh = vi.fn()
      renderInFrame(<DraftWindow {...props({ refresh })} />)
      fireEvent.click(options()[1])
      expect(lib.setDraftPhotos).toHaveBeenCalledWith('d1', [rome[0], rome[2]])
      // optimistic, and the removed photo is still on the row, unchecked
      await waitFor(() => expect(checked()).toEqual(['true', 'false', 'true']))
      expect(previewSrcs()).toEqual([rome[0], rome[2]])
      expect(await screen.findByText('Photo taken off the post.')).toBeTruthy()
      expect(screen.getByText('2 photos post together in one post.')).toBeTruthy()
      fireEvent.click(document.querySelector('[data-verb="picture-undo"]')!)
      await waitFor(() => expect(lib.setDraftPhotos).toHaveBeenLastCalledWith('d1', rome))
    })

    it('a photo taken off goes back in its own place, never at the end', async () => {
      current = { ...detail, image_urls: [rome[0], rome[2]], taxonomy: { photo_options: rome } }
      lib.setDraftPhotos.mockImplementation(async (_id: string, urls: string[]) => urls)
      renderInFrame(<DraftWindow {...props()} />)
      expect(checked()).toEqual(['true', 'false', 'true'])
      fireEvent.click(options()[1])
      expect(lib.setDraftPhotos).toHaveBeenCalledWith('d1', rome)
    })

    it('No photo clears all three but keeps all three options', async () => {
      current = { ...detail, image_urls: rome }
      lib.setDraftPhotos.mockResolvedValue([])
      renderInFrame(<DraftWindow {...props()} />)
      fireEvent.click(verb('picture-remove')!)
      expect(lib.setDraftPhotos).toHaveBeenCalledWith('d1', [])
      await waitFor(() => expect(checked()).toEqual(['false', 'false', 'false']))
      expect(await screen.findByText('Photos taken off the post.')).toBeTruthy()
    })

    it('a refused write puts all the photos back and raises a failed toast', async () => {
      current = { ...detail, image_urls: rome }
      lib.setDraftPhotos.mockRejectedValue(new Error('This post is already published, so its picture is fixed. Nothing changed.'))
      const refresh = vi.fn()
      renderInFrame(<DraftWindow {...props({ refresh })} />)
      fireEvent.click(options()[0])
      expect(await screen.findByText(/already published/)).toBeTruthy()
      await waitFor(() => expect(checked()).toEqual(['true', 'true', 'true']))
      expect(previewSrcs()).toHaveLength(3)
      expect(refresh).not.toHaveBeenCalled()
    })

    it('a library pick is added to the post, not swapped in', async () => {
      current = { ...detail, image_urls: rome }
      lib.listStills.mockResolvedValue([{ name: 'b.jpg', folder: 'library', url: 'https://x/b.jpg', thumb: 'https://x/b.jpg' }])
      lib.setDraftPhotos.mockImplementation(async (_id: string, urls: string[]) => urls)
      renderInFrame(<DraftWindow {...props()} />)
      fireEvent.click(verb('picture-change')!)
      fireEvent.click(await screen.findByLabelText('Look at b.jpg'))
      expect(document.querySelector('[data-verb="picture-use"]')!.textContent).toBe('Add to the post')
      fireEvent.click(document.querySelector('[data-verb="picture-use"]')!)
      expect(lib.setDraftPhotos).toHaveBeenCalledWith('d1', [...rome, 'https://x/b.jpg'])
      await waitFor(() => expect(options()).toHaveLength(4))
    })

    it('a removed photo picked again from the library goes back in its own place', async () => {
      current = { ...detail, image_urls: [rome[0], rome[2]], taxonomy: { photo_options: rome } }
      lib.listStills.mockResolvedValue([{ name: 'rome-2.jpg', folder: 'library', url: rome[1], thumb: rome[1] }])
      lib.setDraftPhotos.mockImplementation(async (_id: string, urls: string[]) => urls)
      renderInFrame(<DraftWindow {...props()} />)
      fireEvent.click(verb('picture-change')!)
      fireEvent.click(await screen.findByLabelText('Look at rome-2.jpg'))
      fireEvent.click(document.querySelector('[data-verb="picture-use"]')!)
      expect(lib.setDraftPhotos).toHaveBeenCalledWith('d1', rome)
    })

    it('a tenth photo is refused in the app before any write', async () => {
      const nine = Array.from({ length: 9 }, (_, i) => `https://x/p${i}.jpg`)
      current = { ...detail, image_urls: nine.slice(0, 8), taxonomy: { photo_options: nine } }
      lib.setDraftPhotos.mockImplementation(async (_id: string, urls: string[]) => urls)
      renderInFrame(<DraftWindow {...props()} />)
      fireEvent.click(options()[8])
      await waitFor(() => expect(lib.setDraftPhotos).toHaveBeenCalledWith('d1', nine))
      await waitFor(() => expect(checked().every(c => c === 'true')).toBe(true))
      current = { ...detail, image_urls: nine, taxonomy: { photo_options: [...nine, 'https://x/p9.jpg'] } }
      cleanup(); lib.setDraftPhotos.mockClear()
      renderInFrame(<DraftWindow {...props()} />)
      fireEvent.click(options()[9])
      expect(await screen.findByText('A post takes at most 9 photos.')).toBeTruthy()
      expect(lib.setDraftPhotos).not.toHaveBeenCalled()
    })
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
    fireEvent.click(await screen.findByLabelText('Look at davorin-1.jpg'))
    fireEvent.click(document.querySelector('[data-verb="picture-use"]')!)
    // Optimistic: the preview shows the pick before the database answers.
    await waitFor(() => expect(previewImg()?.getAttribute('src')).toBe(arch))
    expect(lib.setDraftMedia).toHaveBeenCalledWith('d1', arch)
    resolve(arch)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(await screen.findByText('Davorin’s board shows it now.')).toBeTruthy()
  })

  it('a refused write puts the old picture back and raises a failed toast (client lane)', async () => {
    current = { ...detail, client_id: 'risedtc', image_urls: [img] }
    lib.listClientPhotos.mockResolvedValue([{ name: 'b.jpg', url: 'https://x/b.jpg', thumb: 'https://x/b.jpg' }])
    lib.listStills.mockResolvedValue([{ name: 'b.jpg', folder: 'library', url: 'https://x/b.jpg', thumb: 'https://x/b.jpg' }])
    lib.setDraftMedia.mockRejectedValue(new Error('Only a draft at Needs review, Approved or Scheduled can change its picture. Nothing changed.'))
    const refresh = vi.fn()
    renderInFrame(<DraftWindow {...props({ lane: 'risedtc', refresh })} />)
    fireEvent.click(verb('picture-change')!)
    fireEvent.click(await screen.findByLabelText('Look at b.jpg'))
    fireEvent.click(document.querySelector('[data-verb="picture-use"]')!)
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

describe('Arch in the open post keeps every control it had', () => {
  beforeEach(() => { resetDecisionsForTest() })
  it('board off still asks first on Arch, and Delete is offered off the board', async () => {
    current = { ...detail, client_id: 'arch', board_visible: true }
    lib.setBoardVisible.mockResolvedValue(undefined)
    renderInFrame(<DraftWindow {...props({ lane: 'arch' })} />)
    expect(document.querySelector('[data-verb="edit"]')).toBeTruthy()
    fireEvent.click(document.querySelector('[data-verb="board-off"]')!)
    await screen.findByText('Take this off Davorin’s board?')
    expect(lib.setBoardVisible).not.toHaveBeenCalled()
    cleanup()
    current = { ...detail, client_id: 'arch', board_visible: false }
    renderInFrame(<DraftWindow {...props({ lane: 'arch' })} />)
    expect(document.querySelector('[data-verb="delete"]')).toBeTruthy()
  })
})

describe('draft edit protection', () => {
  it('keeps dirty text when closing is cancelled and leaves only after discard', async () => {
    const p = props()
    renderInFrame(<DraftWindow {...p} />)
    fireEvent.click(document.querySelector('[data-verb="edit"]')!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Post text' }), { target: { value: 'Unsaved revised copy' } })
    fireEvent.click(document.querySelector('[data-verb="close"]')!)
    expect(p.onClose).not.toHaveBeenCalled()
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((screen.getByRole('textbox', { name: 'Post text' }) as HTMLTextAreaElement).value).toBe('Unsaved revised copy')
    fireEvent.click(document.querySelector('[data-verb="close"]')!)
    fireEvent.click(await screen.findByRole('button', { name: 'Discard edits' }))
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1))
    expect(lib.saveDraftBody).not.toHaveBeenCalled()
  })

  it('closes an unchanged edit without a discard question', async () => {
    const p = props()
    renderInFrame(<DraftWindow {...p} />)
    fireEvent.click(document.querySelector('[data-verb="edit"]')!)
    fireEvent.click(document.querySelector('[data-verb="close"]')!)
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
