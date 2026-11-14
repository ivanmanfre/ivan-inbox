// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ContentDraft } from '../../../lib/content'
import type { NextPost } from '../../../lib/contentNext'
import { ToastProvider } from '../../ui/toast'
import { DConfirmProvider } from '../../ui/confirm'
import type { FilesRead } from './hash'

// The Next and Held rows over Ivan's Review list. The database calls and the attachment fetch are stubbed; what is
// checked is what the row says, which keys it offers, and exactly what a Keep and a Fix send.
const lib = vi.hoisted(() => ({ readNextPosts: vi.fn(), keepNext: vi.fn(), pullNext: vi.fn(), saveDraftBody: vi.fn(), loadFiles: vi.fn(), sha: vi.fn(async (t: string) => `sha(${t})`) }))
vi.mock('../../../lib/contentNext', async orig => ({ ...(await orig<typeof import('../../../lib/contentNext')>()), readNextPosts: lib.readNextPosts, keepNext: lib.keepNext, pullNext: lib.pullNext }))
vi.mock('../../../lib/content', async orig => ({ ...(await orig<typeof import('../../../lib/content')>()), saveDraftBody: lib.saveDraftBody }))
vi.mock('./hash', async orig => ({ ...(await orig<typeof import('./hash')>()), loadFiles: lib.loadFiles, sha256OfText: lib.sha, releaseFiles: vi.fn() }))
vi.mock('./keepFlow', async orig => {
  const real = await orig<typeof import('./keepFlow')>()
  // No real waiting between the Fix re-reads.
  return { ...real, keepAfterFix: (p: NextPost, t: string, f: FilesRead | null, d: import('./keepFlow').KeepDeps) => real.keepAfterFix(p, t, f, { ...d, wait: async () => {} }) }
})

import { NextRows } from './NextRows'
import { resetNextPostsForTest } from './store'

const GIF = 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/infographics/ivan/loop.gif'
const post = (o: Partial<NextPost> = {}): NextPost => ({
  queue_id: 'q1', draft_id: 'd1', slot_at: '2026-11-16T13:00:00+00:00', state: 'ready', origin: 'own', kept: false, fails: [],
  post_text: 'First hook.\n\nBody one.', post_format: 'text', in_sync: true, urls: [], media_urls: [], ...o,
})
const held = (o: Partial<NextPost> = {}) => post({ queue_id: 'q2', draft_id: 'd2', slot_at: '2026-11-20T17:30:00+00:00', state: 'held', origin: 'autopilot',
  fails: ['animated GIF needs a full-frame review'], post_text: 'Loop hook.\n\nBody two.', urls: [GIF], media_urls: [GIF], ...o })
