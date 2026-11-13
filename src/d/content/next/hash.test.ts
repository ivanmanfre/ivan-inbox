import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { MAX_BYTES, MAX_FILES, STORAGE_PREFIX, keepFilesOf, kindOf, loadFiles, mimeOf, releaseFiles, sha256OfBytes, sha256OfText } from './hash'

const nodeSha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')
const u = (name: string) => `${STORAGE_PREFIX}bucket/${name}`
const res = (bytes: Uint8Array, headers: Record<string, string> = {}, ok = true) => ({
  ok, status: ok ? 200 : 404, headers: new Headers(headers), body: null,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
}) as unknown as Response

let made: string[] = []
let revoked: string[] = []
beforeEach(() => {
  made = []; revoked = []
  URL.createObjectURL = vi.fn(() => { const id = `blob:test/${made.length}`; made.push(id); return id })
  URL.revokeObjectURL = vi.fn((id: string) => { revoked.push(id) })
})
afterEach(() => { vi.restoreAllMocks() })

describe('text and byte hashes', () => {
  it('hashes the UTF-8 bytes of the text exactly as given', async () => {
    expect(await sha256OfText('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256OfText('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const text = 'Kraków, zażółć gęślą jaźń 🙂\n\nSecond line. '
    expect(await sha256OfText(text)).toBe(nodeSha(text))
    // No trimming: the trailing space is part of what the database stored.
    expect(await sha256OfText(text)).not.toBe(await sha256OfText(text.trim()))
  })
  it('hashes bytes', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    expect(await sha256OfBytes(bytes.buffer)).toBe(nodeSha(bytes))
  })
})

describe('file type', () => {
  it('reads the server type first, then the extension', () => {
    expect(mimeOf(u('a.gif'), 'image/gif')).toBe('image/gif')
    expect(mimeOf(u('a.gif?x=1'), 'application/octet-stream')).toBe('image/gif')
    expect(mimeOf(u('a.MP4'), null)).toBe('video/mp4')
    expect(mimeOf(u('deck.pdf'), 'application/pdf; charset=binary')).toBe('application/pdf')
    expect(mimeOf(u('thing'), null)).toBe('application/octet-stream')
    expect([kindOf('image/gif'), kindOf('video/mp4'), kindOf('application/pdf'), kindOf('text/plain')]).toEqual(['image', 'video', 'pdf', 'other'])
  })
})

describe('loadFiles', () => {
  it('fetches each file once and shows the very bytes it hashed', async () => {
    const a = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 2, 3]), b = new Uint8Array(2048).fill(7)
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('a.gif') ? res(a, { 'content-type': 'image/gif' }) : res(b, { 'content-type': 'image/png' }))
    const blobs: Blob[] = []
    ;(URL.createObjectURL as ReturnType<typeof vi.fn>).mockImplementation((blob: Blob) => { blobs.push(blob); const id = `blob:test/${made.length}`; made.push(id); return id })
    const read = await loadFiles([u('a.gif'), u('b.png')], { fetcher: fetcher as unknown as typeof fetch })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: 'default' })
    if (read.status !== 'ok') throw new Error('expected ok')
    expect(read.files.map(f => [f.url, f.sha256, f.bytes, f.kind, f.blobUrl])).toEqual([
      [u('a.gif'), nodeSha(a), 9, 'image', 'blob:test/0'], [u('b.png'), nodeSha(b), 2048, 'image', 'blob:test/1']])
    // The blob on screen is the hashed bytes, typed so a GIF plays.
    expect(blobs[0].size).toBe(9); expect(blobs[0].type).toBe('image/gif')
    expect(nodeSha(new Uint8Array(await blobs[0].arrayBuffer()))).toBe(read.files[0].sha256)
    expect(keepFilesOf(read.files)).toEqual([{ url: u('a.gif'), sha256: nodeSha(a), bytes: 9 }, { url: u('b.png'), sha256: nodeSha(b), bytes: 2048 }])
    releaseFiles(read)
    expect(revoked).toEqual(['blob:test/0', 'blob:test/1'])
  })
  it('no attachments is an empty, good read', async () => {
    const fetcher = vi.fn()
    expect(await loadFiles([], { fetcher: fetcher as unknown as typeof fetch })).toEqual({ status: 'ok', files: [] })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('skips the cached copy when asked for a fresh read', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => res(new Uint8Array([1])))
    await loadFiles([u('a.png')], { fresh: true, fetcher: fetcher as unknown as typeof fetch })
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: 'reload' })
  })
  it('refuses more files than the database checks, without fetching', async () => {
    const fetcher = vi.fn()
    const urls = Array.from({ length: MAX_FILES + 1 }, (_, i) => u(`${i}.png`))
    expect(await loadFiles(urls, { fetcher: fetcher as unknown as typeof fetch })).toEqual({ status: 'too_large' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('refuses an address outside public storage, without fetching', async () => {
    const fetcher = vi.fn()
    expect(await loadFiles(['https://example.com/a.png'], { fetcher: fetcher as unknown as typeof fetch })).toEqual({ status: 'failed' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('stops at 13 MB by the size the server says, before pulling the bytes', async () => {
    const pulled = vi.fn(async () => new ArrayBuffer(1))
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': String(MAX_BYTES + 1) }), body: null, arrayBuffer: pulled }) as unknown as Response)
    expect(await loadFiles([u('big.mp4')], { fetcher: fetcher as unknown as typeof fetch })).toEqual({ status: 'too_large' })
    expect(pulled).not.toHaveBeenCalled()
  })
  it('stops at 13 MB in total and lets go of what it already made', async () => {
    const half = new Uint8Array(MAX_BYTES / 2 + 1)
    const fetcher = vi.fn(async () => res(half))
    expect(await loadFiles([u('a.gif'), u('b.gif')], { fetcher: fetcher as unknown as typeof fetch })).toEqual({ status: 'too_large' })
    expect(revoked).toEqual(['blob:test/0'])
  })
  it('a file that does not arrive is a failed read, never a partial one', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('a.png') ? res(new Uint8Array([1])) : res(new Uint8Array(), {}, false))
    expect(await loadFiles([u('a.png'), u('gone.png')], { fetcher: fetcher as unknown as typeof fetch })).toEqual({ status: 'failed' })
    expect(revoked).toEqual(['blob:test/0'])
    const down = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await loadFiles([u('a.png')], { fetcher: down as unknown as typeof fetch })).toEqual({ status: 'failed' })
  })
})
