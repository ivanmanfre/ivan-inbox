import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))
vi.mock('./contentNext', async orig => await orig<typeof import('./contentNext')>())

import { NextRefused, keepNext, readNextPosts } from './contentNext'

beforeEach(() => { rpc.mockReset() })
const raw = (o: Record<string, unknown> = {}) => ({ queue_id: 'q', draft_id: 'd', slot_at: '2026-11-20T17:30:00+00:00', state: 'held', origin: 'autopilot', kept: false, fails: ['animated GIF needs a full-frame review'], post_text: 'T', post_format: 'text', in_sync: true, body_sha256: 'x', urls: [], ...o })

describe('content_next_posts', () => {
  it('returns the rows soonest first and keeps slot_at as the database wrote it', async () => {
    rpc.mockResolvedValue({ data: [raw({ queue_id: 'b', slot_at: '2026-11-25T12:00:00+00:00' }), raw({ queue_id: 'a' }), { junk: true }], error: null })
    const posts = await readNextPosts()
    expect(rpc).toHaveBeenCalledWith('content_next_posts')
    expect(posts.map(p => [p.queue_id, p.slot_at])).toEqual([['a', '2026-11-20T17:30:00+00:00'], ['b', '2026-11-25T12:00:00+00:00']])
  })
  it('keeps media_urls in the order the database gave, apart from urls', async () => {
    rpc.mockResolvedValue({ data: [raw({ urls: ['a', 'b'], media_urls: ['b', 'a'] })], error: null })
    expect((await readNextPosts())[0]).toMatchObject({ urls: ['a', 'b'], media_urls: ['b', 'a'] })
  })
  it('null is no posts; a failed or malformed read throws (never "nothing is going out")', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await readNextPosts()).toEqual([])
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    await expect(readNextPosts()).rejects.toThrow('permission denied')
    rpc.mockResolvedValue({ data: { not: 'a list' }, error: null })
    await expect(readNextPosts()).rejects.toThrow('malformed')
  })
})

describe('content_next_keep', () => {
  it('sends the queue row, the slot, format and attachment order as shown, the text hash and the files', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await keepNext({ queue_id: 'q', slot_at: '2026-11-20T17:30:00+00:00', post_format: 'text', media_urls: ['m2', 'm1'] }, 'ab12', [{ url: 'u', sha256: 'cd', bytes: 9, blobUrl: 'blob:x' } as never])
    expect(rpc).toHaveBeenCalledWith('content_next_keep', { p_queue: 'q', p_slot_at: '2026-11-20T17:30:00+00:00', p_body_sha: 'ab12', p_post_format: 'text', p_media_urls: ['m2', 'm1'], p_files: [{ url: 'u', sha256: 'cd', bytes: 9 }] })
    await keepNext({ queue_id: 'q', slot_at: 's', post_format: null, media_urls: [] }, 'h', [])
    expect(rpc).toHaveBeenLastCalledWith('content_next_keep', { p_queue: 'q', p_slot_at: 's', p_body_sha: 'h', p_post_format: null, p_media_urls: [], p_files: [] })
  })
  it('a refusal keeps the database’s message and its code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Not kept: its time changed. Look at it again.', hint: 'next_changed' } })
    const e = await keepNext({ queue_id: 'q', slot_at: 's', post_format: null, media_urls: [] }, 'h', []).catch(x => x)
    expect(e).toBeInstanceOf(NextRefused)
    expect([e.message, e.code]).toEqual(['Not kept: its time changed. Look at it again.', 'next_changed'])
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const plain = await keepNext({ queue_id: 'q', slot_at: 's', post_format: null, media_urls: [] }, 'h', []).catch(x => x)
    expect(plain).not.toBeInstanceOf(NextRefused)
    expect(plain.message).toBe('boom')
  })
})