const draft = (id: string, body: string) => ({ id, client_id: null, status: 'scheduled', type: 'text', title: '', post_body: body, taxonomy: null, image_urls: null,
  created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-10T09:00:00Z', scheduled_at: '2026-11-20T17:30:00Z', published_at: null }) as unknown as ContentDraft
const FILES: FilesRead = { status: 'ok', files: [{ url: GIF, sha256: 'a'.repeat(64), bytes: 2_000_000, blobUrl: 'blob:loop', mime: 'image/gif', kind: 'image' }] }

const row = (id: string) => document.querySelector(`[data-next-id="${id}"]`) as HTMLElement | null
const key = (id: string, verb: string) => row(id)?.querySelector(`[data-verb="${verb}"]`) as HTMLButtonElement | null
const calls = { open: vi.fn(), edit: vi.fn(), changed: vi.fn() }
const mount = (rows: ContentDraft[] = [draft('d1', 'First hook.\n\nBody one.'), draft('d2', 'Loop hook.\n\nBody two.')]) =>
  render(<DConfirmProvider><ToastProvider><NextRows rows={rows} onOpen={calls.open} onEdit={calls.edit} onChanged={calls.changed} /></ToastProvider></DConfirmProvider>)

beforeEach(() => {
  for (const f of Object.values(lib)) f.mockReset()
  for (const f of Object.values(calls)) f.mockReset()
  lib.sha.mockImplementation(async (t: string) => `sha(${t})`)
  lib.loadFiles.mockResolvedValue(FILES)
  lib.keepNext.mockResolvedValue(undefined)
  lib.pullNext.mockResolvedValue(undefined)
  lib.saveDraftBody.mockResolvedValue(undefined)
  resetNextPostsForTest()
})
afterEach(() => { cleanup() })

describe('the rows', () => {
  it('nothing upcoming: nothing is drawn', async () => {
    lib.readNextPosts.mockResolvedValue([])
    mount()
    await waitFor(() => expect(lib.readNextPosts).toHaveBeenCalled())
    expect(document.querySelector('[data-next-list]')).toBeNull()
  })
  it('the next post first, then every later held post; later posts that are fine are not listed', async () => {
    lib.readNextPosts.mockResolvedValue([post(), post({ queue_id: 'q9', slot_at: '2026-11-17T14:30:00+00:00' }), held(), held({ queue_id: 'q3', draft_id: 'd3', slot_at: '2026-11-25T12:00:00+00:00' })])
    mount()
    await waitFor(() => expect(row('q1')).toBeTruthy())
    const rows = [...document.querySelectorAll<HTMLElement>('[data-next-id]')]
    expect(rows.map(r => [r.dataset.nextId, r.dataset.nextTag])).toEqual([['q1', 'Next'], ['q2', 'Held'], ['q3', 'Held']])
    expect(row('q1')!.querySelector('.cv2-next-tag')!.textContent).toBe('Next')
    expect(row('q1')!.querySelector('.cv2-next-when')!.textContent).toBe('Mon 16 Nov · 14:00')
    expect(row('q2')!.querySelector('.cv2-next-when')!.textContent).toBe('Fri 20 Nov · 18:30')
    // the preview is open: the queued text reads without a tap
    expect(row('q1')!.querySelector('.cv2-li-b')!.textContent).toContain('Body one.')
  })
  it('status lines', async () => {
    lib.readNextPosts.mockResolvedValue([post(), held()])
    mount()
    await waitFor(() => expect(row('q2')).toBeTruthy())
    expect(row('q1')!.querySelector('[data-next-status]')!.textContent).toBe('Goes out Mon 16 Nov at 14:00. You placed it.')
    expect(row('q2')!.querySelector('[data-next-status]')!.textContent).toBe('Will not go out as it stands. The loop needs your look. The automatic check only sees its first frame.')
  })
  it('his own post has Fix and no Keep; a held autopilot post has Keep as the main key', async () => {
    lib.readNextPosts.mockResolvedValue([post(), held()])
    mount()
    await waitFor(() => expect(key('q2', 'next-keep')?.disabled).toBe(false))
    expect(key('q1', 'next-keep')).toBeNull()
    expect(key('q1', 'next-fix')).toBeTruthy()
    expect(key('q2', 'next-keep')!.className).toContain('cv2-k-p')
    expect(key('q1', 'next-pull')!.className).toContain('cv2-k-q')
  })
  it('a ready autopilot post: Keep is quiet; once kept, it is gone', async () => {
    lib.readNextPosts.mockResolvedValue([post({ origin: 'autopilot' })])
    const m = mount()
    await waitFor(() => expect(key('q1', 'next-keep')).toBeTruthy())
    expect(key('q1', 'next-keep')!.className).toContain('cv2-k-q')
    expect(row('q1')!.querySelector('[data-next-status]')!.textContent).toBe('Goes out Mon 16 Nov at 14:00. Checked by the autopilot.')
    m.unmount(); resetNextPostsForTest()
    lib.readNextPosts.mockResolvedValue([post({ origin: 'autopilot', kept: true })])
    mount()
    await waitFor(() => expect(row('q1')).toBeTruthy())
    expect(key('q1', 'next-keep')).toBeNull()
    expect(row('q1')!.querySelector('[data-next-status]')!.textContent).toBe('Goes out Mon 16 Nov at 14:00. You kept it.')
  })
  it('the attachment on screen is the fetched bytes (the blob), fetched once', async () => {
    lib.readNextPosts.mockResolvedValue([held()])
    mount()
    await waitFor(() => expect(row('q2')!.querySelector('.cv2-li-m img')?.getAttribute('src')).toBe('blob:loop'))
    expect(lib.loadFiles).toHaveBeenCalledTimes(1)
    expect(lib.loadFiles.mock.calls[0][0]).toEqual([GIF])
  })
})

describe('attachment order', () => {
  it('shows the files in posting order (media_urls), whatever order they were hashed in', async () => {
    const A = GIF.replace('loop.gif', 'a.png'), B = GIF.replace('loop.gif', 'b.png')
    const f = (url: string, blobUrl: string) => ({ url, sha256: 'c'.repeat(64), bytes: 10, blobUrl, mime: 'image/png', kind: 'image' as const })
    lib.loadFiles.mockResolvedValue({ status: 'ok', files: [f(A, 'blob:a'), f(B, 'blob:b')] })
    lib.readNextPosts.mockResolvedValue([held({ urls: [A, B], media_urls: [B, A] })])
    mount()
    await waitFor(() => expect(row('q2')!.querySelectorAll('.cv2-li-grid img').length).toBe(2))
    expect([...row('q2')!.querySelectorAll('.cv2-li-grid img')].map(i => i.getAttribute('src'))).toEqual(['blob:b', 'blob:a'])
    expect(lib.loadFiles.mock.calls[0][0]).toEqual([A, B])
  })
})

describe('Keep', () => {
  it('a tap sends the row on screen, even when a newer read lands inside the tap', async () => {
    lib.readNextPosts.mockResolvedValue([held()])
    mount()
    await waitFor(() => expect(key('q2', 'next-keep')?.disabled).toBe(false))
    // the list changes underneath (re-dated): the keep still carries what he was looking at, and the database decides
    lib.readNextPosts.mockResolvedValue([held({ slot_at: '2026-11-21T17:30:00+00:00' })])
    await act(async () => { fireEvent.click(key('q2', 'next-keep')!) })
    await waitFor(() => expect(lib.keepNext).toHaveBeenCalledTimes(1))
    expect(lib.keepNext.mock.calls[0][0]).toEqual({ queue_id: 'q2', slot_at: '2026-11-20T17:30:00+00:00', post_format: 'text', media_urls: [GIF] })
  })
  it('sends the row’s slot as read, the hash of the text shown and the files shown, then re-reads', async () => {
    lib.readNextPosts.mockResolvedValue([held()])
    mount()
    await waitFor(() => expect(key('q2', 'next-keep')?.disabled).toBe(false))
    lib.readNextPosts.mockResolvedValue([held({ state: 'ready', kept: true, fails: [] })])
    await act(async () => { fireEvent.click(key('q2', 'next-keep')!) })
    await waitFor(() => expect(lib.keepNext).toHaveBeenCalledTimes(1))
    expect(lib.keepNext).toHaveBeenCalledWith({ queue_id: 'q2', slot_at: '2026-11-20T17:30:00+00:00', post_format: 'text', media_urls: [GIF] }, 'sha(Loop hook.\n\nBody two.)', [{ url: GIF, sha256: 'a'.repeat(64), bytes: 2_000_000 }])
    await waitFor(() => expect(row('q2')!.querySelector('[data-next-status]')!.textContent).toBe('Goes out Fri 20 Nov at 18:30. You kept it.'))
    expect(key('q2', 'next-keep')).toBeNull()
    expect(document.querySelector('.d-toasts')!.textContent).toContain('Kept. It goes out Fri 20 Nov at 18:30.')
  })
  it('waits with a note while the queue catches up', async () => {
    lib.readNextPosts.mockResolvedValue([held({ in_sync: false })])
    mount()
    await waitFor(() => expect(row('q2')).toBeTruthy())
    expect(key('q2', 'next-keep')!.disabled).toBe(true)
    expect(row('q2')!.querySelector('[data-next-note]')!.textContent).toBe('The queue is catching up. Try in a minute.')
  })
  it('waits with a note when the files are too large or did not arrive', async () => {
    lib.loadFiles.mockResolvedValue({ status: 'too_large' })
    lib.readNextPosts.mockResolvedValue([held()])
    mount()
    await waitFor(() => expect(row('q2')!.querySelector('[data-next-note]')?.textContent).toBe('Too large to check here.'))
    expect(key('q2', 'next-keep')!.disabled).toBe(true)
    fireEvent.click(key('q2', 'next-keep')!)
    expect(lib.keepNext).not.toHaveBeenCalled()
  })
  it('a refusal shows the database’s message as it is, re-reads, and leaves Keep there', async () => {
    const { NextRefused } = await import('../../../lib/contentNext')
    lib.readNextPosts.mockResolvedValue([held()])
    mount()
    await waitFor(() => expect(key('q2', 'next-keep')?.disabled).toBe(false))
    lib.keepNext.mockRejectedValue(new NextRefused('Not kept: its time changed. Look at it again.', 'next_changed'))
    const reads = lib.readNextPosts.mock.calls.length
    await act(async () => { fireEvent.click(key('q2', 'next-keep')!) })
    await waitFor(() => expect(row('q2')!.querySelector('[data-next-note]')?.textContent).toBe('Not kept: its time changed. Look at it again.'))
    expect(row('q2')!.querySelector('[data-next-note]')!.getAttribute('role')).toBe('alert')
    expect(lib.readNextPosts.mock.calls.length).toBeGreaterThan(reads)
    // the row and its attachment are read again, past the cached copy
    await waitFor(() => expect(lib.loadFiles.mock.calls.at(-1)![1]).toMatchObject({ fresh: true }))
    expect(key('q2', 'next-keep')).toBeTruthy()
  })
})

describe('Fix', () => {
  const type = (id: string, text: string) => fireEvent.change(row(id)!.querySelector('textarea')!, { target: { value: text } })
  it('opens the row’s in-place edit on the draft’s text; Keep waits while it is open', async () => {
    lib.readNextPosts.mockResolvedValue([held()])
    mount()
    await waitFor(() => expect(key('q2', 'next-keep')?.disabled).toBe(false))
    fireEvent.click(key('q2', 'next-fix')!)
    expect((row('q2')!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Loop hook.\n\nBody two.')
    expect(key('q2', 'next-keep')!.disabled).toBe(true)
    type('q2', 'Loop hook.\n\nBetter body.')
    expect(row('q2')!.dataset.unsaved).toBe('true')
    fireEvent.click(row('q2')!.querySelector('[data-verb="grid-cancel"]')!)
    expect(row('q2')!.querySelector('textarea')).toBeNull()
    expect(lib.saveDraftBody).not.toHaveBeenCalled()
  })
  it('saves through the Review rows’ save, waits for the queue, then keeps his text for him', async () => {
    lib.readNextPosts.mockResolvedValue([held()])
    mount()
    await waitFor(() => expect(key('q2', 'next-keep')?.disabled).toBe(false))
    fireEvent.click(key('q2', 'next-fix')!)
    type('q2', 'Loop hook.\n\nBetter body.')
    lib.readNextPosts.mockReset()
    lib.readNextPosts
      .mockResolvedValueOnce([held({ in_sync: false })])
      .mockResolvedValueOnce([held({ post_text: 'Loop hook.\n\nBetter body.', in_sync: true })])
      .mockResolvedValue([held({ post_text: 'Loop hook.\n\nBetter body.', state: 'ready', kept: true, fails: [] })])
    await act(async () => { fireEvent.click(row('q2')!.querySelector('[data-verb="grid-save"]')!) })
    await waitFor(() => expect(lib.keepNext).toHaveBeenCalledTimes(1))
    // the same save path as the Review rows: compare-and-swap on the draft's body
    expect(lib.saveDraftBody).toHaveBeenCalledWith('d2', 'Loop hook.\n\nBetter body.', null, 'Loop hook.\n\nBody two.', '2026-11-10T09:00:00Z')
    expect(lib.keepNext).toHaveBeenCalledWith({ queue_id: 'q2', slot_at: '2026-11-20T17:30:00+00:00', post_format: 'text', media_urls: [GIF] }, 'sha(Loop hook.\n\nBetter body.)', [{ url: GIF, sha256: 'a'.repeat(64), bytes: 2_000_000 }])
    await waitFor(() => expect(document.querySelector('.d-toasts')!.textContent).toContain('Saved. It goes out with your text.'))
    expect(calls.changed).toHaveBeenCalled()
    await waitFor(() => expect(row('q2')!.querySelector('[data-next-status]')!.textContent).toBe('Goes out Fri 20 Nov at 18:30. You kept it.'))
  })
  it('a keep that fails after the save shows the message and leaves the row held with Keep', async () => {
    const { NextRefused } = await import('../../../lib/contentNext')
    lib.readNextPosts.mockResolvedValue([held()])
    mount()
    await waitFor(() => expect(key('q2', 'next-keep')?.disabled).toBe(false))
    fireEvent.click(key('q2', 'next-fix')!)
    type('q2', 'Loop hook.\n\nBetter body.')
    lib.readNextPosts.mockResolvedValue([held({ post_text: 'Loop hook.\n\nBetter body.', in_sync: true })])
    lib.keepNext.mockRejectedValue(new NextRefused('Another change is being saved. Try again.', 'next_busy'))
    await act(async () => { fireEvent.click(row('q2')!.querySelector('[data-verb="grid-save"]')!) })
    await waitFor(() => expect(row('q2')!.querySelector('[data-next-note]')?.textContent).toBe('Saved. Another change is being saved. Try again.'))
    expect(row('q2')!.dataset.nextState).toBe('held')
    await waitFor(() => expect(key('q2', 'next-keep')?.disabled).toBe(false))
  })
  it('his own post: the save alone, no keep', async () => {
    lib.readNextPosts.mockResolvedValue([post()])
    mount()
    await waitFor(() => expect(key('q1', 'next-fix')).toBeTruthy())
    fireEvent.click(key('q1', 'next-fix')!)
    type('q1', 'First hook.\n\nNew body.')
    await act(async () => { fireEvent.click(row('q1')!.querySelector('[data-verb="grid-save"]')!) })
    await waitFor(() => expect(lib.saveDraftBody).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(key('q1', 'next-fix')!.textContent).toBe('Fix'))
    expect(lib.keepNext).not.toHaveBeenCalled()
  })
  it('a draft the page does not hold opens the post’s own editor', async () => {
    lib.readNextPosts.mockResolvedValue([held()])
    mount([])
    await waitFor(() => expect(key('q2', 'next-fix')).toBeTruthy())
    fireEvent.click(key('q2', 'next-fix')!)
    expect(calls.edit).toHaveBeenCalledWith('d2', 'ivan')
    expect(row('q2')!.querySelector('textarea')).toBeNull()
  })
})

describe('Pull', () => {
  const confirmKey = () => document.querySelector('[data-verb="next-pull-confirm"]') as HTMLButtonElement | null
  it('every row has Pull, after Fix', async () => {
    lib.readNextPosts.mockResolvedValue([post(), held()])
    mount()
    await waitFor(() => expect(key('q2', 'next-pull')).toBeTruthy())
    for (const id of ['q1', 'q2']) {
      const verbs = [...row(id)!.querySelectorAll('.cv2-row-keys [data-verb]')].map(b => b.getAttribute('data-verb'))
      expect(verbs.indexOf('next-pull')).toBe(verbs.indexOf('next-fix') + 1)
    }
  })
  it('asks once, then sends the row and the slot it showed, re-reads and says it is back in Review', async () => {
    lib.readNextPosts.mockResolvedValue([post()])
    mount()
    await waitFor(() => expect(key('q1', 'next-pull')).toBeTruthy())
    fireEvent.click(key('q1', 'next-pull')!)
    await waitFor(() => expect(confirmKey()).toBeTruthy())
    expect(document.body.textContent).toContain('It will not go out Mon 16 Nov at 14:00.')
    expect(lib.pullNext).not.toHaveBeenCalled()
    lib.readNextPosts.mockResolvedValue([])
    await act(async () => { fireEvent.click(confirmKey()!) })
    await waitFor(() => expect(lib.pullNext).toHaveBeenCalledTimes(1))
    expect(lib.pullNext.mock.calls[0][0]).toMatchObject({ queue_id: 'q1', slot_at: '2026-11-16T13:00:00+00:00' })
    await waitFor(() => expect(document.body.textContent).toContain('Pulled. It will not go out.'))
    expect(calls.changed).toHaveBeenCalled()
  })
  it('cancel sends nothing', async () => {
    lib.readNextPosts.mockResolvedValue([post()])
    mount()
    await waitFor(() => expect(key('q1', 'next-pull')).toBeTruthy())
    fireEvent.click(key('q1', 'next-pull')!)
    await waitFor(() => expect(confirmKey()).toBeTruthy())
    const cancel = [...document.querySelectorAll('button')].find(b => /cancel/i.test(b.textContent ?? ''))!
    await act(async () => { fireEvent.click(cancel) })
    expect(lib.pullNext).not.toHaveBeenCalled()
  })
  it('a refusal shows the database’s message as it is and the row stays', async () => {
    const { NextRefused } = await import('../../../lib/contentNext')
    lib.readNextPosts.mockResolvedValue([post()])
    lib.pullNext.mockRejectedValue(new NextRefused('Not pulled: it is being published right now.', 'next_busy'))
    mount()
    await waitFor(() => expect(key('q1', 'next-pull')).toBeTruthy())
    fireEvent.click(key('q1', 'next-pull')!)
    await waitFor(() => expect(confirmKey()).toBeTruthy())
    await act(async () => { fireEvent.click(confirmKey()!) })
    await waitFor(() => expect(row('q1')!.querySelector('[data-next-note]')!.textContent).toBe('Not pulled: it is being published right now.'))
    expect(calls.changed).not.toHaveBeenCalled()
    expect(key('q1', 'next-pull')!.disabled).toBe(false)
  })
})
