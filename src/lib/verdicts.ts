import { supabase } from './supabase'

// IVAN'S APPROVE / DROP ON A BRAIN DRAFT (run 39, 3 Oct). One database call,
// cb39_verdict_set, writes the verdict row FIRST (with the body, brief and
// labels the brain learns from) and then does today's write to the draft in the
// same transaction: Approve on Ivan's lane = approveDraft (status 'approved',
// never publishes); Approve on Rise/Arch = the verdict only (no client-lane approve
// exists); Drop = deleteDraft / deleteClientDraft (hard delete, or the archive
// fallback when the database refuses it, which it does for every brain draft
// while the brain's membership row points at it). The verdict outlives the draft.
// Replaying a call is safe: same verdict = the saved row (reasons added if
// given), the other verdict = refused. Approve takes no reasons. Approving a
// draft whose body Ivan changed comes back as verdict 'edited'.
/** What Ivan taps: Approve (stored as 'keep') or Drop. */
export type Verdict = 'keep' | 'drop'
/** What a stored row says: 'edited' is an Approve of a draft whose body Ivan had changed (the server decides). */
export type StoredVerdict = 'keep' | 'edited' | 'drop'

// 'skip' is the last chip: one more tap that records "no reason given" (reason_skipped = true on the row).
export const DROP_REASONS = [
  ['invented_fact', 'Invented a fact'],
  ['not_my_voice', 'Not my voice'],
  ['generic', 'Generic'],
  ['wrong_topic', 'Wrong topic'],
  ['too_long', 'Too long'],
  ['already_said', 'Said it already'],
  ['other', 'Other'],
  ['skip', 'Skip'],
] as const
export type Reason = (typeof DROP_REASONS)[number][0]
export const reasonLabel = (slug: string) => DROP_REASONS.find(r => r[0] === slug)?.[1] ?? slug

export type DraftAction = 'pending' | 'approved' | 'none' | 'deleted' | 'archived' | 'backfill'
export type SavedVerdict = {
  verdict_id: string
  draft_id: string
  client_id: 'ivan' | 'risedtc' | 'arch'
  verdict: StoredVerdict
  reasons: string[]
  note: string | null
  how_made: 'brain' | 'normal'
  draft_action: DraftAction
  source: 'app' | 'backfill'
  decided_at: string
  updated_at: string | null
  /** The body Ivan was shown before he edited it, and the body he approved (null when he did not edit). */
  body_before?: string | null
  body_after?: string | null
  /** Size of the changed region (chars removed + inserted), null when not edited. */
  edit_chars?: number | null
  /** Card on screen (or post opened) to tap, in ms, when the app could measure it. */
  ms_to_verdict?: number | null
  shown_at?: string | null
  /** Dropped with the Skip chip: no reason given, on purpose. */
  reason_skipped?: boolean
  replayed?: boolean
}

/** A refusal the database gave on purpose (already judged, not in review, on the board), worded for Ivan. */
export class VerdictRefused extends Error {}

function friendly(message: string): string {
  if (/already judged (keep|edited)/i.test(message)) return 'Already approved. It cannot be dropped from here now.'
  if (/already judged drop/i.test(message)) return 'Already dropped.'
  if (/unauthorized|permission denied/i.test(message)) return 'Not allowed from this login.'
  if (/draft not found/i.test(message)) return 'This draft is gone (deleted elsewhere).'
  return message
}

export async function setVerdict(draftId: string, verdict: Verdict, o: { reasons?: string[]; note?: string | null; invocation?: string; msToVerdict?: number } = {}): Promise<SavedVerdict> {
  const { data, error } = await supabase.rpc('cb39_verdict_set', {
    p_draft: draftId,
    p_verdict: verdict,
    p_reasons: o.reasons ?? [],
    p_note: o.note ?? null,
    p_invocation: o.invocation ?? null,
    p_ms_to_verdict: o.msToVerdict ?? null,
  })
  if (error) {
    const msg = friendly(error.message)
    throw /already|not in review|on the client|could not be updated|gone|not allowed/i.test(msg) ? new VerdictRefused(msg) : new Error(msg)
  }
  if (!data || typeof data !== 'object' || (data as SavedVerdict).draft_id !== draftId) throw new Error('The verdict was not saved.')
  return data as SavedVerdict
}

/**
 * Store the draft's current body as the pre-edit original (first capture wins; idempotent). Called before the
 * first edit save of a brain draft so the server can tell what Ivan changed. Throws on error: callers on the
 * save path ignore that, an edit is never blocked.
 */
export async function captureOrigin(draftId: string): Promise<void> {
  const { error } = await supabase.rpc('cb39_capture_origin', { p_draft: draftId })
  if (error) throw new Error(error.message)
}

/** Every verdict this login may read since `sinceIso` (all three lanes for Ivan). */
export async function readVerdicts(sinceIso: string | null = null): Promise<SavedVerdict[]> {
  const { data, error } = await supabase.rpc('cb39_verdicts', { p_client: null, p_since: sinceIso })
  if (error) throw new Error(friendly(error.message))
  return ((data ?? []) as SavedVerdict[]).map(v => ({ ...v, reasons: v.reasons ?? [] }))
}

export type ToJudge = { total: number; by_lane: Partial<Record<'ivan' | 'risedtc' | 'arch', number>>; newest_release: string | null }
export async function readToJudge(): Promise<ToJudge> {
  const { data, error } = await supabase.rpc('cb39_to_judge', { p_client: null })
  if (error) throw new Error(friendly(error.message))
  const r = (data ?? {}) as Partial<ToJudge>
  return { total: Number(r.total ?? 0), by_lane: r.by_lane ?? {}, newest_release: r.newest_release ?? null }
}
