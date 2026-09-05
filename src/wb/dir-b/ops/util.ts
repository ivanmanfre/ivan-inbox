/* =========================================================================
   Ops (Direction B) — the pure helpers, copied byte for byte from
   src/screens/OpsScreen.tsx and src/exp/v2c/ReactionDesk.tsx so the three
   files in this folder share one copy instead of three.

   Nothing here reads the DOM and nothing here writes: the data layer still
   lives in ../../../lib/ops.ts and is imported from its real path.
   ========================================================================= */
import type { OpsKind } from '../../../lib/ops'

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yday'
  return `${d}d`
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// 'OUTBOUND' said what the ENGINE calls the lane, not what the card is. Ivan
// reads these as comments, so they say Comments; `comment_reply` becomes REPLY
// in the same pass so the two comment kinds cannot be told apart by an S.
export const KIND_LABEL: Record<OpsKind, string> = { escalation: 'ESC', update: 'UPDATE', newsjack: 'NEWSJACK', weekly_report: 'WEEKLY', comment_reply: 'REPLY', comment_outbound: 'COMMENTS', booking: 'BOOKED', precall_email: 'PRE-CALL', manual_invite: 'INVITE', task: 'TASK' }

// Direction B: the nine per-kind hexes are GONE. A kind is a LABEL, so every
// kind chip is the same neutral tone and the only thing that varies is the
// word. What a deck of them is CALLED still needs a plural, and only a plural:
// this is the label the collapsed deck header wears.
export const KIND_PLURAL: Record<OpsKind, string> = {
  escalation: 'escalations', update: 'updates', newsjack: 'newsjacks',
  weekly_report: 'weekly reports', comment_reply: 'replies', comment_outbound: 'comments',
  booking: 'bookings', precall_email: 'pre-call emails', manual_invite: 'invites',
  task: 'tasks',
}

// Slack channel ids are unreadable on a card. escalation/update/booking all print a
// destination, so name the ones we own and fall back to the raw id for anything else.
const CHANNEL_NAME: Record<string, string> = { C0BJ72F58BY: 'the Rise DTC channel' }
export function channelLabel(id: string): string {
  return CHANNEL_NAME[id] ?? `#${id}`
}

/* --- toasts -------------------------------------------------------------
   A card reports a finished write as plain DATA and never as markup: the
   board owns the stack, composes the source-name + detail + relative-time
   line, and is the only thing that knows a ToastStack exists. `href` is a
   link the card ALREADY carried, never a new action. */
export type OpsToast = {
  src: string
  detail: string
  actionLabel?: string
  href?: string
}
export type PushToast = (t: OpsToast) => void
