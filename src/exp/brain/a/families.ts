// families.ts - the ONE map from a notification's `family` column to what a
// human reads on the dense feed row: a plain-words label and where "Open in
// X" takes you. Nothing here reads the raw family key on screen; nothing here
// invents a destination a family does not have.
//
// Source: goal-runs/inbox-brain-app-2026-09-04-out/00-notification-families.md
// (the 30-day WhatsApp self-chat inventory). 17 real families, plus `chat`
// (a live conversation, not a notification, kept here so a stray row never
// prints a raw key). Severity is NOT re-derived here - the row's own
// `severity` column (info/attention/error) already carries it; this map only
// answers "what is this family called" and "where does it go".
import type { Job } from '../../v2c/layout'
import { JOB_LABEL } from '../../v2c/layout'

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
  | 'chat'

export type FamilyMeta = {
  key: FamilyKey
  /** What the feed prints, in small caps via CSS - never the raw key. */
  label: string
  /** Where a tap on this family's card lands, or null when there is no in-app screen for it. */
  lane: Job | null
}

// `lane: null` on system_infra_alarm / system_watchdog_digest is deliberate:
// both name a terminal/automation fix, not a screen this app has. health_reminder
// is not a work notification at all (families doc §2). `chat` is a live
// conversation and routes to Ask, which is not a Job - handled by the caller.
export const FAMILIES: Record<FamilyKey, FamilyMeta> = {
  reply_draft_pending: { key: 'reply_draft_pending', label: 'Reply waiting on you', lane: 'dms' },
  system_infra_alarm: { key: 'system_infra_alarm', label: 'System error', lane: null },
  outreach_engine_ops: { key: 'outreach_engine_ops', label: 'Outreach engine', lane: 'sends' },
  post_generation_failed: { key: 'post_generation_failed', label: 'Post generation failed', lane: 'content' },
  content_board_activity: { key: 'content_board_activity', label: 'Board activity', lane: 'content' },
  health_reminder: { key: 'health_reminder', label: 'Health reminder', lane: null },
  content_sourcing_pipeline: { key: 'content_sourcing_pipeline', label: 'New material', lane: 'content' },
  system_watchdog_digest: { key: 'system_watchdog_digest', label: 'System check', lane: null },
  inbound_reply_notice: { key: 'inbound_reply_notice', label: 'New reply', lane: 'dms' },
  reporting_digest: { key: 'reporting_digest', label: 'Report ready', lane: 'today' },
  scan_quality_alert: { key: 'scan_quality_alert', label: 'Scan alert', lane: 'ops' },
  comment_engagement_notice: { key: 'comment_engagement_notice', label: 'Comment activity', lane: 'dms' },
  booking_notice: { key: 'booking_notice', label: 'New booking', lane: 'ops' },
  arch_build_progress: { key: 'arch_build_progress', label: 'Build progress', lane: 'ops' },
  seat_health: { key: 'seat_health', label: 'Seat health', lane: 'ops' },
  draft_generation_error: { key: 'draft_generation_error', label: 'Draft failed', lane: 'dms' },
  send_failed_alert: { key: 'send_failed_alert', label: 'Send failed', lane: 'sends' },
  chat: { key: 'chat', label: 'Conversation', lane: null },
}

export const FAMILY_KEYS = Object.keys(FAMILIES) as FamilyKey[]

function isFamilyKey(k: string): k is FamilyKey {
  return Object.hasOwn(FAMILIES, k)
}

/** The label a card prints. A family this map has never seen still gets a
 * calm, readable words - never the raw snake_case key on screen. */
export function familyLabel(key: string): string {
  if (isFamilyKey(key)) return FAMILIES[key].label
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Where a card's "Open in X" points, or null when the family has none. */
export function familyLane(key: string): Job | null {
  return isFamilyKey(key) ? FAMILIES[key].lane : null
}

/** The button text for a family's destination, or null. Reads JOB_LABEL so a
 * future rename of a job's human name is never duplicated here. */
export function familyLaneLabel(key: string): string | null {
  const lane = familyLane(key)
  return lane ? `Open in ${JOB_LABEL[lane]}` : null
}
