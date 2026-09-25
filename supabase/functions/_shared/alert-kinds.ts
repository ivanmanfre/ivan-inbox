// alert-kinds.ts — one glyph, one label, one tone per KIND of alert, so a lock
// screen push tells Ivan what KIND of thing happened before he taps it.
//
// The defect this fixes (Ivan, 2026-09-25): "I see the alerts coming with the
// same emoji. Everything looks kind of the same." iOS web push shows ONLY the
// app name, the title and the body: no per-notification icon, no image. So
// distinctness has to live in the title/body TEXT this file builds, not in an
// icon nobody sees. Before this, ~30 producer families each picked their own
// ad hoc emoji (or none), and the body usually repeated the title verbatim
// (see the reminder family: title and body were byte-identical).
//
// Pure TS, no Deno/npm imports: this file is read by an edge function AND
// re-exported for the client (src/lib/alertKinds.ts), so it cannot depend on
// either runtime.
//
// Two inputs decide the KIND:
//   1. the family (a producer-chosen string, see notify.ts's PUSH_DEFAULT map
//      and integration_config.inbox_family_map for the full live roster)
//   2. the row's severity, which can UPGRADE a kind (an 'error' row is always
//      shown as failed, whatever its family's usual business is)
// plus two narrow, evidence-backed TEXT overrides (never invented: both mirror
// wording the producers themselves already use) for the two real cases where
// severity alone gets it wrong: a recovery/confirmation line filed under an
// alarm family, and an explicit "waiting on you" line filed under a digest.

export type Severity = 'info' | 'attention' | 'error'

export type Kind = 'needs_you' | 'reply' | 'failed' | 'done' | 'booking' | 'reminder' | 'seen' | 'digest'

/** Client-side tone name. Mapped to an actual `--ds-*` token by the feed UI, not here. */
export type Tone = 'accent' | 'warn' | 'danger' | 'info' | 'quiet'

export interface KindMeta {
  readonly label: string
  readonly glyph: string
  readonly tone: Tone
}

// One entry per KIND. Glyph and label are unique across every entry: the
// alert-map instrument and the test suite both assert this rather than
// trusting the table by eye.
export const ALERT_KINDS: Record<Kind, KindMeta> = {
  needs_you: { label: 'Needs you', glyph: '✋', tone: 'accent' }, // hand
  reply: { label: 'New reply', glyph: '\u{1F4AC}', tone: 'info' }, // speech balloon
  failed: { label: 'Failed', glyph: '⚠️', tone: 'danger' }, // warning
  done: { label: 'Done', glyph: '✅', tone: 'info' }, // check mark
  booking: { label: 'Booking', glyph: '\u{1F4C5}', tone: 'accent' }, // calendar
  reminder: { label: 'Reminder', glyph: '⏰', tone: 'warn' }, // alarm clock
  seen: { label: 'Page opened', glyph: '\u{1F440}', tone: 'quiet' }, // eyes
  digest: { label: 'Update', glyph: '\u{1F4CB}', tone: 'quiet' }, // clipboard
}

/**
 * The family's kind BEFORE severity is applied. Every family the 30-day
 * census showed live (2026-09-25) plus every key in PUSH_DEFAULT
 * (supabase/functions/_shared/notify.ts) that the census happened not to fire
 * that month. A family added later and never listed here still resolves,
 * through `nameFallback` below, rather than throwing.
 *
 * Judgment calls (logged so a later pass can revisit them, not guessed):
 * - `bot`: raised only when a bot turn actually carries an actionable pill
 *   (db/065, one open row per tick, see src/exp/brain/b/families.ts's own
 *   comment on the family). Every row is therefore needs_you by
 *   construction, whatever the row's own headline talks about.
 * - `scan_quality_alert`: PUSH_DEFAULT calls these "eyeball-before-send
 *   nudges", i.e. it is Ivan's own review this family exists to ask for.
 *   needs_you, not failed, even though most real rows carry severity error.
 * - `seat_health`, `lane_supply_alarm`: named explicitly as failed families
 *   in the run's own brief; kept literal even though a handful of
 *   `seat_health` rows are routine "token expires in N days" heads-up notes
 *   rather than a live break.
 * - `content_board_activity`: mostly per-post "published" / "N taps"
 *   confirmations (done), but a handful of its rows are an LM gate digest
 *   that happens to flag "(1 in error)"; those get promoted to `failed` by
 *   the severity rule below, which is directionally right (something in the
 *   batch needs a look) even though the family's normal business is `done`.
 */
