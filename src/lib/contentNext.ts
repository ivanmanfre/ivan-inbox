import { supabase } from './supabase'

// THE POSTS GOING OUT NEXT (db: content_next_posts, content_next_keep). Ivan's own upcoming queue rows for the next 21
// days, each with whether it will go out as it stands. Keep is his approval of one exact publication: the text the row
// showed him, every attachment byte it showed him, and the slot it showed him. The database ends a keep for good the
// moment the text, the files, the format or the time change (the row comes back with kept: false). Pull (db:
// content_next_pull) takes one of these posts off the schedule: its queued copy is cancelled and the draft goes back to
// Review with no date. Nothing here schedules, moves or publishes.

export type NextState = 'ready' | 'checking' | 'held'
export type NextOrigin = 'autopilot' | 'own'
export type NextPost = {
  queue_id: string
  draft_id: string
  /** ISO time of the slot. */
  slot_at: string
  /** ready = will go out; checking = the automatic check is re-running; held = will NOT go out as it stands. */
  state: NextState
  /** own = he placed it, it needs nothing. */
  origin: NextOrigin
  /** He already tapped Keep on exactly this text, these files and this slot. */
  kept: boolean
  /** Raw reasons when not ready. */
  fails: string[]
  /** The queued copy that will be posted. */
  post_text: string
  post_format: string | null
  /** false while the queue row is catching up with an edit. */
  in_sync: boolean
  /** Every file to hash (the sorted set; may be empty). */
  urls: string[]
  /** The attachments in posting order (can differ from `urls`). */
  media_urls: string[]
}
/** What the row showed him besides its text and files: Keep sends these exactly as the read returned them. */
export type NextShown = Pick<NextPost, 'queue_id' | 'slot_at' | 'post_format' | 'media_urls'>
/** One attachment as the browser fetched it: what Keep sends for every URL of the row. */
export type KeepFile = { url: string; sha256: string; bytes: number }

const STATES: readonly string[] = ['ready', 'checking', 'held']
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []

/** One row of the read, or null when it is not a row this screen can stand behind (never a guessed state). */
export function nextPostOf(raw: unknown): NextPost | null {
  const p = raw as Partial<Record<keyof NextPost, unknown>> | null
  if (!p || typeof p.queue_id !== 'string' || typeof p.draft_id !== 'string' || typeof p.slot_at !== 'string') return null
  if (!Number.isFinite(Date.parse(p.slot_at)) || !STATES.includes(String(p.state))) return null
  return {
    queue_id: p.queue_id, draft_id: p.draft_id, slot_at: p.slot_at, state: p.state as NextState,
    origin: p.origin === 'own' ? 'own' : 'autopilot', kept: p.kept === true, fails: strings(p.fails),
    post_text: typeof p.post_text === 'string' ? p.post_text : '', post_format: typeof p.post_format === 'string' ? p.post_format : null,
    // Only an explicit true counts: a row that does not say it is in step is treated as catching up (Keep waits).
    in_sync: p.in_sync === true, urls: strings(p.urls), media_urls: Array.isArray(p.media_urls) ? strings(p.media_urls) : strings(p.urls),
  }
}

/** The upcoming posts, soonest first. Throws on a failed read (a failure is never "nothing is going out"). */
export async function readNextPosts(): Promise<NextPost[]> {
  const { data, error } = await supabase.rpc('content_next_posts')
  if (error) throw new Error(error.message || 'The next posts could not load.')
  if (data == null) return []
  if (!Array.isArray(data)) throw new Error('The next posts came back malformed.')
  return data.map(nextPostOf).filter((p): p is NextPost => !!p).sort((a, b) => Date.parse(a.slot_at) - Date.parse(b.slot_at))
}

/** A Keep or a Pull the database refused on purpose (hint next_gone, next_past, next_changed, next_unverifiable, next_busy).
 *  Its message is the database's own plain sentence and is shown as it is. */
export class NextRefused extends Error {
  readonly code: string
  constructor(message: string, code: string) { super(message); this.code = code }
}

/** His Keep of one exact publication. `shown`: the row he was looking at when he tapped (its slot_at, post_format and
 *  media_urls go out exactly as that read returned them, never re-formatted and never from a newer read: the database
 *  compares what he saw with what is queued now, and answers next_changed when they differ). `bodySha`: sha256 of the
 *  text the row showed; `files`: every entry of `urls` as fetched and displayed. */
export async function keepNext(shown: NextShown, bodySha: string, files: KeepFile[]): Promise<void> {
  const { error } = await supabase.rpc('content_next_keep', {
    p_queue: shown.queue_id, p_slot_at: shown.slot_at, p_body_sha: bodySha, p_post_format: shown.post_format, p_media_urls: shown.media_urls,
    p_files: files.map(f => ({ url: f.url, sha256: f.sha256, bytes: f.bytes })),
  })
  if (!error) return
  const hint = (error as { hint?: string | null }).hint ?? ''
  if (/^next_/.test(hint)) throw new NextRefused(error.message, hint)
  throw new Error(error.message || 'Not kept.')
}

/** His Pull of one upcoming post. `shown`: the row he was looking at (its queue row and the slot it showed him). The
 *  database refuses (next_changed) when the post moved or is no longer waiting, and (next_busy) while it is being
 *  published. On success nothing of it is queued any more and the draft is back in Review with no date. */
export async function pullNext(shown: Pick<NextPost, 'queue_id' | 'slot_at'>): Promise<void> {
  const { error } = await supabase.rpc('content_next_pull', { p_queue: shown.queue_id, p_slot_at: shown.slot_at })
  if (!error) return
  const hint = (error as { hint?: string | null }).hint ?? ''
  if (/^next_/.test(hint)) throw new NextRefused(error.message, hint)
  throw new Error(error.message || 'Not pulled.')
}
