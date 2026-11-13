import { NextRefused, type KeepFile, type NextPost, type NextShown } from '../../../lib/contentNext'
import { keepFilesOf, sha256OfText, type FilesRead } from './hash'
import { NOTE_LARGE, NOTE_SYNC, slotWords } from './model'

// KEEP, AND FIX THEN KEEP. Both end in content_next_keep with the text the row shows and the attachment bytes the row
// shows. The calls are passed in, so the flow is tested without a database.

export type KeepDeps = {
  /** Re-read content_next_posts; null when the read failed. */
  read: () => Promise<NextPost[] | null>
  /** content_next_keep: the row as shown (queue row, slot, format, attachment order), the text hash, the files. */
  keep: (shown: NextShown, bodySha: string, files: KeepFile[]) => Promise<void>
  wait: (ms: number) => Promise<void>
}
/** `code`: the database's refusal (next_changed: the row on screen is old, reload it and its files). */
export type Outcome = { ok: boolean; message: string; code?: string }

const said = (e: unknown, fallback: string) => e instanceof Error && e.message ? e.message : fallback
const sameUrls = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((u, i) => u === b[i])
/** His typed text against the stored text: line endings and outer blank space are the database's to normalise. */
const sameText = (a: string, b: string) => a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim()

/** Keep the post exactly as the row shows it: its text, its attachments from the bytes on screen, and the slot, format
 *  and attachment order of `post`, which must be the row on screen at the tap (never a read made inside the tap). */
export async function keepShown(post: NextPost, shownText: string, files: FilesRead | null, deps: Pick<KeepDeps, 'keep'>): Promise<Outcome> {
  if (!post.in_sync) return { ok: false, message: NOTE_SYNC }
  if (!files || files.status !== 'ok') return { ok: false, message: NOTE_LARGE }
  const have = files.files.map(f => f.url)
  if (!sameUrls(have, post.urls) || post.media_urls.some(u => !have.includes(u))) return { ok: false, message: 'The attachment changed. Look at it, then tap Keep.' }
  try {
    await deps.keep({ queue_id: post.queue_id, slot_at: post.slot_at, post_format: post.post_format, media_urls: post.media_urls }, await sha256OfText(shownText), keepFilesOf(files.files))
    return { ok: true, message: `Kept. It goes out ${slotWords(post.slot_at)}.` }
  } catch (e) {
    // The database's own sentence, as it is (next_gone, next_past, next_changed, next_unverifiable, next_busy).
    return { ok: false, message: said(e, 'Not kept.'), ...(e instanceof NextRefused ? { code: e.code } : {}) }
  }
}

export const FIX_TRIES = 6
export const FIX_WAIT_MS = 1500

/** After his edit of an autopilot post was saved: wait for the queued copy to carry it (a few short tries), then Keep
 *  for him, on his text and the attachments he is looking at. Any miss leaves the row held with Keep in reach. */
export async function keepAfterFix(post: NextPost, savedText: string, files: FilesRead | null, deps: KeepDeps, tries = FIX_TRIES, waitMs = FIX_WAIT_MS): Promise<Outcome> {
  if (post.origin !== 'autopilot') { await deps.read(); return { ok: true, message: 'Saved.' } }
  let row: NextPost | null = null
  for (let i = 0; i < tries; i++) {
    if (i > 0) await deps.wait(waitMs)
    const posts = await deps.read()
    if (!posts) continue
    const now = posts.find(p => p.queue_id === post.queue_id) ?? null
    if (!now) return { ok: false, message: 'Saved. It is no longer on the schedule.' }
    if (now.in_sync && sameText(now.post_text, savedText)) { row = now; break }
  }
  if (!row) return { ok: false, message: 'Saved. The queue is catching up. Tap Keep in a minute.' }
  // He kept nothing he has not seen. Only the text is new: the slot, the format and the attachments must still be the
  // ones of the row he saved from, and those (not the re-read's) are what the keep sends.
  if (!sameUrls(row.urls, post.urls) || !sameUrls(row.media_urls, post.media_urls)) return { ok: false, message: 'Saved. The attachment changed. Look at it, then tap Keep.' }
  if (row.slot_at !== post.slot_at || row.post_format !== post.post_format) return { ok: false, message: 'Saved. Its time or format changed. Look at it, then tap Keep.' }
  const kept = await keepShown({ ...post, in_sync: true }, row.post_text, files, deps)
  await deps.read()
  return kept.ok ? { ok: true, message: 'Saved. It goes out with your text.' } : { ok: false, message: `Saved. ${kept.message}`, ...(kept.code ? { code: kept.code } : {}) }
}
