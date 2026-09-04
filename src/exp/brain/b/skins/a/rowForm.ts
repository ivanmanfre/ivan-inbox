// rowForm.ts — skin a's ONE addition to the family map: what FORM a row takes
// inside the ledger's row grammar. `families.ts` already decides the state word,
// the severity shape and the lane; this file decides only whether the evidence
// under that word is a QUOTE (someone said something), a FIGURE (a count worth
// reading as a number), a LINE (one sanitised sentence) or an ANSWER (the first
// sentence of what Claude wrote), and which of the row's OWN words is the
// subject.
//
// Nothing here invents a fact. Every subject is a slice of the row's own title;
// every quote is a run that was already inside the row's body.
import type { Notification } from '../../../../../lib/turns'
import { answerHeadline, cardLines, familyLabel, heroSaysFailed, sanitizeBody, stateWord } from '../../families'

export type FormKind = 'quote' | 'figure' | 'line' | 'answer'

export interface RowForm {
  /** The display-size word. Always outside the detail element (E5). */
  word: string
  /** The row's subject: a lead, a seat, a workflow. Null when the title adds nothing. */
  subject: string | null
  kind: FormKind
  /** The one line of evidence under the word. Null when the row has none. */
  detail: string | null
  /** Figure rows only: the number, and the noun it counts. */
  figure: { n: string; noun: string } | null
}

const QUOTE_FAMILIES = new Set([
  'reply_draft_pending', 'inbound_reply_notice', 'comment_engagement_notice',
])

/** A word that is already the state, repeated as a subject, is noise. Compared
 * on a four-letter stem so "Booking" under "Booked" is caught the way "Replied"
 * under "Reply" is. */
function sameAsWord(subject: string, word: string): boolean {
  const a = subject.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const b = word.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!a || !b) return false
  if (a === b || (a.length > 3 && b.includes(a)) || (b.length > 3 && a.includes(b))) return true
  return a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)
}

/** A shouted label at the head of a body ("SEAT HEALTH Seat Mattan Danino …")
 * is the pipeline talking to itself. It goes only when something follows it. */
export function stripShout(text: string): string {
  const m = text.match(/^((?:[A-Z]{3,}\s+){1,3})(?=\S)/)
  if (!m) return text
  const rest = text.slice(m[0].length).trim()
  return rest.length > 12 ? rest : text
}

/** The significant words of the head, for deciding whether a sentence repeats it. */
function headTokens(word: string, subject: string | null): string[] {
  return `${word} ${subject ?? ''}`
    .toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 3)
}

/**
 * A detail line that opens by restating the head is a row saying the same thing
 * twice: "Send failed · Sarah Francis" over "Send FAILED (verified not
 * delivered) to Sarah Francis. Row reset + blocked." Leading sentences that add
 * no token the head did not already carry are dropped, at most two, and never
 * all of them.
 */
export function trimEcho(text: string, word: string, subject: string | null): string {
  const tokens = headTokens(word, subject)
  if (!tokens.length) return text
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  let i = 0
  while (i < parts.length - 1 && i < 2) {
    const words = parts[i].toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3)
    if (!words.length) break
    const echoed = words.filter(w => tokens.some(t => t === w)).length
    // an opening sentence is an echo when most of what it says is the head
    if (echoed >= 2 && echoed / words.length >= 0.4) i += 1
    else break
  }
  const rest = parts.slice(i).join(' ').trim()
  return rest.length > 12 ? rest : text
}

// The verbs a title ends on when it is reporting the state the word already
// carries. Cutting them leaves the thing the row is ABOUT.
const TRAILING_STATE = /\s+(?:failed|FAILED|halted|HALTED|blocked|BLOCKED|ready|aborted|stopped|error|errors|down|LOW|low)\.?$/

/**
 * The row's subject, sliced out of its own title. Four passes, in order:
 * "… for X" / "… to X" (the corpus's own phrasing for a lead or a domain), a
 * leading noun label ("Seat Mattan Danino"), a trailing state verb removed,
 * then the whole title if it is short enough to sit on one line.
 */
export function subjectOf(n: Pick<Notification, 'title' | 'family'>, word: string): string | null {
  const title = (n.title ?? '').trim()
  if (!title) return null
  const forTo = title.match(/\b(?:for|to)\s+([A-Z][^,:;]{2,32})$/)
  let s = forTo ? forTo[1] : title
  s = s.replace(/^(?:Seat|New|The)\s+/, '')
  s = s.replace(TRAILING_STATE, '')
  s = s.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (!s || s.length > 34) return null
  if (sameAsWord(s, word)) return null
  return s
}

/** The first run of speech in a body, or the drafted message under a blank line. */
export function quoteOf(body: string | null): string | null {
  if (!body) return null
  const clean = sanitizeBody(body)
  const spoken = clean.match(/["“]([^"“”]{2,150})["”]/)
  if (spoken) return `“${spoken[1].trim()}”`
  const paras = (body.split(/\n{2,}/).map(p => sanitizeBody(p)).filter(Boolean))
  if (paras.length > 1) {
    const last = paras[paras.length - 1]
    if (last && last.length <= 220) return last
  }
  return clean ? clean.slice(0, 220) : null
}

/** How many events a booking row stands for, as a figure and its noun. */
function bookingFigure(n: Notification): { n: string; noun: string } {
  const m = (n.body ?? '').match(/(\d+)\s+bookings?\s+attributed/i)
  const count = m ? Number(m[1]) : n.count
  return { n: String(count), noun: count === 1 ? 'booking attributed' : 'bookings attributed' }
}

/**
 * The whole form of one row. `stateWord` and `cardLines` stay the source of the
 * word, so a family this file has never heard of still lands in the `line` form
 * with a correct hero.
 */
export function rowForm(n: Notification): RowForm {
  if (n.family === 'claude_turn') {
    const first = answerHeadline(n.body)
    const asked = (n.title ?? '').trim()
    return {
      word: first ? 'Answered' : stateWord(n),
      subject: null,
      kind: 'answer',
      detail: first ?? (asked ? `You asked: ${asked}` : null),
      figure: null,
    }
  }
  const raw = stateWord(n)
  const pair = cardLines(raw, familyLabel(n.family))
  // A label that argues with the hero is dropped, exactly as plain B does it.
  const word = pair.hero
  const labelSub = pair.sub && !(heroSaysFailed(word) && !heroSaysFailed(pair.sub)) ? pair.sub : null
  const fromTitle = subjectOf(n, word)
  // The family label is only a subject when it says something the word did not.
  const subject = fromTitle ?? (labelSub && !sameAsWord(labelSub, word) ? labelSub : null)

  if (n.family === 'booking_notice') {
    return { word, subject, kind: 'figure', detail: null, figure: bookingFigure(n) }
  }
  if (QUOTE_FAMILIES.has(n.family)) {
    const q = quoteOf(n.body)
    if (q) return { word, subject, kind: 'quote', detail: q, figure: null }
  }
  const line = n.body ? trimEcho(stripShout(sanitizeBody(n.body)), word, subject).slice(0, 220) : null
  return { word, subject, kind: 'line', detail: line || null, figure: null }
}

/** A row inside an open group: its own evidence, never the state the parent said. */
export function nestedForm(n: Notification): RowForm {
  const f = rowForm(n)
  const detail = f.kind === 'quote' || f.kind === 'answer' ? f.detail : (f.detail ?? f.word)
  return { ...f, kind: f.kind === 'figure' ? 'figure' : f.kind, detail, subject: f.subject }
}
