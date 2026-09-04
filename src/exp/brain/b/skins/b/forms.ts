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
import { answerHeadline, familyLabel, sanitizeBody, stateWord } from '../../families'

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

/** Anything a phone would call an emoji. */
const PICTOGRAPH = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/u

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
  if (quote) quote = mendDashes(deShout(quote)).trim()
  // A reply that WAS a pictograph. `sanitizeBody` strips every emoji before the
  // quote is read, so a thumbs-up sent on its own arrived here as an empty
  // string and the card quoted a person saying nothing. Say what happened
  // instead: he reacted.
  if (!quote) {
    const raw = (n.body ?? '').split('\n').map(l => l.trim()).filter(Boolean)
    const rawQuoted = longestQuoted(raw.join('\n')) ?? raw[raw.length - 1] ?? ''
    if (PICTOGRAPH.test(rawQuoted)) quote = 'reacted'
  }
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
  const snippet = n.body ? clip(deShout(sanitizeBody(n.body)), 240) : null
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

// ---------------------------------------------------------------------------
// THE SUBJECT — who or what a row is about. Cycle 1.
//
// Three seats named the same defect: an error strip that prints "Send failed"
// and nothing else is a card that has not said the one thing worth reading.
// Every form now carries `state · subject` on its headline, so a row names its
// person (a reply, a comment, a booking, a seat) or its thing (a workflow, a
// lane, a domain) in the card's own largest type.
//
// The ladder, in order, and it returns null rather than guessing:
//   1. a person named after "for / to / from / with", in the title then the body
//   2. the title with the state word and its connective tail removed
//   3. nothing
// ---------------------------------------------------------------------------

const AFTER_PREP = /\b(?:for|to|from|with|on)\s+([A-Z][\p{Ll}'’-]+(?:\s+[A-Z][\p{Ll}'’-]+){0,3})\b/u

/** Words that are the state, not the subject, and that a title trails with. */
const TAIL = /\s*(?:\b(?:failed|failure|error|errors|halted|blocked|broke|broken|down|ready|is|was|has|have)\b[\s.:,-]*)+$/i
const HEAD = /^(?:\s*(?:re|new|the)\b[\s:-]*)+/i
/** A clause word: everything from here on is what HAPPENED, not what it is. */
const CLAUSE = /\s+\b(?:needs?|requires?|is|was|were|are|has|have|had|that|which|and|but|so|because|after|before|while|when|on|at|with|from|into|over|under)\b.*$/i

/** Stems, so "ideas" and "Idea" count as the same word. */
function stems(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter(w => w.length > 3).map(w => w.slice(0, 4)))
}

function sharesWords(a: string, b: string): boolean {
  const wa = stems(a)
  return [...stems(b)].some(w => wa.has(w))
}

/**
 * A producer SHOUTS. "Send FAILED (verified not delivered)" and "Idea Supply
 * LOW" are the same words a person would write, with the caps lock on and a
 * bracket where a comma belongs. `sanitizeBody` only strips a shouted token
 * that carries an UNDERSCORE, so every one of these came through untouched.
 *
 * This lowercases a shouted run that is not a known initialism, turns a
 * parenthetical into a clause, and mends a double dash. It never invents a
 * word and it never drops one.
 */
const KEEP_CAPS = new Set([
  'RISE', 'ARCH', 'DTC', 'DM', 'DMS', 'ICP', 'LM', 'AI', 'API', 'URL', 'PDF', 'UTC', 'PT', 'OK', 'ID', 'CEO',
])

