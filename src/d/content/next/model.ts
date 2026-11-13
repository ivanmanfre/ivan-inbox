import type { NextPost } from '../../../lib/contentNext'
import type { DRoute } from '../../route'
import { warsawDm, warsawDow, warsawHm } from '../../ui/time'
import { isContentLanding } from '../today/store'
import type { FilesRead } from './hash'
import { plainReason } from './reasons'

// THE NEXT-POST ROWS OF IVAN'S REVIEW LIST, as plain data. The first row is the post going out next; under it, every
// later post that will NOT go out as it stands. Later posts that are fine are not listed (the Calendar shows them).

export type NextTag = 'Next' | 'Held'
export type NextRow = { post: NextPost; tag: NextTag }

/** The rows, in drawn order: the soonest post (tagged Next), then every later held post (tagged Held). */
export function nextRows(posts: readonly NextPost[]): NextRow[] {
  const sorted = [...posts].sort((a, b) => Date.parse(a.slot_at) - Date.parse(b.slot_at))
  return sorted.flatMap((post, i): NextRow[] => i === 0 ? [{ post, tag: 'Next' }] : post.state === 'held' ? [{ post, tag: 'Held' }] : [])
}

export const anyHeld = (posts: readonly NextPost[]): boolean => posts.some(p => p.state === 'held')

/** 'Mon 16 Nov' and '14:00', Warsaw time. */
export const slotDay = (at: string) => `${warsawDow(at)} ${warsawDm(at)}`
export const slotTime = (at: string) => warsawHm(at)
/** 'Mon 16 Nov at 14:00' */
export const slotWords = (at: string) => `${slotDay(at)} at ${slotTime(at)}`

export type Status = { tone: 'ok' | 'wait' | 'held'; text: string; reason?: string }
/** The row's one status line. */
export function statusOf(p: NextPost): Status {
  if (p.state === 'checking') return { tone: 'wait', text: 'Being re-checked. Nothing to do.' }
  if (p.state === 'held') return { tone: 'held', text: 'Will not go out as it stands.', reason: plainReason(p.fails) }
  const goes = `Goes out ${slotWords(p.slot_at)}.`
  if (p.origin === 'own') return { tone: 'ok', text: `${goes} You placed it.` }
  return { tone: 'ok', text: `${goes} ${p.kept ? 'You kept it.' : 'Checked by the autopilot.'}` }
}

export const NOTE_SYNC = 'The queue is catching up. Try in a minute.'
export const NOTE_LARGE = 'Too large to check here.'
export const NOTE_READING = 'Reading the attachment.'

export type KeepKey =
  /** No Keep on this row: he placed it, he already kept it, or the check is running. */
  | { show: false }
  /** `primary`: the row is held, so Keep is the main key. `note`: why it cannot be tapped yet. */
  | { show: true; primary: boolean; enabled: boolean; note: string | null }

/** Keep is for autopilot posts he has not kept yet. `files`: the attachments as this row fetched them (null: still reading). */
export function keepKeyOf(p: NextPost, files: FilesRead | null): KeepKey {
  if (p.origin !== 'autopilot' || p.kept || p.state === 'checking') return { show: false }
  const primary = p.state === 'held'
  if (!p.in_sync) return { show: true, primary, enabled: false, note: NOTE_SYNC }
  if (!files) return { show: true, primary, enabled: false, note: p.urls.length ? NOTE_READING : null }
  if (files.status !== 'ok') return { show: true, primary, enabled: false, note: NOTE_LARGE }
  return { show: true, primary, enabled: true, note: null }
}

/** The post's first line, for the row's title. */
export function hookOf(text: string): string {
  const line = text.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return line.length > 160 ? `${line.slice(0, 158)}…` : line
}

/** Where Content's landing goes for the next posts, after today's card had its say (`card` = cardLanding's answer):
 *  'held' while any upcoming post will not go out (Review, Ivan's seat), 'wait' while that read is still out, null =
 *  as before. Today's waiting card wins: it lands on Ivan's Review too, where these rows are first anyway. */
export function nextLanding(r: Pick<DRoute, 'place' | 'sub' | 'query'>, card: 'card' | 'wait' | null, loaded: boolean, held: boolean): 'held' | 'wait' | null {
  if (!isContentLanding(r) || card === 'card') return null
  if (!loaded) return 'wait'
  return card === null && held ? 'held' : null
}
