import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { NextRefused, type NextPost } from '../../../lib/contentNext'
import type { FilesRead } from './hash'
import { keepAfterFix, keepShown, type KeepDeps } from './keepFlow'

const sha = (t: string) => createHash('sha256').update(t).digest('hex')
const URL_A = 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/infographics/loop.gif'
const post = (o: Partial<NextPost> = {}): NextPost => ({
  queue_id: 'q1', draft_id: 'd1', slot_at: '2026-11-20T17:30:00Z', state: 'held', origin: 'autopilot', kept: false, fails: ['animated GIF needs a full-frame review'],
  post_text: 'Old text.', post_format: 'text', in_sync: true, urls: [URL_A], media_urls: [URL_A], ...o,
})
const SHOWN = { queue_id: 'q1', slot_at: '2026-11-20T17:30:00Z', post_format: 'text', media_urls: [URL_A] }
const FILES: FilesRead = { status: 'ok', files: [{ url: URL_A, sha256: 'f'.repeat(64), bytes: 4096, blobUrl: 'blob:x', mime: 'image/gif', kind: 'image' }] }
const deps = (reads: (NextPost[] | null)[], keep = vi.fn(async () => {})): KeepDeps & { read: ReturnType<typeof vi.fn>; keep: ReturnType<typeof vi.fn>; wait: ReturnType<typeof vi.fn> } => {
  let i = 0
  return { read: vi.fn(async () => reads[Math.min(i++, reads.length - 1)]), keep, wait: vi.fn(async () => {}) }
}

describe('Keep', () => {
  it('sends the hash of the text the row shows and the files it fetched, not the server hash', async () => {
    const d = deps([])
    const out = await keepShown(post(), 'Old text.', FILES, d)
    expect(out).toEqual({ ok: true, message: 'Kept. It goes out Fri 20 Nov at 18:30.' })
    expect(d.keep).toHaveBeenCalledWith(SHOWN, sha('Old text.'), [{ url: URL_A, sha256: 'f'.repeat(64), bytes: 4096 }])
  })
  it('a post with no attachment sends an empty list', async () => {
    const d = deps([])
    await keepShown(post({ urls: [], media_urls: [] }), 'T', { status: 'ok', files: [] }, d)
    expect(d.keep).toHaveBeenCalledWith({ ...SHOWN, media_urls: [] }, sha('T'), [])
  })
  it('never calls the database while the queue catches up, the files are too large, or they are not the row’s files', async () => {
    const d = deps([])
    expect(await keepShown(post({ in_sync: false }), 'T', FILES, d)).toEqual({ ok: false, message: 'The queue is catching up. Try in a minute.' })
    expect(await keepShown(post(), 'T', { status: 'too_large' }, d)).toEqual({ ok: false, message: 'Too large to check here.' })
    expect(await keepShown(post(), 'T', { status: 'failed' }, d)).toEqual({ ok: false, message: 'Too large to check here.' })
    expect(await keepShown(post(), 'T', null, d)).toEqual({ ok: false, message: 'Too large to check here.' })
    expect((await keepShown(post({ urls: [URL_A, `${URL_A}2`] }), 'T', FILES, d)).ok).toBe(false)
    expect(d.keep).not.toHaveBeenCalled()
  })
  it('sends the attachment order as shown, and hashes every file of urls', async () => {
    const B = `${URL_A}.poster.png`
    const two: FilesRead = { status: 'ok', files: [{ ...FILES.files[0], url: B, sha256: 'b'.repeat(64), bytes: 10 }, FILES.files[0]] as never }
    const d = deps([])
    // urls is the sorted set; media_urls is the posting order
    await keepShown(post({ urls: [B, URL_A], media_urls: [URL_A] }), 'T', two, d)
    expect(d.keep).toHaveBeenCalledWith({ ...SHOWN, media_urls: [URL_A] }, sha('T'), [{ url: B, sha256: 'b'.repeat(64), bytes: 10 }, { url: URL_A, sha256: 'f'.repeat(64), bytes: 4096 }])
  })
  it('sends the slot and format exactly as the read returned them', async () => {
    const d = deps([])
    await keepShown(post({ slot_at: '2026-11-20T18:30:00+01:00', post_format: null }), 'T', FILES, d)
    expect(d.keep.mock.calls[0][0]).toEqual({ queue_id: 'q1', slot_at: '2026-11-20T18:30:00+01:00', post_format: null, media_urls: [URL_A] })
  })
  it('a re-dated post is refused in the database’s words, with the code that reloads the row', async () => {
    const d = deps([], vi.fn(async () => { throw new NextRefused('Not kept: its time changed. Look at it again.', 'next_changed') }))
    expect(await keepShown(post(), 'T', FILES, d)).toEqual({ ok: false, message: 'Not kept: its time changed. Look at it again.', code: 'next_changed' })
  })
  it('shows the database’s refusal as it is', async () => {
    const d = deps([], vi.fn(async () => { throw new NextRefused('This post changed. Reload the row and look again.', 'next_changed') }))
    expect(await keepShown(post(), 'T', FILES, d)).toEqual({ ok: false, message: 'This post changed. Reload the row and look again.', code: 'next_changed' })
  })
})

