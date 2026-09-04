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
import type { NotificationSeverity } from '../../../lib/turns'

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
  | 'claude_turn'

export type FamilyMeta = {
  key: FamilyKey
  /** What the feed prints, in small caps via CSS - never the raw key. */
  label: string
  /** Where a tap on this family's card lands, or null when there is no in-app screen for it. */
  lane: Job | null
  /**
   * Who the family is FOR, straight off the inventory's own severity column
   * (families doc section 2), so the eyebrow word stops inverting the doc:
   * - 'you'    a person has to act on this one (a reply, a booking, a dead seat)
   * - 'system' something broke that gets fixed by hand, not on a screen here
   * - 'fyi'    material and recaps that never asked for anything
   */
  needs: 'you' | 'system' | 'fyi'
}

// `lane: null` on system_infra_alarm / system_watchdog_digest is deliberate:
// both name a terminal/automation fix, not a screen this app has. health_reminder
// is not a work notification at all (families doc §2). `chat` is a live
// conversation and routes to Ask, which is not a Job - handled by the caller.
export const FAMILIES: Record<FamilyKey, FamilyMeta> = {
  reply_draft_pending: { key: 'reply_draft_pending', label: 'Reply waiting on you', lane: 'dms', needs: 'you' },
  system_infra_alarm: { key: 'system_infra_alarm', label: 'System error', lane: null, needs: 'system' },
  outreach_engine_ops: { key: 'outreach_engine_ops', label: 'Outreach engine', lane: 'sends', needs: 'you' },
  post_generation_failed: { key: 'post_generation_failed', label: 'Post generation failed', lane: 'content', needs: 'you' },
  content_board_activity: { key: 'content_board_activity', label: 'Board activity', lane: 'content', needs: 'fyi' },
  health_reminder: { key: 'health_reminder', label: 'Health reminder', lane: null, needs: 'fyi' },
  content_sourcing_pipeline: { key: 'content_sourcing_pipeline', label: 'New material', lane: 'content', needs: 'fyi' },
  system_watchdog_digest: { key: 'system_watchdog_digest', label: 'System check', lane: null, needs: 'system' },
  inbound_reply_notice: { key: 'inbound_reply_notice', label: 'New reply', lane: 'dms', needs: 'you' },
  reporting_digest: { key: 'reporting_digest', label: 'Report ready', lane: 'today', needs: 'fyi' },
  scan_quality_alert: { key: 'scan_quality_alert', label: 'Scan alert', lane: 'ops', needs: 'you' },
  comment_engagement_notice: { key: 'comment_engagement_notice', label: 'Comment activity', lane: 'dms', needs: 'you' },
  booking_notice: { key: 'booking_notice', label: 'New booking', lane: 'ops', needs: 'you' },
  arch_build_progress: { key: 'arch_build_progress', label: 'Build progress', lane: 'ops', needs: 'you' },
  seat_health: { key: 'seat_health', label: 'Seat health', lane: 'ops', needs: 'you' },
  draft_generation_error: { key: 'draft_generation_error', label: 'Draft failed', lane: 'dms', needs: 'you' },
  send_failed_alert: { key: 'send_failed_alert', label: 'Send failed', lane: 'sends', needs: 'you' },
  chat: { key: 'chat', label: 'Conversation', lane: null, needs: 'fyi' },
  // A turn finished OR FAILED while he was away, pushed by inbox-turn-run.
  // Its own `url` carries the thread/turn deep link, not a Job, so lane is
  // null the same way `chat` is - this still routes correctly on tap because
  // notificationDeepLink reads the row's url, never the lane. This is the one
  // family whose audience is not fixed: an answer that landed asks for
  // nothing, a turn that failed asks him to send it again, and the row's own
  // severity is what separates them (see familySectionLabel/familyEyebrow).
  claude_turn: { key: 'claude_turn', label: 'Claude answered', lane: null, needs: 'fyi' },
}

export const FAMILY_KEYS = Object.keys(FAMILIES) as FamilyKey[]

function isFamilyKey(k: string): k is FamilyKey {
  return Object.hasOwn(FAMILIES, k)
}

/** The label a card prints. A family this map has never seen still gets a
 * calm, readable sentence - never the raw snake_case key, never shouted
 * title case, on screen. */
