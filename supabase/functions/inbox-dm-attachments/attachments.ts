// The files on a LinkedIn conversation, read from the seat's own chat. Pure: the provider read, the
// clock and the signing key are passed in, so the same code runs under Deno (index.ts) and vitest.
//
// Unipile hands every chat message an `attachments` array ({ id, type, mimetype, file_name, file_size,
// size, unavailable, url }). Its `url` is `att://<account id>/<encoded LinkedIn url>`: it carries the
// account id and opens nothing in a browser, so it never leaves this function. The bytes come from a
// second read with the API key (GET /messages/{id}/attachments/{id}), which this function proxies
// behind a short-lived signed link.

export type DmFile = {
  id: string
  kind: 'image' | 'video' | 'audio' | 'file'
  mime: string | null
  name: string | null
  /** Bytes, when LinkedIn says. */
  size: number | null
  width: number | null
  height: number | null
  /** LinkedIn no longer serves it: the chip shows, nothing opens. */
  unavailable: boolean
  /** Signed link to the bytes, good until the response's `expires_at`. Null when unavailable. */
  href: string | null
}

export type DmFileGroup = {
  /** Our outreach_messages.id, or null when the message was never mirrored in (a file sent with no words). */
  message_id: string | null
  direction: 'inbound' | 'outbound'
  at: string | null
  files: DmFile[]
}

export type MessageRow = { id: string; unipile_message_id: string | null; unipile_chat_id: string | null }

type ProviderAttachment = { id?: unknown; type?: unknown; mimetype?: unknown; file_name?: unknown; file_size?: unknown; size?: unknown; unavailable?: unknown }
type ProviderMessage = { id?: unknown; is_sender?: unknown; timestamp?: unknown; attachments?: unknown }
export type ProviderRead = (path: string) => Promise<Response>

const KINDS: Record<string, DmFile['kind']> = { img: 'image', video: 'video', audio: 'audio', file: 'file' }
// Unipile ids are url-safe base64. Anything else is not an id and is never put in a path.
export const PROVIDER_ID = /^[A-Za-z0-9_-]{6,64}$/
/** One read per chat page. A page is 100 messages; a thread longer than 300 shows its newest 300. */
export const PAGE_SIZE = 100
export const MAX_PAGES = 3
export const MAX_CHATS = 4
/** Links are cut on a fixed grid so the same file keeps one URL (and the browser's copy) for a while. */
export const LINK_STEP_MS = 30 * 60_000

const text = (v: unknown, max: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
const count = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null

/** Between 30 and 60 minutes from now, on the grid. */
export function linkExpiry(now: number): number {
  return (Math.floor(now / LINK_STEP_MS) + 2) * LINK_STEP_MS
}

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message)))
  let s = ''
  for (const b of sig) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** What a link proves: this exact file of this exact message, until `exp`. Nothing else can be read with it. */
