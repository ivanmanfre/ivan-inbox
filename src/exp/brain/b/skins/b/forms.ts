// forms.ts — skin `b`, "Cards with a form".
//
// THE THESIS: a notification's FORM says what it is before a word is read.
// Six forms carry seventeen families:
//
//   quote  a person said something          (a rule down the left of their line)
//   time   something is on the calendar     (a time figure beside a person)
//   strip  something broke                  (a solid bar flush to the card edge)
//   page   a document you can go back into  (an inset panel that fades out)
//   tile   a thing has a state              (label left, state right)
//   deck   more than one of these           (a visible second edge + a count)
//
// This module is the PURE half: which form a family takes, whether the card
// sits raised or flat, and the few fields each form needs pulled out of a row
// whose body is a WhatsApp message someone wrote for a phone, not for a card.
// Everything here is testable without a DOM (forms.test.ts).
//
// It reads the shared `families.ts` for the state word, the human label, the
// lane and the body sanitiser rather than re-deciding any of that: the state
// word is still the thing a card says, this file only decides the SHAPE it is
// said in.

import type { Notification, NotificationSeverity } from '../../../../../lib/turns'
import { familyLabel, sanitizeBody, stateWord } from '../../families'

export type CardForm = 'quote' | 'time' | 'strip' | 'page' | 'tile'

/**
 * Family to form. The default is `tile`, which is the honest shape for
 * "something has a state and here it is" — the largest group, and the one a
 * new family should fall into rather than into a shape that promises a quote
 * or a calendar entry the row does not carry.
 */
const FORM: Record<string, CardForm> = {
  reply_draft_pending: 'quote',
  inbound_reply_notice: 'quote',
  comment_engagement_notice: 'quote',

  booking_notice: 'time',

  system_infra_alarm: 'strip',
  send_failed_alert: 'strip',
  draft_generation_error: 'strip',
  post_generation_failed: 'strip',
  scan_quality_alert: 'strip',

  claude_turn: 'page',
  reporting_digest: 'page',

  outreach_engine_ops: 'tile',
  content_board_activity: 'tile',
  health_reminder: 'tile',
  content_sourcing_pipeline: 'tile',
  system_watchdog_digest: 'tile',
  arch_build_progress: 'tile',
  seat_health: 'tile',
  chat: 'tile',
}

export function formFor(family: string): CardForm {
  return FORM[family] ?? 'tile'
}

/**
 * SEVERITY BY POSITION. A card that needs him sits on the raised plate at full
 * width; a card that is only telling him something lies flat and inset, so a
 * narrower column literally means a quieter card. This survives a greyscale
 * print, which colour alone does not.
 */
export function raised(sev: NotificationSeverity): boolean {
  return sev === 'attention' || sev === 'error'
}

// ---------------------------------------------------------------------------
// The quote form.
//
// Three families carry someone's words, and all three write them differently:
//
//   reply_draft_pending  "…drafted for Alec Lorenzo (ICP 7, silent 8d):\n\nAlec -- Want to…"
//   inbound_reply_notice "…new inbound reply…:\n\n• Alec Lorenzo — RISE lane:\n  \"Yes\""
//   comment_engagement   "1 new comment on Davorin's posts (ARCH):\n\nAnna Romaniuk: \"And then you…\""
//
// So: the QUOTE is whatever is inside double quotes when there is such a run,
// otherwise whatever follows the last blank line. The SUBJECT is the person
// the row is about, read from the line that introduces the quote, and only
// then from the title. Neither is ever invented: both return null rather than
// guess, and the card falls back to the body line when they do.
// ---------------------------------------------------------------------------

/** A run of at least two characters inside straight or curly double quotes. */
const QUOTED = /[""]([^""]{2,})[""]/g

/**
 * A human-looking name: two to four words, each a capital followed by lower
 * case. The lower-case requirement is what keeps "RISE DTC" and "GOOD
 * RANCHERS" out of the attribution slot — a corpus body shouts its tenant and
 * its brands in caps, and neither of them said anything.
 */
const NAME = /\b([A-Z][\p{Ll}'’-]+(?:\s+[A-Z][\p{Ll}'’-]+){1,3})\b/u

function longestQuoted(text: string): string | null {
  let best: string | null = null
  for (const m of text.matchAll(QUOTED)) {
    if (best === null || m[1].length > best.length) best = m[1]
  }
  return best ? best.trim() : null
}

/** Strip the leading bullet, dash or whitespace a WhatsApp line starts with. */
function delist(line: string): string {
  return line.replace(/^[\s•*\-–—]+/, '').trim()
}

/**
 * A standalone double dash is how the corpus writes a sentence break, and both
 * it and an em dash are banned on screen. The quote keeps every word and mends
 * the punctuation, which is what `sanitizeBody` already does for an em dash it
 * finds mid-body.
 */
function mendDashes(text: string): string {
  // Only the dash becomes a full stop. A blanket ".." collapse afterwards ate
  // the ellipsis in "And then you, as the client...", which is the writer's
  // own punctuation and not ours to tidy.
  return text.replace(/([^\s])\s+(?:--+|\u2014|\u2013)\s+/g, (_m, c: string) => (/[.!?,;:]/.test(c) ? `${c} ` : `${c}. `))
}