const BASE_KIND: Record<string, Kind> = {
  // needs_you: a draft, a decision, or a review is waiting on Ivan
  reply_draft_pending: 'needs_you',
  bot: 'needs_you',
  scan_quality_alert: 'needs_you',

  // reply: a person outside the system said something back
  inbound_reply_notice: 'reply',
  comment_engagement_notice: 'reply',

  // failed: something broke and needs a fix, not a read
  system_infra_alarm: 'failed',
  send_failed_alert: 'failed',
  post_generation_failed: 'failed',
  draft_generation_error: 'failed',
  seat_health: 'failed',
  lane_supply_alarm: 'failed',

  // done: a thing finished, successfully, on its own
  claude_turn: 'done',
  runner_job: 'done',
  content_board_activity: 'done',

  // booking: the money event
  booking_notice: 'booking',

  // reminder: Ivan (or a standing personal cadence) set this
  reminder: 'reminder',
  health_reminder: 'reminder',

  // seen: someone opened a link Ivan is watching
  page_open_notice: 'seen',

  // digest: routine chatter, periodic reports, self-reported heartbeats
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

/**
 * A family this table has never seen, guessed from its own name. Cheap and
 * conservative: it only fires suffixes/substrings that already carry the
 * meaning everywhere else in this codebase (PUSH_DEFAULT, inbox_family_map),
 * so a genuinely new family still reads honestly rather than defaulting to
 * silence-worthy 'digest' when its name says otherwise.
 */
function nameFallback(family: string): Kind {
  const f = family.toLowerCase()
  if (/fail|error|alarm|broke|down\b/.test(f)) return 'failed'
  if (/pending|waiting|approve|needs/.test(f)) return 'needs_you'
  if (/reply|comment|reaction/.test(f)) return 'reply'
  if (/book/.test(f)) return 'booking'
  if (/remind/.test(f)) return 'reminder'
  if (/open|seen|view/.test(f)) return 'seen'
  return 'digest'
}

/**
 * The kind for one row. Severity 'error' always wins: every family this run
 * checked against its own live corpus reads correctly as failed once its
 * severity says error (including reply_draft_pending, whose error rows are
 * genuine drafter crashes, not drafts waiting on a read).
 */
export function kindFor(family: string, severity: Severity): Kind {
  if (severity === 'error') return 'failed'
  return BASE_KIND[family] ?? nameFallback(family)
}

// ---------------------------------------------------------------------------
// Text reshaping. Every function below only removes or reorders characters
// the producer already wrote; none of them invent a word.
// ---------------------------------------------------------------------------

const EMOJI_CLASS = '\\p{Extended_Pictographic}\\u200D\\uFE0F'
const LEADING_EMOJI_RE = new RegExp(`^(?:[${EMOJI_CLASS}]|\\s)+`, 'u')
const TENANT_PREFIX_RE = /^\s*\[(ARCH|RISE)\]\s*/i
const URL_RE = /https?:\/\/\S+/g
const EM_DASH_RE = /\s*—\s*/g
const LEADING_SEP_RE = /^[\s|:,>*-]+/
const TRAILING_SEP_RE = /[\s|:,-]+$/

function stripMarkdown(s: string): string {
  return s.replace(/[*_`]+/g, '')
}

function stripLeadingEmoji(s: string): string {
  return s.replace(LEADING_EMOJI_RE, '')
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** An em dash reads as a clause break; ". " keeps the sentence honest without the banned character. */
function stripEmDash(s: string): string {
  return s.replace(EM_DASH_RE, '. ')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/**
 * Pulls `[ARCH]` / `[RISE]` off the front (it names which tenant this is
 * about, so it stays), then cleans what is left: leading emoji run, markdown
 * marks, em dash, extra whitespace.
 */
function cleanSubject(rawTitle: string): string {
  const tenantMatch = rawTitle.match(TENANT_PREFIX_RE)
  const tenant = tenantMatch ? `[${tenantMatch[1].toUpperCase()}]` : ''
  const rest = tenantMatch ? rawTitle.slice(tenantMatch[0].length) : rawTitle
  const cleaned = collapseWs(stripEmDash(stripMarkdown(stripLeadingEmoji(rest))))
  return tenant ? (cleaned ? `${tenant} ${cleaned}` : tenant) : cleaned
}

/**
 * The producer's body, minus whatever prefix of it is just the title again.
 * Tries a raw match first (the common case: body === title, or body starts
 * with the exact title text), then a markdown-stripped match (the body wraps
 * the same words in `*bold*` the title does not carry) so a wrapped repeat is
 * still caught. Returns '' when the whole body was the title.
 */
function dropDuplicateTitle(rawTitle: string, rawBody: string): string {
  const titleTrim = rawTitle.trim()
  const bodyTrim = rawBody.trim()
  if (!titleTrim) return rawBody
  if (bodyTrim === titleTrim) return ''
  if (bodyTrim.startsWith(titleTrim)) return bodyTrim.slice(titleTrim.length)

  const mdTitle = collapseWs(stripMarkdown(titleTrim))
  const mdBody = stripMarkdown(bodyTrim)
  if (mdTitle && mdBody.trim() === mdTitle) return ''
  if (mdTitle && mdBody.trim().startsWith(mdTitle)) return mdBody.trim().slice(mdTitle.length)
  return rawBody
}

/** Producer wording that means the same thing everywhere it appears in this codebase's own maps. */
const DONE_TEXT_RE = /✅|\brecovered\b|\bback to normal\b|\bis live\b/i
const NEEDS_YOU_TEXT_RE = /\bwaiting on your?\b|\bneeds you\b/i

export interface PresentInput {
  family: string
  severity: Severity
  title: string
  body?: string | null
}

export interface PresentedPush {
  title: string
  body: string
}

const MAX_TITLE_CHARS = 60

/**
 * The push payload the device actually shows, reshaped from the producer's
 * own title/body so every family reads as one of a handful of KINDS instead
 * of each producer's private style. Never touches the stored
 * `inbox_notifications` row: notify.ts keeps writing `n.title` / `n.body`
 * unchanged and only feeds this function's output to `sendPush`.
 */
export function presentPush(input: PresentInput): PresentedPush {
  const { family, severity, title, body } = input
  let kind = kindFor(family, severity)

  const subject = cleanSubject(title)
  const rawBody = body ?? ''
  const combinedText = `${title} ${rawBody}`

  // Two narrow, text-backed corrections layered on top of the family/severity
  // kind. Both only fire on wording the producers already use elsewhere in
  // this codebase's own family map (see the module doc above).
  if (severity !== 'error' && DONE_TEXT_RE.test(combinedText)) kind = 'done'
  else if (severity !== 'error' && NEEDS_YOU_TEXT_RE.test(combinedText)) kind = 'needs_you'

  const meta = ALERT_KINDS[kind]

  const titleOut = truncate(subject ? `${meta.glyph} ${meta.label} · ${subject}` : `${meta.glyph} ${meta.label}`, MAX_TITLE_CHARS)

  let bodyOut = dropDuplicateTitle(title, rawBody)
  if (bodyOut.trim()) {
    bodyOut = stripLeadingEmoji(bodyOut.replace(LEADING_SEP_RE, ''))
    bodyOut = stripMarkdown(bodyOut)
    bodyOut = stripEmDash(bodyOut)
    bodyOut = bodyOut.replace(URL_RE, '')
    bodyOut = collapseWs(bodyOut).replace(TRAILING_SEP_RE, '')
    bodyOut = collapseWs(bodyOut)
  }
  if (!bodyOut) bodyOut = subject || meta.label

  // Body must never repeat the title verbatim: the one complaint this file
  // exists to fix. If reshaping still landed on the exact title string
  // (nothing left to differentiate it), fall back to the kind label alone.
  if (bodyOut === titleOut || bodyOut === title.trim()) bodyOut = meta.label

  return { title: titleOut, body: bodyOut }
}
