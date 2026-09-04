// families.ts — candidate b's ONE map from a raw notification family key to
// everything the feed draws off it: a human label, which lane a card's "Open
// in ___" button points at, and a short bold STATE WORD pulled out of the
// body.
//
// This is the file the brief's hard constraint points at: "every family gets
// a human label in ONE map in your folder" and "no raw DB values
// (claude_turn, reply_draft_pending, dm_sent) on screen". Every export here is
// pure and covers exactly the 17 families + `chat` from
// 00-notification-families.md.
//
// THE THESIS THIS FILE SERVES: "the state word is the hero." A feed card does
// not lead with the family name or the producer — it leads with the one word
// that says what changed: HALTED, replied, booked, failed, running again. This
// file is where that word gets made, and it is made SANELY: never a raw enum
// straight off a body (seat_health's own corpus prints "OK -> PARENT_CONNECTING"
// verbatim, and that string must never reach the screen), never invented out of
// nothing (an outreach line that says nothing about halting must not print
// "Halted").

import type { Job } from '../../v2c/layout'
import type { Notification, NotificationSeverity } from '../../../lib/turns'

export type FamilyKey =
  | 'reply_draft_pending' | 'system_infra_alarm' | 'outreach_engine_ops'
  | 'post_generation_failed' | 'content_board_activity' | 'health_reminder'
  | 'content_sourcing_pipeline' | 'system_watchdog_digest' | 'inbound_reply_notice'
  | 'reporting_digest' | 'scan_quality_alert' | 'comment_engagement_notice'
  | 'booking_notice' | 'arch_build_progress' | 'seat_health'
  | 'draft_generation_error' | 'send_failed_alert' | 'chat'

// ---------------------------------------------------------------------------
// 1. The human label. What "family" printed on screen actually says.
// ---------------------------------------------------------------------------
export const FAMILY_LABEL: Record<FamilyKey, string> = {
  reply_draft_pending: 'Reply waiting on you',
  system_infra_alarm: 'Something broke',
  outreach_engine_ops: 'Outreach engine',
  post_generation_failed: 'Post generation failed',
  content_board_activity: 'Content board activity',
  health_reminder: 'Reminder',
  content_sourcing_pipeline: 'New material sourced',
  system_watchdog_digest: 'System check',
  inbound_reply_notice: 'New reply',
  reporting_digest: 'Report ready',
  scan_quality_alert: 'Scan needs a look',
  comment_engagement_notice: 'New comment',
  booking_notice: 'Booking',
  arch_build_progress: 'Build progress',
  seat_health: 'Seat health',
  draft_generation_error: 'Drafter failed',
  send_failed_alert: 'Send failed',
  chat: 'Conversation',
}

/** Any string, mapped to its human label; an unknown key falls back rather than throwing. */
export function familyLabel(family: string): string {
  return FAMILY_LABEL[family as FamilyKey] ?? 'Notification'
}

// ---------------------------------------------------------------------------
// 2. Which lane a card's "Open in ___" points at (00-notification-families.md
//    §2 "Lane (reason)" column, transcribed). `null` = no lane worth naming
//    (health_reminder is not a work notification; chat is a live thread, not
//    a card at all).
// ---------------------------------------------------------------------------
export const FAMILY_LANE: Record<FamilyKey, Job | null> = {
  reply_draft_pending: 'dms',
  system_infra_alarm: null, // "claude" in the source doc — no Job for it here, see below
  outreach_engine_ops: 'sends',
  post_generation_failed: 'content',
  content_board_activity: 'content',
  health_reminder: null,
  content_sourcing_pipeline: 'content',
  system_watchdog_digest: null,
  inbound_reply_notice: 'dms',
  reporting_digest: 'today',
  scan_quality_alert: 'ops',
  comment_engagement_notice: 'dms',
  booking_notice: 'ops',
  arch_build_progress: 'ops',
  seat_health: 'ops',
  draft_generation_error: 'dms',
  send_failed_alert: 'sends',
  chat: null,
}

// ---------------------------------------------------------------------------
// 3. Severity → drawn mark SHAPE. Colour reinforces; shape carries the
//    meaning, so a reader who cannot see colour still reads severity.
//    square = needs you · bar = error · dot = info.
// ---------------------------------------------------------------------------
export type MarkShape = 'square' | 'bar' | 'dot'

export function severityShape(sev: NotificationSeverity): MarkShape {
  if (sev === 'error') return 'bar'
  if (sev === 'attention') return 'square'
  return 'dot'
}

// ---------------------------------------------------------------------------
// 4. THE STATE WORD.
//
// Every extractor below is a NARROW regex against the verbatim examples in
// 00-notification-families.md §3, and every branch has a SAFE fallback that a
// reader would accept even if the regex missed. The one rule every branch
// obeys: never print an ALL_CAPS_WITH_UNDERSCORES token straight out of a
// body (seat_health prints "PARENT_CONNECTING" verbatim in its own corpus —
// that is the exact defect this function exists to prevent) and never invent
// a word the text does not support.
// ---------------------------------------------------------------------------

const RAW_ENUM_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/
const RAW_ENUM_RE_G = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g

/** True for a token that looks like an un-humanised DB/enum value. */
export function looksRaw(word: string): boolean {
  return RAW_ENUM_RE.test(word)
}

// Every emoji, of any kind — a card draws its own severity mark (the shaped
// bar/square/dot), so a status emoji baked into the raw body (seat_health's
// own corpus opens with one) would double it, and "no emoji as a status
// mark" is a hard constraint on everything this candidate prints.
const EMOJI_RE = /\p{Extended_Pictographic}/gu

