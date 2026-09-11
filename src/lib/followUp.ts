/* ==========================================================================
   src/lib/followUp.ts — "follow up on a date" for a conversation.

   Ivan, 2026-09-11 (Tessa Tysome, Cowshed: "shall we catch up when I am back
   mid October"): "needs an option to draft a follow up in x date".

   The stamp lives on outreach_prospects, in columns that already existed:
     next_touch_after = the date, skip_reason = 'follow_up_dated', and the why
     as a "[Follow-up …]" line inside operator_note (the drafter already feeds
     operator_note to the model as ground truth).
   The consumer is the RISE Reply Drafter (uee9FUFHxdRrhjMB, DATED FOLLOW-UP
   block): when the date arrives and we still spoke last, it drafts ONE
   follow-up tagged rise_reply_followup_dated_v1 (approve-first, so it lands
   back in this inbox as "AI follow-up") and clears the stamp. If the person
   writes first, the drafter releases the stamp and answers as normal.

   'follow_up_dated' is NOT a kill: no sender, detector or monitor reads that
   value as closed (checked across every active workflow on 2026-09-11). It is
   distinct from the draft snooze (snoozeDraft): that parks an EXISTING draft;
   this asks for a NEW one on a date, and works on a thread with no draft.
   ========================================================================== */
import { supabase } from './supabase'

export const FOLLOW_UP_REASON = 'follow_up_dated'

export type FollowUp = { at: string; note: string | null }

const NOTE_LINE = /^\[Follow-up [^\]]*\][^\n]*(\n|$)/gm

/** The operator note without any "[Follow-up …]" line, and the line's own text. */
export function splitFollowUpNote(note: string | null | undefined): { rest: string; line: string | null } {
  const raw = note ?? ''
  const m = raw.match(/^\[Follow-up [^\]]*\]\s*([^\n]*)/m)
  const rest = raw.replace(NOTE_LINE, '').replace(/\n{3,}/g, '\n\n').trim()
  return { rest, line: m ? (m[1].trim() || null) : null }
}

/** "[Follow-up Tue 13 Oct 2026] why" — one line the drafter reads as ground truth. */
export function followUpNoteLine(atIso: string, why: string): string {
  const d = new Date(atIso)
  const when = Number.isNaN(d.getTime()) ? atIso : d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
  const w = why.trim()
  return `[Follow-up ${when}]${w ? ' ' + w : ''}`
}

export function mergeFollowUpNote(existing: string | null | undefined, atIso: string, why: string): string {
  const { rest } = splitFollowUpNote(existing)
  const line = followUpNoteLine(atIso, why)
  return rest ? `${rest}\n\n${line}` : line
}

type Row = { next_touch_after: string | null; skip_reason: string | null; operator_note: string | null }

async function readRow(prospectId: string): Promise<Row> {
  const { data, error } = await supabase.from('outreach_prospects')
    .select('next_touch_after,skip_reason,operator_note')
    .eq('id', prospectId).single()
  if (error) throw error
  return data as Row
}

export async function fetchFollowUp(prospectId: string): Promise<FollowUp | null> {
  const r = await readRow(prospectId)
  if (r.skip_reason !== FOLLOW_UP_REASON || !r.next_touch_after) return null
  return { at: r.next_touch_after, note: splitFollowUpNote(r.operator_note).line }
}

/**
 * Stamp the date. Refuses to overwrite a skip_reason that means something else
 * (a spam verdict, a booked call, a park): those were decided elsewhere and a
 * follow-up must not silently undo them.
 */
export async function setFollowUp(prospectId: string, atIso: string, why: string): Promise<void> {
  const r = await readRow(prospectId)
  if (r.skip_reason && r.skip_reason !== FOLLOW_UP_REASON) {
    throw new Error(`This person is marked "${r.skip_reason}", clear that first`)
  }
  const { error } = await supabase.from('outreach_prospects')
    .update({
      next_touch_after: atIso,
      skip_reason: FOLLOW_UP_REASON,
      operator_note: mergeFollowUpNote(r.operator_note, atIso, why),
      operator_note_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', prospectId)
  if (error) throw error
}

/** Drop the date. Only touches a row that carries OUR stamp. */
export async function clearFollowUp(prospectId: string): Promise<void> {
  const r = await readRow(prospectId)
  if (r.skip_reason !== FOLLOW_UP_REASON) return
  const { rest } = splitFollowUpNote(r.operator_note)
  const { error } = await supabase.from('outreach_prospects')
    .update({
      next_touch_after: null,
      skip_reason: null,
      operator_note: rest || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', prospectId).eq('skip_reason', FOLLOW_UP_REASON)
  if (error) throw error
}