describe('Fix, then Keep for him', () => {
  it('waits until the queued copy carries his text, then keeps his text with the files on screen', async () => {
    const d = deps([[post({ in_sync: false })], [post({ in_sync: false })], [post({ post_text: 'New text.', in_sync: true })]])
    const out = await keepAfterFix(post(), 'New text.', FILES, d)
    expect(out).toEqual({ ok: true, message: 'Saved. It goes out with your text.' })
    expect(d.wait).toHaveBeenCalledTimes(2)
    expect(d.keep).toHaveBeenCalledTimes(1)
    // slot, format and attachment order are the ones of the row he saved from
    expect(d.keep).toHaveBeenCalledWith(SHOWN, sha('New text.'), [{ url: URL_A, sha256: 'f'.repeat(64), bytes: 4096 }])
    // three reads to get in step, one after the keep so the row shows the new state
    expect(d.read).toHaveBeenCalledTimes(4)
  })
  it('hashes the stored text the row will show when the database tidied his typing', async () => {
    const d = deps([[post({ post_text: 'New text.', in_sync: true })]])
    await keepAfterFix(post(), 'New text.\r\n ', FILES, d)
    expect(d.keep).toHaveBeenCalledWith(SHOWN, sha('New text.'), expect.any(Array))
  })
  it('in step but still the old text is not his edit yet: it keeps waiting', async () => {
    const d = deps([[post({ in_sync: true })]])
    const out = await keepAfterFix(post(), 'New text.', FILES, d, 3, 1)
    expect(out).toEqual({ ok: false, message: 'Saved. The queue is catching up. Tap Keep in a minute.' })
    expect(d.read).toHaveBeenCalledTimes(3)
    expect(d.keep).not.toHaveBeenCalled()
  })
  it('gives up after a few tries and leaves Keep to him', async () => {
    const d = deps([[post({ in_sync: false })]])
    const out = await keepAfterFix(post(), 'New text.', FILES, d, 4, 1)
    expect(out.ok).toBe(false)
    expect(out.message).toBe('Saved. The queue is catching up. Tap Keep in a minute.')
    expect(d.wait).toHaveBeenCalledTimes(3)
    expect(d.keep).not.toHaveBeenCalled()
  })
  it('a failed read is one lost try, never a keep', async () => {
    const d = deps([null, [post({ post_text: 'New text.', in_sync: true })]])
    expect((await keepAfterFix(post(), 'New text.', FILES, d)).ok).toBe(true)
    expect(d.keep).toHaveBeenCalledTimes(1)
  })
  it('a refused keep shows the message and the row stays for his own Keep', async () => {
    const d = deps([[post({ post_text: 'New text.', in_sync: true })]], vi.fn(async () => { throw new NextRefused('Another change is being saved. Try again.', 'next_busy') }))
    expect(await keepAfterFix(post(), 'New text.', FILES, d)).toEqual({ ok: false, message: 'Saved. Another change is being saved. Try again.', code: 'next_busy' })
  })
  it('does not keep a post whose time, format or attachment order changed while he edited', async () => {
    for (const [o, msg] of [
      [{ slot_at: '2026-11-21T17:30:00Z' }, 'Saved. Its time or format changed. Look at it, then tap Keep.'],
      [{ post_format: 'image' }, 'Saved. Its time or format changed. Look at it, then tap Keep.'],
      [{ media_urls: [] }, 'Saved. The attachment changed. Look at it, then tap Keep.'],
    ] as [Partial<NextPost>, string][]) {
      const d = deps([[post({ post_text: 'New text.', in_sync: true, ...o })]])
      expect(await keepAfterFix(post(), 'New text.', FILES, d)).toEqual({ ok: false, message: msg })
      expect(d.keep).not.toHaveBeenCalled()
    }
  })
  it('does not keep an attachment he has not looked at', async () => {
    const d = deps([[post({ post_text: 'New text.', in_sync: true, urls: [`${URL_A}?v=2`], media_urls: [`${URL_A}?v=2`] })]])
    const out = await keepAfterFix(post(), 'New text.', FILES, d)
    expect(out).toEqual({ ok: false, message: 'Saved. The attachment changed. Look at it, then tap Keep.' })
    expect(d.keep).not.toHaveBeenCalled()
  })
  it('the post left the schedule meanwhile', async () => {
    const d = deps([[]])
    expect(await keepAfterFix(post(), 'New text.', FILES, d)).toEqual({ ok: false, message: 'Saved. It is no longer on the schedule.' })
    expect(d.keep).not.toHaveBeenCalled()
  })
  it('his own post needs no keep: one re-read', async () => {
    const d = deps([[post({ origin: 'own' })]])
    expect(await keepAfterFix(post({ origin: 'own' }), 'New text.', FILES, d)).toEqual({ ok: true, message: 'Saved.' })
    expect(d.read).toHaveBeenCalledTimes(1)
    expect(d.keep).not.toHaveBeenCalled()
  })
})
