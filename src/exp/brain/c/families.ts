// families.ts, candidate C's ONE map from a raw notification family key to
// everything the stream renders about it: the human label (no raw DB values on
// screen, no internal names), whether it counts as "needs you", and whether it
// is eligible to fold into the quiet row when it is carrying routine info.
//
// Source: goal-runs/inbox-brain-app-2026-09-04-out/00-notification-families.md
// (17 real families measured from 30 days of the WhatsApp self-chat feed, plus
// `chat` which is not a notification and is never looked up here).
//
// This file is the ONLY place a family key is turned into words. Every card,
// every filter chip and every quiet-row count reads it from here so a label can
// never drift between two components.

export type FamilyKey =
  | 'reply_draft_pending'
  | 'system_infra_alarm'
  | 'outreach_engine_ops'
  | 'post_generation_failed'
  | 'content_board_activity'
  | 'health_reminder'
  | 'content_sourcing_pipeline'
  | 'system_watchdog_digest'
  | 'inbound_reply_notice'
  | 'reporting_digest'
  | 'scan_quality_alert'
  | 'comment_engagement_notice'
  | 'booking_notice'
  | 'arch_build_progress'
  | 'seat_health'
  | 'draft_generation_error'
  | 'send_failed_alert'

export const FAMILY_KEYS: FamilyKey[] = [
  'reply_draft_pending', 'system_infra_alarm', 'outreach_engine_ops',
  'post_generation_failed', 'content_board_activity', 'health_reminder',
  'content_sourcing_pipeline', 'system_watchdog_digest', 'inbound_reply_notice',
  'reporting_digest', 'scan_quality_alert', 'comment_engagement_notice',
  'booking_notice', 'arch_build_progress', 'seat_health',
  'draft_generation_error', 'send_failed_alert',
]

export type FamilyMeta = {
  /** What the card says instead of the raw family key. */
  label: string
  /**
   * True for a family whose everyday instance is routine information rather
   * than a thing waiting on a decision. Only these families are candidates for
   * the quiet fold, and only their `info`-severity rows ever fold, an
   * `attention`/`error` row in the same family still needs eyes and is never
   * hidden by the toggle.
   */
  quietEligible: boolean
}

export const FAMILY_META: Record<FamilyKey, FamilyMeta> = {
  reply_draft_pending: { label: 'A reply is waiting on you', quietEligible: false },
  system_infra_alarm: { label: 'Something in your systems broke', quietEligible: false },
  outreach_engine_ops: { label: 'Outreach engine update', quietEligible: true },
  post_generation_failed: { label: 'A post failed to generate', quietEligible: false },
  content_board_activity: { label: 'Content board activity', quietEligible: true },
  health_reminder: { label: 'Personal reminder', quietEligible: true },
  content_sourcing_pipeline: { label: 'New content ideas arrived', quietEligible: true },
  system_watchdog_digest: { label: 'System check', quietEligible: true },
  inbound_reply_notice: { label: 'A lead replied', quietEligible: false },
  reporting_digest: { label: 'A report is ready', quietEligible: true },
  scan_quality_alert: { label: 'A scan needs a look', quietEligible: false },
  comment_engagement_notice: { label: 'New comment activity', quietEligible: false },
  booking_notice: { label: 'A booking came in', quietEligible: false },
  arch_build_progress: { label: 'Build update', quietEligible: true },
  seat_health: { label: 'A seat needs attention', quietEligible: false },
  draft_generation_error: { label: "A reply couldn't be drafted", quietEligible: false },
  send_failed_alert: { label: "A message didn't send", quietEligible: false },
}

/** The label a card shows. Unknown keys fall back to a plain, honest phrase, never the raw key. */
export function familyLabel(family: string): string {
  return FAMILY_META[family as FamilyKey]?.label ?? 'Update'
}

/**
 * Whether a notification (family + severity, as the view already reports them)
 * reads as something that needs a decision right now. Severity already carries
 * this, `attention`/`error` both mean a human should look, so the check is
 * on severity alone; the family only decides whether an `info` row is routine
 * enough to fold (isQuietEligible below).
 */
export function isNeedsMe(_family: string, severity: string): boolean {
  return severity !== 'info'
}

/** Whether a family+severity pair is eligible to fold into the quiet row. */
export function isQuietEligible(family: string, severity: string): boolean {
  if (severity !== 'info') return false
  return FAMILY_META[family as FamilyKey]?.quietEligible ?? false
}