/**
 * The one line of body text a card shows under the state word. Each pass
 * removes a WHOLE unit rather than trusting a length cut to land cleanly:
 * strip every emoji, replace the "OK -> RAW_TOKEN" transition notation
 * (seat_health's verbatim corpus) with a plain word, strip any other raw enum
 * token that slips through elsewhere in the body, and split an em dash (the
 * source corpus uses it as a clause break constantly — "RISE Warm Engager
 * HALTED — Apify MTD $120.57 >= cap $120" — and the copy rule bans it on
 * screen) into a sentence break instead. Doing all of this before the
 * 140-char slice is what guarantees the slice can never end mid-arrow: there
 * is no arrow, raw token, or dash left standing by the time it runs.
 */
export function sanitizeBody(body: string): string {
  return body
    .replace(EMOJI_RE, '')
    .replace(/OK\s*(?:→|->)\s*[A-Z][A-Z0-9_]*/g, 'disconnected')
    .replace(RAW_ENUM_RE_G, '')
    .replace(/\s*—\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/^[^\w"'[]+/, '')
    .trim()
}

function extractOutreach(body: string): string {
  if (/HALTED/i.test(body)) return 'Halted'
  if (/UNDER[- ]?(DELIVERY|FLOOR)/i.test(body)) return 'Under floor'
  if (/\bcollapse\b/i.test(body)) return 'Collapsing'
  if (/\brejected\b|\b422\b/i.test(body)) return 'Rejected'
  if (/self[- ]?heals|now runs|fixed/i.test(body)) return 'Running again'
  if (/\berror/i.test(body)) return 'Errors'
  return 'Running'
}

function extractSeatHealth(body: string): string {
  // The corpus states transitions as "OK -> CONNECTING" / "OK -> PARENT_CONNECTING"
  // / "OK -> CREDENTIALS". Any arrow whose right side is not OK is a broken
  // seat; the raw right-hand token never reaches the word itself.
  const m = body.match(/OK\s*(?:→|->)\s*([A-Z_]+)/)
  if (m) return 'Disconnected'
  if (/✅|OK\s*$/im.test(body)) return 'Reconnected'
  return 'Needs attention'
}

function extractWatchdog(body: string): string {
  if (/FAILED|failed/.test(body)) return 'Checks failed'
  if (/all\s+(?:checks?\s+)?clear/i.test(body)) return 'All clear'
  return 'Checked'
}

function extractScan(body: string): string {
  if (/BLOCKED|blocked/.test(body)) return 'Blocked'
  if (/degrading|LOW\b/i.test(body)) return 'Degrading'
  return 'Needs review'
}

function extractArchBuild(body: string): string {
  const m = body.match(/\b(staged|ready|queued|built|proven|failed|held)\b/i)
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
  return 'Progress'
}

function extractContentBoard(body: string): string {
  const m = body.match(/(\d+)\s*taps?/i)
  if (m) return `${m[1]} today`
  return 'Board updated'
}

// One state word per family, given the row's own severity as the fallback
// signal when the body has nothing more specific to say.
const FALLBACK_BY_SEVERITY: Record<NotificationSeverity, string> = {
  error: 'Failed', attention: 'Needs you', info: 'Update',
}

/**
 * The hero word for one notification. Pure, deterministic, and total: any
 * family (even one this map has never seen) resolves to a safe fallback
 * rather than throwing or printing raw text.
 */
export function stateWord(n: Pick<Notification, 'family' | 'title' | 'body' | 'severity' | 'count'>): string {
  const body = n.body ?? n.title ?? ''
  const family = n.family as FamilyKey
  let word: string
  switch (family) {
    case 'reply_draft_pending': word = n.count > 1 ? `${n.count} waiting` : 'Draft waiting'; break
    case 'system_infra_alarm': word = 'Broke'; break
    case 'outreach_engine_ops': word = extractOutreach(body); break
    case 'post_generation_failed': word = n.count > 1 ? `${n.count} failed` : 'Failed'; break
    case 'content_board_activity': word = extractContentBoard(body); break
    case 'health_reminder': word = 'Reminder'; break
    case 'content_sourcing_pipeline': word = 'New ideas'; break
    case 'system_watchdog_digest': word = extractWatchdog(body); break
    case 'inbound_reply_notice': word = n.count > 1 ? `${n.count} replied` : 'Replied'; break
    case 'reporting_digest': word = 'Ready'; break
    case 'scan_quality_alert': word = extractScan(body); break
    case 'comment_engagement_notice': word = n.count > 1 ? `${n.count} comments` : 'New comment'; break
    case 'booking_notice': word = n.count > 1 ? `${n.count} booked` : 'Booked'; break
    case 'arch_build_progress': word = extractArchBuild(body); break
    case 'seat_health': word = extractSeatHealth(body); break
    case 'draft_generation_error': word = 'Failed'; break
    case 'send_failed_alert': word = 'Send failed'; break
    case 'chat': word = 'Message'; break
    default: word = FALLBACK_BY_SEVERITY[n.severity] ?? 'Update'
  }
  // The safety net: whatever branch ran, a raw enum token never survives to
  // the screen. This also catches a family this switch does not yet know
  // about falling through to a body that itself contains a raw token.
  if (looksRaw(word)) return FALLBACK_BY_SEVERITY[n.severity] ?? 'Update'
  return word
}

/** The state word for a folded GROUP: the count itself is the hero number. */
export function groupStateWord(count: number, family: string): string {
  const label = familyLabel(family)
  return `${count} ${label.toLowerCase()}`
}