export function quoteCard(n: { family: string; title: string | null; body: string | null }): { quote: string | null; subject: string | null } {
  // Sanitised LINE BY LINE: `sanitizeBody` folds a body onto one line, and the
  // line breaks are the only thing separating a WhatsApp preamble from the
  // words someone actually said.
  const lines = (n.body ?? '').split('\n').map(l => sanitizeBody(l).trim()).filter(Boolean)
  const body = lines.join('\n')

  const quoted = longestQuoted(body)
  let quote: string | null = quoted
  if (!quote) {
    // No quotation marks: the last non-empty line of a body that has more than
    // one line is the message; a single-line body has no separable quote and
    // the card prints the body itself.
    quote = lines.length > 1 ? delist(lines[lines.length - 1]) : (lines[0] ?? null)
  }

  // The subject is the person the quote belongs to. The line that carries the
  // quote usually introduces them ("Anna Romaniuk: \"…\"", "• Ben Spell (GOOD
  // RANCHERS): \"…\""); a draft names them in the title ("…drafted for Alec
  // Lorenzo (ICP 7…)").
  let subject: string | null = null
  const at = quoted === null ? -1 : lines.findIndex(l => l.includes(quoted))
  if (at >= 0) {
    // Walk back from the quote: its own line first ("Anna Romaniuk: …"), then
    // the line that introduced it ("• Alec Lorenzo, RISE lane:").
    for (let i = at; i >= 0 && i >= at - 2 && !subject; i--) {
      const before = delist((i === at ? lines[i].split(/[\u201c\u201d"]/)[0] : lines[i]) ?? '')
      subject = before.match(NAME)?.[1] ?? null
    }
  }
  if (!subject) {
    const forName = (n.title ?? '').match(/\b(?:for|to|from)\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,3})/u)
    subject = forName?.[1] ?? null
  }
  if (!subject) {
    // A bulleted line that names someone before a dash or a bracket.
    for (const l of lines) {
      const d = delist(l)
      if (!/^[A-Z]/.test(d)) continue
      const m = d.match(NAME)
      if (m && m[1] !== quote) { subject = m[1]; break }
    }
  }
  if (quote) quote = mendDashes(quote).trim()
  if (subject && quote && subject === quote) subject = null
  return { quote: quote || null, subject }
}

// ---------------------------------------------------------------------------
// The time form. The figure is the row's own clock — the corpus row carries no
// separate booking time, and inventing one would be inventing a fact.
// ---------------------------------------------------------------------------

export function dayWord(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (a: Date) => `${a.getFullYear()}-${a.getMonth()}-${a.getDate()}`
  if (day(d) === day(now)) return 'Today'
  const y = new Date(now.getTime() - 86_400_000)
  if (day(d) === day(y)) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short' })
}

export function timeCard(n: { title: string | null; body: string | null }): { who: string | null } {
  const body = n.body ? sanitizeBody(n.body) : ''
  for (const raw of body.split('\n')) {
    const l = delist(raw)
    // The attribution line is the one that names a person beside a seat.
    if (!/^[A-Z]/.test(l)) continue
    const m = l.match(NAME)
    if (m) return { who: m[1] }
  }
  return { who: (n.title ?? '').match(NAME)?.[1] ?? null }
}

// ---------------------------------------------------------------------------
// The tile form. Label on the left is WHAT, state on the right is HOW IT IS.
// The label is the row's own subject when it has one (a seat's name, a lane's
// name) and the family's human label otherwise, because "Seat health / Seat
// Mattan Danino" is the same word twice.
// ---------------------------------------------------------------------------

export function tileCard(n: Pick<Notification, 'family' | 'title' | 'body' | 'severity' | 'count'>): { label: string; state: string } {
  const state = stateWord(n)
  const title = (n.title ?? '').trim()
  const label = title && title.length <= 42 && title.toLowerCase() !== state.toLowerCase()
    ? title
    : familyLabel(n.family)
  return { label, state }
}

// ---------------------------------------------------------------------------
// The page form.
//
// E5 reads a card with its body element removed and still has to name the
// state, so the state word lives OUTSIDE the snippet: "Answered" (or "The turn
// failed", or "Report ready") is its own line above the panel, and the panel
// carries the answer's own prose with its first sentence at full contrast.
// ---------------------------------------------------------------------------

export function pageCard(n: Pick<Notification, 'family' | 'title' | 'body' | 'severity' | 'count'>): { state: string; snippet: string | null; asked: string | null } {
  const isTurn = n.family === 'claude_turn'
  const state = isTurn
    ? (n.severity === 'error' ? 'The turn failed' : 'Answered')
    : stateWord(n)
  const snippet = n.body ? sanitizeBody(n.body).slice(0, 240) : null
  // Only a turn stores the prompt in `title`; on every other family the title
  // is a headline for the same text the snippet already carries.
  const asked = isTurn && n.title?.trim() ? n.title.trim() : null
  return { state, snippet: snippet || null, asked }
}

// ---------------------------------------------------------------------------
// Media chips. A file size a person reads, not a byte count.
// ---------------------------------------------------------------------------
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
