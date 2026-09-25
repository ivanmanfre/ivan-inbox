/* ==========================================================================
   src/wb/ask/alertLook.ts: how each KIND of alert looks in the feed.

   Ivan, 2026-09-25: "I see the alerts coming with the same emoji. Everything
   looks kind of the same."

   The KIND map (family + severity -> kind) is the one the push payload uses:
   `supabase/functions/_shared/alert-kinds.ts`, re-exported for the client as
   `src/lib/alertKinds.ts` by the alert-presenter builder. That file was not on
   main when this screen was built, so the resolver is mirrored here with the
   same 8 kinds, the same family table and the same severity rule. When
   `src/lib/alertKinds.ts` lands, `kindOf` below should import `kindFor` from it
   and the local table goes (one definition, no drift).

   What this file adds and the push cannot carry: a drawn glyph (a named ds
   icon, never an emoji), a tile tone and a label, so kinds read apart by
   shape + tone + word before any text is read.
   ========================================================================== */
import type { IconName } from '../../ds'

export type AlertKind = 'needs_you' | 'reply' | 'failed' | 'done' | 'booking' | 'reminder' | 'seen' | 'digest'

/** The tile tone. Mapped onto `--ds-*` tokens in claude.css, never a literal here. */
export type AlertTone = 'attention' | 'urgent' | 'clear' | 'ink' | 'ring' | 'outline' | 'quiet'

export interface AlertLook {
  readonly label: string
  readonly icon: IconName
  readonly tone: AlertTone
  /** Routine kinds fold into one group at the end of the sheet. */
  readonly routine: boolean
}

export const ALERT_LOOK: Record<AlertKind, AlertLook> = {
  needs_you: { label: 'Needs you', icon: 'person', tone: 'attention', routine: false },
  failed: { label: 'Failed', icon: 'alert', tone: 'urgent', routine: false },
  reply: { label: 'New reply', icon: 'dms', tone: 'ink', routine: false },
  booking: { label: 'Booking', icon: 'calendar', tone: 'ring', routine: false },
  reminder: { label: 'Reminder', icon: 'time', tone: 'outline', routine: false },
  done: { label: 'Done', icon: 'approve', tone: 'clear', routine: false },
  seen: { label: 'Page opened', icon: 'eye', tone: 'quiet', routine: false },
  digest: { label: 'Update', icon: 'list', tone: 'quiet', routine: true },
}

// Mirrors BASE_KIND in supabase/functions/_shared/alert-kinds.ts (2026-09-25).
const BASE_KIND: Record<string, AlertKind> = {
  reply_draft_pending: 'needs_you',
  bot: 'needs_you',
  scan_quality_alert: 'needs_you',
  inbound_reply_notice: 'reply',
  comment_engagement_notice: 'reply',
  system_infra_alarm: 'failed',
  send_failed_alert: 'failed',
  post_generation_failed: 'failed',
  draft_generation_error: 'failed',
  seat_health: 'failed',
  lane_supply_alarm: 'failed',
  claude_turn: 'done',
  runner_job: 'done',
  content_board_activity: 'done',
  booking_notice: 'booking',
  reminder: 'reminder',
  health_reminder: 'reminder',
  page_open_notice: 'seen',
  system_watchdog_digest: 'digest',
  outreach_engine_ops: 'digest',
  content_sourcing_pipeline: 'digest',
  reporting_digest: 'digest',
  arch_build_progress: 'digest',
  lane_run_summary: 'digest',
  night_brief: 'digest',
  thursday_brief: 'digest',
  ops_other: 'digest',
  chat: 'digest',
  runner_sync: 'digest',
  smoke_push: 'digest',
  smoke_test: 'digest',
  relay_smoke: 'digest',
}

function nameFallback(family: string): AlertKind {
  const f = family.toLowerCase()
  if (/fail|error|alarm|broke|down\b/.test(f)) return 'failed'
  if (/pending|waiting|approve|needs/.test(f)) return 'needs_you'
  if (/reply|comment|reaction/.test(f)) return 'reply'
  if (/book/.test(f)) return 'booking'
  if (/remind/.test(f)) return 'reminder'
  if (/open|seen|view/.test(f)) return 'seen'
  return 'digest'
}

/** The kind for one row. Severity 'error' always wins, same as the push. */
export function kindOf(family: string, severity: string | null | undefined): AlertKind {
  if (severity === 'error') return 'failed'
  return BASE_KIND[family] ?? nameFallback(family)
}

export function lookOf(family: string, severity: string | null | undefined): AlertLook & { kind: AlertKind } {
  const kind = kindOf(family, severity)
  return { kind, ...ALERT_LOOK[kind] }
}
