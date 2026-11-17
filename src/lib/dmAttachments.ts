// The files on a LinkedIn conversation (a deck, a screenshot), read live from the seat's own chat by
// the inbox-dm-attachments edge function. Nothing is stored: not in the database, not in the saved
// copy. The links are signed and run out within the hour, so they live in memory only.
import { supabase } from './supabase'

export type DmFile = {
  id: string
  kind: 'image' | 'video' | 'audio' | 'file'
  mime: string | null
  name: string | null
  size: number | null
  width: number | null
  height: number | null
  unavailable: boolean
  href: string | null
}

/** A file message with no row of ours: sent on LinkedIn with no words, so the sync never mirrored it. */
export type LooseFiles = { key: string; direction: 'inbound' | 'outbound'; at: string; files: DmFile[] }

export type DmAttachments = {
  /** By outreach_messages.id. */
  byMessage: ReadonlyMap<string, readonly DmFile[]>
  loose: readonly LooseFiles[]
  /** When the links stop working (ms). */
  expiresAt: number
}

const KINDS = new Set(['image', 'video', 'audio', 'file'])
const str = (v: unknown) => typeof v === 'string' && v ? v : null
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null

function fileOf(v: unknown, fnUrl: string): DmFile | null {
  const f = v as Partial<DmFile> | null
  if (!f || typeof f.id !== 'string' || typeof f.kind !== 'string' || !KINDS.has(f.kind)) return null
  // Only the function's own address is ever a link: a response can never point a tap somewhere else.
  const href = typeof f.href === 'string' && f.href.startsWith(`${fnUrl}?`) ? f.href : null
  return { id: f.id, kind: f.kind, mime: str(f.mime), name: str(f.name), size: num(f.size), width: num(f.width), height: num(f.height), unavailable: f.unavailable === true || !href, href }
}

/** The edge function's answer, checked field by field. Anything malformed is dropped, never rendered. */
export function parseDmAttachments(body: unknown, fnUrl: string, now = Date.now()): DmAttachments {
  const b = body as { groups?: unknown; expires_at?: unknown } | null
  const byMessage = new Map<string, DmFile[]>(), loose: LooseFiles[] = []
  for (const g of Array.isArray(b?.groups) ? b.groups as { message_id?: unknown; direction?: unknown; at?: unknown; files?: unknown }[] : []) {
    const files = (Array.isArray(g?.files) ? g.files : []).map(f => fileOf(f, fnUrl)).filter((f): f is DmFile => !!f)
    if (!files.length) continue
    if (typeof g.message_id === 'string' && g.message_id) byMessage.set(g.message_id, [...(byMessage.get(g.message_id) ?? []), ...files])
    else if (typeof g.at === 'string' && Number.isFinite(Date.parse(g.at))) loose.push({ key: `${g.at}:${files[0].id}`, direction: g.direction === 'inbound' ? 'inbound' : 'outbound', at: g.at, files })
  }
  const exp = typeof b?.expires_at === 'string' ? Date.parse(b.expires_at) : NaN
  return { byMessage, loose: loose.sort((a, z) => Date.parse(a.at) - Date.parse(z.at)), expiresAt: Number.isFinite(exp) ? exp : now }
}

/** One read per open conversation. Throws on any failure; the thread then shows what it showed before. */
export async function fetchDmAttachments(prospectId: string): Promise<DmAttachments> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('not signed in')
  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-dm-attachments`
  const res = await window.fetch(fnUrl, {
    method: 'POST',
    headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prospect_id: prospectId }),
    // A read that hangs is given up on, so the next one is not left waiting behind it.
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(45_000) : undefined,
  })
  const out = await res.json().catch(() => null)
  if (!res.ok || out?.ok !== true) throw new Error(out?.error ?? `files read failed (${res.status})`)
  return parseDmAttachments(out, fnUrl)
}

const TYPES: Record<string, string> = {
  'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/gif': 'GIF', 'image/webp': 'WEBP',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX', 'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX', 'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX', 'application/vnd.ms-excel': 'XLS',
  'text/csv': 'CSV', 'text/plain': 'TXT', 'application/zip': 'ZIP', 'video/mp4': 'MP4', 'video/quicktime': 'MOV', 'audio/mpeg': 'MP3', 'audio/mp4': 'M4A',
}
const WORD: Record<DmFile['kind'], string> = { image: 'Image', video: 'Video', audio: 'Audio', file: 'File' }

/** "PDF", "PNG", "DOCX": from the mime type, else the name's extension, else the plain kind. */
export function fileType(f: Pick<DmFile, 'kind' | 'mime' | 'name'>): string {
  const known = f.mime ? TYPES[f.mime] : undefined
  if (known) return known
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(f.name ?? '')?.[1]
  return ext ? ext.toUpperCase() : WORD[f.kind]
}

/** "4.7 MB", "312 KB". Null when LinkedIn gave no size. */
export function fileSize(bytes: number | null): string | null {
  if (bytes === null) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`
}

/** The chip's first line: the file's own name, or what it is when LinkedIn gave none (an image has no name). */
export function fileName(f: Pick<DmFile, 'kind' | 'name'>): string {
  return f.name ?? WORD[f.kind]
}