export function signLink(key: string, messageId: string, attachmentId: string, exp: number): Promise<string> {
  return hmac(key, `dm-attachment-v1\n${messageId}\n${attachmentId}\n${exp}`)
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export type LinkParams = { messageId: string; attachmentId: string }

/** The link's own check. Returns the two ids only when the signature fits and the link has not run out. */
export async function verifyLink(key: string, q: URLSearchParams, now: number): Promise<LinkParams | null> {
  const m = q.get('m') ?? '', a = q.get('a') ?? '', e = q.get('e') ?? '', s = q.get('s') ?? ''
  if (!PROVIDER_ID.test(m) || !PROVIDER_ID.test(a) || !/^\d{10,16}$/.test(e) || !/^[A-Za-z0-9_-]{43}$/.test(s)) return null
  const exp = Number(e)
  if (!(exp > now) || exp - now > 2 * LINK_STEP_MS) return null
  return sameText(await signLink(key, m, a, exp), s) ? { messageId: m, attachmentId: a } : null
}

function fileOf(a: ProviderAttachment): Omit<DmFile, 'href'> | null {
  const kind = typeof a.type === 'string' ? KINDS[a.type] : undefined
  if (!kind || typeof a.id !== 'string' || !PROVIDER_ID.test(a.id)) return null
  const box = a.size && typeof a.size === 'object' ? a.size as { width?: unknown; height?: unknown } : null
  return { id: a.id, kind, mime: text(a.mimetype, 100)?.toLowerCase() ?? null, name: text(a.file_name, 200), size: count(a.file_size),
    width: count(box?.width), height: count(box?.height), unavailable: a.unavailable === true }
}

export type FileList = { groups: DmFileGroup[]; expires_at: string; complete: boolean }

/**
 * Every file on the person's LinkedIn chats, newest page first, tied to our message rows.
 * `complete: false` means a chat could not be read (or ran past the page cap): the list is what was seen.
 * Throws only when no chat could be read at all.
 */
export async function listFiles(rows: MessageRow[], opts: { read: ProviderRead; key: string; base: string; now: number }): Promise<FileList> {
  const exp = linkExpiry(opts.now)
  const chats = [...new Set(rows.map(r => r.unipile_chat_id).filter((c): c is string => !!c && PROVIDER_ID.test(c)))]
  const rowOf = new Map<string, string>()
  // The listener lane stores the provider id as "listen:<id>".
  for (const r of rows) if (r.unipile_message_id) { const id = r.unipile_message_id.replace(/^listen:/, ''); if (!rowOf.has(id)) rowOf.set(id, r.id) }
  let complete = chats.length <= MAX_CHATS, readOk = 0
  const seen = new Set<string>(), groups: DmFileGroup[] = []
  for (const chat of chats.slice(0, MAX_CHATS)) {
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      let body: { items?: unknown; cursor?: unknown } | null = null
      try {
        const r = await opts.read(`/chats/${chat}/messages?limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        body = r.ok ? await r.json() : null
      } catch { body = null }
      if (!body || !Array.isArray(body.items)) { complete = false; break }
      if (page === 0) readOk++
      for (const m of body.items as ProviderMessage[]) {
        if (!m || typeof m.id !== 'string' || !PROVIDER_ID.test(m.id) || seen.has(m.id) || !Array.isArray(m.attachments)) continue
        seen.add(m.id)
        const files: DmFile[] = []
        for (const a of m.attachments as ProviderAttachment[]) {
          const f = a && typeof a === 'object' ? fileOf(a) : null
          if (!f) continue
          const href = f.unavailable ? null : `${opts.base}?m=${m.id}&a=${f.id}&e=${exp}&s=${await signLink(opts.key, m.id, f.id, exp)}`
          files.push({ ...f, href })
        }
        if (files.length) groups.push({ message_id: rowOf.get(m.id) ?? null, direction: m.is_sender ? 'outbound' : 'inbound', at: text(m.timestamp, 40), files })
      }
      cursor = typeof body.cursor === 'string' && body.cursor ? body.cursor : null
      if (!cursor) break
      if (page === MAX_PAGES - 1) complete = false
    }
  }
  if (chats.length && !readOk) throw new Error('chat_read_failed')
  return { groups, expires_at: new Date(exp).toISOString(), complete }
}

// What a browser may show in place. Everything else is handed over as a download, so a file a
// stranger sent (html, svg, a script) can never run on this origin.
const INLINE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function fileName(disposition: string | null): string {
  const quoted = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '')?.[1] ?? ''
  let name = quoted
  try { name = decodeURIComponent(quoted) } catch { /* keep the raw name */ }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
  return name || 'file'
}

/** The bytes of one file, with headers that only ever show a PDF or a plain image in place. */
export async function serveFile(link: LinkParams, read: ProviderRead): Promise<Response> {
  let upstream: Response
  try { upstream = await read(`/messages/${link.messageId}/attachments/${link.attachmentId}`) } catch { return gone(502) }
  if (!upstream.ok || !upstream.body) { await upstream.body?.cancel().catch(() => {}); return gone(upstream.status === 404 ? 404 : 502) }
  const type = (upstream.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const inline = INLINE.has(type)
  const name = fileName(upstream.headers.get('content-disposition'))
  const headers = new Headers({
    'Content-Type': inline ? type : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
    'Cache-Control': 'private, max-age=1800',
  })
  if (!inline) headers.set('Content-Security-Policy', "default-src 'none'; sandbox")
  const length = upstream.headers.get('content-length')
  if (length && /^\d+$/.test(length)) headers.set('Content-Length', length)
  return new Response(upstream.body, { status: 200, headers })
}

export function gone(status: number): Response {
  const words = status === 403 ? 'This link has run out. Open the conversation again and tap the file.'
    : status === 404 ? 'LinkedIn no longer has this file.' : 'The file could not be read from LinkedIn. Try again.'
  return new Response(words, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}