export function familyLabel(key: string): string {
  if (isFamilyKey(key)) return FAMILIES[key].label
  const words = key.replace(/_/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Notice'
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

/**
 * The eyebrow word on a card. Reads the family's own audience first and the
 * row's severity second, so `system_infra_alarm` (which the inventory routes
 * to a fix by hand) stops printing "Needs you" at a person who has no screen
 * to act on. `info` is silent: the common case carries no word at all.
 */
export function familyEyebrow(key: string, severity: NotificationSeverity): string | null {
  if (severity === 'info') return null
  // `claude_turn` reads its audience off the ROW, not off the map: the only
  // way this family is ever non-info is a turn that did not land, and a turn
  // that did not land is waiting on him to send it again.
  if (key === 'claude_turn') return 'Needs you'
  const needs = isFamilyKey(key) ? FAMILIES[key].needs : 'fyi'
  if (needs === 'system') return 'Fix by hand'
  if (needs === 'you') return 'Needs you'
  return 'Worth a look'
}

/**
 * The label the SECTION header prints. Same as `familyLabel` everywhere except
 * `claude_turn`, where "Claude answered" is a claim the rows underneath can
 * contradict: a section holding "The turn failed." must not be headed by a
 * sentence saying it answered. When anything in the section is not info, the
 * header names the place instead of the outcome, and the card's own headline
 * and eyebrow carry what happened.
 */
export function familySectionLabel(key: string, worst: NotificationSeverity): string {
  if (key === 'claude_turn' && worst !== 'info') return 'Ask thread'
  return familyLabel(key)
}

/** The loudest severity in a set of rows: error beats attention beats info. */
export function worstSeverity(severities: NotificationSeverity[]): NotificationSeverity {
  if (severities.includes('error')) return 'error'
  if (severities.includes('attention')) return 'attention'
  return 'info'
}

// The producers write WhatsApp bodies: leading status emoji, `**bold**`,
// backticked paths, markdown links. A headline printed straight off one of
// those reads as source code on the card, so every line that reaches the
// screen goes through here first.
const LEAD_MARKS = /^(?:[\p{Extended_Pictographic}\u{FE0F}\u{2022}\u{00B7}\s])+/u

// Four more passes, measured over the 30-day corpus rather than guessed. A
// status emoji anywhere in the line doubles the card's own drawn mark, an
// enum token (HALTED_BY_CAP) and a column name (post_generation_failed) are
// names the machine gave itself, and the producers use an em dash as a clause
// break constantly while the copy rule bans it on screen.
const EMOJI = /\p{Extended_Pictographic}\u{FE0F}?/gu
const UPPER_ENUM = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g
const SNAKE = /(?<![\w/.:-])[a-z]+(?:_[a-z]+)+(?![\w/.-])/g

/** The first real line of a body, with the markdown, the status emoji and the machine's own tokens taken off. Pure. */
export function plainHeadline(raw: string | null | undefined): string {
  // The first line that still says something once cleaned: an answer that opens
  // with a numbered list ("1", "2", ...) or a lone status glyph is not a headline
  // (cycle 2: two feed cards read "1"). Fall back to the first non-empty line so a
  // body that is only digits still prints rather than vanishing.
  const lines = (raw ?? '').split('\n').map(l => l.trim()).filter(l => l.length > 0)
  for (const line of lines.slice(0, 6)) {
    const c = cleanHeadlineLine(line)
    if (c.length >= 3 && /[A-Za-z]/.test(c)) return c
  }
  return cleanHeadlineLine(lines[0] ?? '')
}

function cleanHeadlineLine(first: string): string {
  let s = first
  s = s.replace(/^```+[\w-]*\s*/, '')
  s = s.replace(/^#{1,6}\s+/, '')
  s = s.replace(/^>\s+/, '')
  s = s.replace(/^[-*+]\s+/, '')
  s = s.replace(/^\d+[.)]\s+/, '')
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/`+([^`]*)`+/g, '$1')
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2')
  s = s.replace(/~~(.+?)~~/g, '$1')
  // The machine's own tokens go BEFORE the italic passes: `_` is both an
  // italic marker and the middle of HALTED_BY_CAP, and running italics first
  // turns that token into HALTEDBYCAP, which no scan for an enum would catch.
  s = s.replace(EMOJI, '')
  s = s.replace(UPPER_ENUM, '')
  s = s.replace(SNAKE, '')
  s = s.replace(/\*([^*\n]+)\*/g, '$1')
  s = s.replace(/_([^_\n]+)_/g, '$1')
  s = s.replace(LEAD_MARKS, '')
  s = s.replace(/\s*—\s*/g, '. ')
  s = s.replace(/\s+/g, ' ')
  // Whatever the four passes left standing at the front is punctuation with
  // nothing in front of it, so a headline never opens on a colon or a dash.
  s = s.replace(/^[^\w"'[(]+/, '')
  return s.replace(/\s+([.,;:!?])/g, '$1').trim()
}

/**
 * Whether a folded group is a first sighting, the same situation reported
 * again, or the situation moving to a different state. The inventory defines
 * this per family as "same entity = repeat, new entity or a transition = state
 * change"; the shared fold already keys on the title with its numbers taken
 * out, so a title whose SHAPE moved is the transition and everything else is
 * the same thing said twice.
 */
export type GroupChange = 'first' | 'again' | 'changed'

const titleShape = (t: string): string =>
  plainHeadline(t).replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

export function groupChange(
  latestTitle: string,
  previousTitle: string | null | undefined,
  count: number,
  items: number,
): GroupChange {
  if (items <= 1 && count <= 1) return 'first'
  if (previousTitle && titleShape(latestTitle) !== titleShape(previousTitle)) return 'changed'
  return 'again'
}


/**
 * A ledger clock: "now", "4m", "3h", "2d", "5w". The shared `relAge` says
 * "4m ago", which costs the row about 35px of the 390 it has - and in a column
 * where every cell is a time, the word "ago" is said once by the column, not
 * once per row. Pure, so the reading is testable without a clock.
 */
export function shortAge(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  return `${Math.round(d / 7)}w`
}
