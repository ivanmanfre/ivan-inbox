import type { KeepFile } from '../../../lib/contentNext'

// WHAT KEEP STANDS ON. The text hash is taken from the text the row shows. Every attachment is fetched ONCE: the same
// bytes are hashed, counted and shown (through a blob URL), so what he looked at is exactly what the hash names.

/** The database's own limits (content_next_keep): at most 16 files, 13 MB in total, public storage URLs only. */
export const MAX_FILES = 16
export const MAX_BYTES = 13 * 1024 * 1024
export const STORAGE_PREFIX = 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1/object/public/'

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')

/** Hex sha256 of the bytes. */
export async function sha256OfBytes(bytes: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes))
}
/** Hex sha256 of the UTF-8 text, exactly as given (no trimming: the database hashes the stored text as it is). */
export async function sha256OfText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  return sha256OfBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}

export type FileKind = 'image' | 'video' | 'pdf' | 'other'
const EXT_MIME: Record<string, string> = {
  gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', pdf: 'application/pdf',
}
/** The file's type: the server's own content type, else its extension. */
export function mimeOf(url: string, header: string | null): string {
  const h = (header ?? '').split(';')[0].trim().toLowerCase()
  if (h && h !== 'application/octet-stream' && h !== 'binary/octet-stream') return h
  const ext = (url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  return EXT_MIME[ext] ?? (h || 'application/octet-stream')
}
export function kindOf(mime: string): FileKind {
  return mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime === 'application/pdf' ? 'pdf' : 'other'
}

/** One attachment on screen: the blob URL is made from the very bytes that were hashed. */
export type ShownFile = KeepFile & { blobUrl: string; mime: string; kind: FileKind }
export type FilesRead =
  | { status: 'ok'; files: ShownFile[] }
  /** More than the database will check (count or size). */
  | { status: 'too_large' }
  /** A file did not arrive, or its address is not one the database accepts. */
  | { status: 'failed' }

export function releaseFiles(read: FilesRead | null | undefined): void {
  if (read?.status !== 'ok') return
  for (const f of read.files) URL.revokeObjectURL(f.blobUrl)
}

/** Fetch every attachment once, in order. `fresh`: skip the browser's cached copy (after the database said it changed). */
export async function loadFiles(urls: readonly string[], opts: { fresh?: boolean; signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<FilesRead> {
  if (urls.length > MAX_FILES) return { status: 'too_large' }
  if (urls.some(u => !u.startsWith(STORAGE_PREFIX))) return { status: 'failed' }
  const get = opts.fetcher ?? fetch
  const files: ShownFile[] = []
  let total = 0
  const drop = (status: 'too_large' | 'failed'): FilesRead => { releaseFiles({ status: 'ok', files }); return { status } }
  for (const url of urls) {
    let res: Response
    try { res = await get(url, { cache: opts.fresh ? 'reload' : 'default', signal: opts.signal }) }
    catch (e) { if (opts.signal?.aborted) throw e; return drop('failed') }
    if (!res.ok) return drop('failed')
    // A file that says its size up front is refused before its bytes are pulled.
    const said = Number(res.headers.get('content-length'))
    if (Number.isFinite(said) && said > 0 && total + said > MAX_BYTES) { void res.body?.cancel().catch(() => {}); return drop('too_large') }
    let buf: ArrayBuffer
    try { buf = await res.arrayBuffer() }
    catch (e) { if (opts.signal?.aborted) throw e; return drop('failed') }
    total += buf.byteLength
    if (total > MAX_BYTES) return drop('too_large')
    const mime = mimeOf(url, res.headers.get('content-type'))
    files.push({ url, sha256: await sha256OfBytes(buf), bytes: buf.byteLength, mime, kind: kindOf(mime), blobUrl: URL.createObjectURL(new Blob([buf], { type: mime })) })
  }
  return { status: 'ok', files }
}

/** What Keep sends: url, sha256 and byte count, in the row's own order. */
export const keepFilesOf = (files: readonly ShownFile[]): KeepFile[] => files.map(f => ({ url: f.url, sha256: f.sha256, bytes: f.bytes }))
