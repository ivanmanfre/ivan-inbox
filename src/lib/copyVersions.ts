import { supabase } from './supabase'
import { DraftSaveConflict, saveDraftBody } from './content'

// Long / Short on a copied X post (Poland lane, 2026-11-14). The ingestor keeps the near word-for-word
// copy in source_detail.short_copy and makes the long version the post body. Ivan picks which one posts.
// A switch is his edit: the chosen text is saved with saveDraftBody (the same compare-and-swap his typed
// edits use, human_edited stamped), and the text it replaces is kept in source_detail first
// (long_copy / short_copy), so an edit he made to either side survives the switch and the way back.
export type CopySide = 'long' | 'short'
export type CopyVersions = { now: CopySide; long: string; short: string }

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {})
const text = (v: unknown): string => (typeof v === 'string' && v.trim() ? v : '')
const same = (a: string, b: string) => a.trim() === b.trim()

/** Words as the feed counts them, for the switch's labels. */
export function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

/**
 * Both versions and which one is the body, from what the row holds. Null when the draft does not carry
 * two different texts (no short copy, or the body IS the short copy and no long one was ever kept).
 * `taxonomy.copy_choice` is written by the switch; before the first switch the body is the long version
 * unless it equals the short copy.
 */
export function copyVersionsOf(body: string | null, taxonomy: unknown, sourceDetail: unknown): CopyVersions | null {
  const sd = obj(sourceDetail), b = body ?? ''
  const short = text(sd.short_copy), kept = text(sd.long_copy)
  if (!short || !b.trim()) return null
  const choice = obj(taxonomy).copy_choice
  const now: CopySide = choice === 'short' || choice === 'long' ? choice : same(b, short) ? 'short' : 'long'
  const long = now === 'long' ? b : kept
  const shortNow = now === 'short' ? b : short
  if (!long.trim() || same(long, shortNow)) return null
  return { now, long, short: shortNow }
}

type Row = { post_body: string | null; updated_at: string | null; taxonomy: unknown; source_detail: unknown; published_at: string | null }
async function readRow(id: string): Promise<Row | null> {
  const { data, error } = await supabase.from('cb34_p2_safe_drafts')
    .select('post_body, updated_at, taxonomy, source_detail, published_at')
    .eq('id', id).is('client_id', null).maybeSingle()
  if (error) throw error
  return (data ?? null) as Row | null
}

/** The versions a draft holds now. Null when it has nothing to switch between, or is already published. */
export async function readCopyVersions(id: string): Promise<CopyVersions | null> {
  const r = await readRow(id)
  if (!r || r.published_at) return null
  return copyVersionsOf(r.post_body, r.taxonomy, r.source_detail)
}

/**
 * Make `to` the post body. `base` is the body the screen shows: a body that moved elsewhere is refused
 * (DraftSaveConflict), never overwritten. Returns the text that is now the body.
 */
export async function switchDraftCopy(id: string, to: CopySide, base: string): Promise<string> {
  const r = await readRow(id)
  if (!r) throw new DraftSaveConflict({ kind: 'gone', theirs: null, theirUpdatedAt: null })
  if (r.published_at) throw new Error('This post is already published. Nothing changed.')
  const stored = r.post_body ?? ''
  if (stored !== base) throw new DraftSaveConflict({ kind: 'conflict', theirs: r.post_body, theirUpdatedAt: r.updated_at })
  const v = copyVersionsOf(stored, r.taxonomy, r.source_detail)
  if (!v) throw new Error('This post has one version only. Nothing changed.')
  if (v.now === to) return stored
  const next = to === 'long' ? v.long : v.short
  // 1 — keep the text that is leaving, in its own slot. Gated on updated_at, so a write that landed
  // since the read above (and may have changed source_detail) is never overwritten.
  const slot = v.now === 'long' ? 'long_copy' : 'short_copy'
  const sd = obj(r.source_detail)
  if (sd[slot] !== stored) {
    let q = supabase.from('carousel_drafts').update({ source_detail: { ...sd, [slot]: stored } }).eq('id', id).is('client_id', null).is('published_at', null)
    if (r.updated_at) q = q.eq('updated_at', r.updated_at)
    const { data, error } = await q.select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new DraftSaveConflict({ kind: 'conflict', theirs: r.post_body, theirUpdatedAt: r.updated_at })
  }
  // 2 — the body, through the editor's own save. It re-reads the row, so the write above is forgiven.
  await saveDraftBody(id, next, { ...obj(r.taxonomy), copy_choice: to }, stored, null)
  return next
}
