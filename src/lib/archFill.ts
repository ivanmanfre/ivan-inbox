import { supabase } from './supabase'
import { CLIENT_OPS_GATE } from './content'

// ARCH "FILL NEXT WEEK" (db/20261107_arch_fill_next_week, review 2026-11-06 #25). Ivan 27 Oct: only repurposed
// posts (reworks of Davorin's own published posts) go out without Davorin's approval, and only at 0.40 word
// overlap with the original or less. The read says which reworks qualify; everything else waits for Davorin.
// The commit is Ivan's tap: approve + date per post, all or nothing; the batch id undoes it.

export type ArchFillOffer = { id: string; title: string | null; post_body: string | null; body_sha256: string; overlap: number; original_title: string | null; original_at: string | null }
export type ArchFillHeld = { id: string; title: string | null; reason: string; overlap: number | null }
/** The week the key fills (next Mon-Fri in Zagreb), its target and the ARCH posts already dated in it. */
export type ArchFillWeek = { start: string; end: string; target: number; dated: number }
export type ArchFillRead = { tz: string; slot_hm: string; limit: number; week: ArchFillWeek; offered: ArchFillOffer[]; held: ArchFillHeld[]; waiting_davorin: number }

const fail = (why: string) => new Error(why)
/** The request failed without a clear refusal: the fill may or may not have landed. */
export class FillUnsure extends Error {}

export async function fetchArchFill(signal?: AbortSignal): Promise<ArchFillRead> {
  const q = supabase.rpc('arch_fill_read', { p_gate: CLIENT_OPS_GATE })
  const { data, error } = await (signal ? q.abortSignal(signal) : q)
  const d = data as (Partial<ArchFillRead> & { ok?: boolean; error?: string }) | null
  if (error || !d?.ok) throw fail(error?.message || d?.error || 'The repurposed posts could not load.')
  if (!/^\d\d:\d\d$/.test(d.slot_hm ?? '') || !Array.isArray(d.offered) || !Array.isArray(d.held) || !d.week?.start) throw fail('The repurposed posts read was partial.')
  return {
    tz: d.tz || 'Europe/Zagreb', slot_hm: d.slot_hm!, limit: Number(d.limit ?? 0.4),
    week: { start: d.week.start, end: d.week.end, target: Number(d.week.target), dated: Number(d.week.dated) },
    offered: d.offered.map(o => ({ ...o, overlap: Number(o.overlap) })),
    held: d.held.map(h => ({ ...h, overlap: h.overlap == null ? null : Number(h.overlap) })),
    waiting_davorin: Number(d.waiting_davorin ?? 0),
  }
}

const COMMIT_WHY: Record<string, string> = {
  not_eligible: 'A post no longer qualifies as a repurposed post.',
  past_date: 'That time has already passed.',
  not_arch_slot: 'That is not ARCH’s posting time.',
  too_close: 'Another ARCH post is within a day of that time.',
  changed: 'A post changed since the plan showed it.',
  week_full: 'Next week already has its posts.',
  bad_gate: 'Not signed in.',
}

/** `batch` is made by the caller before asking, so a lost answer can be retried (the RPC is idempotent on it) or undone. */
export async function commitArchFill(batch: string, items: readonly { id: string; at: string; body_sha256: string }[]): Promise<{ batch: string; items: { id: string; scheduled_at: string }[] }> {
  const { data, error } = await supabase.rpc('arch_fill_commit', { p_gate: CLIENT_OPS_GATE, p_batch: batch, p_items: items })
  const d = data as { ok?: boolean; error?: string; batch?: string; items?: { id: string; scheduled_at: string }[] } | null
  if (error) throw new FillUnsure(error.message || 'No answer from the database.')
  if (!d?.ok || !d.batch) throw fail(COMMIT_WHY[d?.error ?? ''] ?? 'The fill did not go through.')
  return { batch: d.batch, items: d.items ?? [] }
}

export async function undoArchFill(batch: string): Promise<{ undone: number; posted: number; changed: number; tooLate: number }> {
  const { data, error } = await supabase.rpc('arch_fill_undo', { p_gate: CLIENT_OPS_GATE, p_batch: batch })
  const d = data as { ok?: boolean; error?: string; undone?: number; posted?: number; changed?: number } | null
  if (error || !d?.ok) throw fail(error?.message || 'The undo did not go through.')
  return { undone: d.undone ?? 0, posted: d.posted ?? 0, changed: d.changed ?? 0, tooLate: (d as { too_late?: number }).too_late ?? 0 }
}