export function deShout(text: string): string {
  return text
    // "(verified not delivered)" reads as an aside; a comma says the same thing
    // without asking him to parse brackets on a 390px card.
    .replace(/\s*\(([^)]{3,60})\)/g, (_m, inner: string) => `, ${inner}`)
    // A run of two or more capitals that is not an initialism we keep.
    .replace(/\b[A-Z][A-Z0-9]{1,}\b/g, (w: string) => (KEEP_CAPS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .replace(/([^\s])\s+(?:--+|—|–)\s+/g, (_m, c: string) => (/[.!?,;:]/.test(c) ? `${c} ` : `${c}. `))
    .replace(/\s*,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Never cut a word in half, and always mark a cut that happened. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s.,;:·-]+$/, '')}…`
}

type SubjectRow = Pick<Notification, 'family' | 'title' | 'body' | 'severity' | 'count'>

/**
 * A subject has to be a NAME, not a fragment. "Halted · RISE Warm Engager on
 * its" and "Answered · What" are the shape this rejects: the clause cut fired
 * mid-phrase and left a preposition or a single question word standing where a
 * person or a thing should be.
 */
function usableSubject(t: string, state: string): boolean {
  if (t.length < 3) return false
  const words = t.split(/\s+/)
  // A trailing preposition, article or conjunction means the cut landed inside
  // a phrase rather than at the end of one.
  if (/^(?:on|in|at|to|of|for|with|and|or|the|a|an|its|his|her|their|by|from)$/i.test(words[words.length - 1])) return false
  // One short word is a fragment unless it is a proper noun or a domain.
  if (words.length === 1 && t.length < 6 && !/^[A-Z]/.test(t) && !t.includes('.')) return false
  // A question word standing alone is the title's first word, not its subject.
  if (/^(?:what|who|when|where|why|how|which)$/i.test(t)) return false
  // The subject must not simply be the state word again.
  if (t.toLowerCase() === state.toLowerCase()) return false
  return true
}

/**
 * Who or what a row is about, in the card's largest type.
 *
 * The ladder, in order. Every rung either produces a NAME or hands on; the last
 * rung is the family's own noun, so a headline is never a bare verb.
 */
export function subjectFor(n: SubjectRow): string | null {
  const state = stateWord(n)
  const form = formFor(n.family)

  // 1. the form's OWN resolution. A quote card knows who spoke because it reads
  // the line that introduced the quote; a bare preposition does not, and
  // "1 new comment on Davorin's posts" named the wrong human entirely.
  if (form === 'quote') {
    const q = quoteCard(n)
    if (q.subject) return q.subject
  }
  if (form === 'time') {
    const t = timeCard(n)
    if (t.who) return t.who
  }

  // 2. a person the row names after a preposition.
  const person = (n.title ?? '').match(AFTER_PREP)?.[1] ?? (n.body ?? '').match(AFTER_PREP)?.[1] ?? null
  if (person) return person

  // 3. the title, de-shouted, minus the state word it repeats, its tail, and
  //    any clause that says what happened rather than what it is.
  let t = deShout((n.title ?? '').trim())
  if (t) {
    const re = new RegExp(state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    t = t.replace(re, ' ').replace(TAIL, '').replace(HEAD, '')
    // A leading count belongs to the state word, never to the subject:
    // "1 today · Rise DTC board: 1 tap" was a count leading a count.
    t = t.replace(/^\s*\d+\s+/, '')
    t = t.replace(/\s+([:;,.·-])/g, ' ').replace(/\s{2,}/g, ' ').trim()
    t = t.replace(/^[\s:.,·-]+|[\s:.,·-]+$/g, '')
    t = t.replace(CLAUSE, '').trim()
    // Never a hard cut: clip on a word boundary and mark it.
    t = clip(t, 30)
    // A subject that repeats, or contradicts, its own state word says two
    // things in one line: "New ideas · Idea supply low" is the state saying
    // there is more and the subject saying there is less.
    const argues = sharesWords(t, state)
    if (usableSubject(t, state) && !argues && !(sharesWords(t, familyLabel(n.family)) && t.split(/\s+/).length <= 2)) return t
  }

  // 4. the family's own noun, so the headline always names the KIND of thing
  //    when the row will not name the thing itself. A bare verb is not a
  //    notification, and this is the rung that guarantees there is never one.
  const label = familyLabel(n.family)
  if (label && label !== 'Notification' && !sharesWords(label, state)) return label
  return null
}

/**
 * The one line under a headline. It must not be the headline again: a strip
 * that reads "Send failed · Sarah Francis" over "Send FAILED (verified not
 * delivered) to Sarah Fra…" has spent a line saying nothing. Walk the body's
 * sentences and take the first that carries something the headline does not.
 */
export function detailLine(body: string | null, headline: string, max = 120): string | null {
  if (!body) return null
  const clean = deShout(sanitizeBody(body)).trim()
  if (!clean) return null
  const head = new Set(headline.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  const parts = clean.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean)
  for (const part of parts) {
    const words = part.toLowerCase().split(/\W+/).filter(w => w.length > 3)
    if (!words.length) continue
    const shared = words.filter(w => head.has(w)).length / words.length
    if (shared < 0.4) return clip(part, max)
  }
  // Every sentence restates the headline: the body has nothing more to add.
  const rest = parts.length > 1 ? parts.slice(1).join(' ') : ''
  return rest ? clip(rest, max) : null
}

/**
 * One row's own sentence, for a nested deck row or a folded group's body. The
 * same treatment as a detail line: de-shouted, dashes mended, cut on a word
 * boundary with the cut marked. A `claude_turn` reads its ANSWER's first line
 * through the shared `answerHeadline`, which is what makes a turn readable.
 */
export function rowLine(n: Pick<Notification, 'family' | 'title' | 'body' | 'severity' | 'count'>, max = 120): string {
  if (n.family === 'claude_turn') {
    const head = answerHeadline(n.body)
    if (head) return clip(deShout(head), max)
  }
  const body = n.body ? deShout(sanitizeBody(n.body)) : ''
  return body ? clip(body, max) : stateWord(n)
}
