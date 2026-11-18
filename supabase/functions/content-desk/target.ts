// Target identity from IVAN'S OWN WORDS (Sol desk-backend r9 #1, round 10 design, round 14 scope cut).
//
// The model proposes only an action kind and its arguments. Which draft it acts on is decided here,
// by data matching against his CURRENT message, never from the model's handle, excerpt or day:
//   (a) the longest word-level span shared by his message and each draft's first line (casefolded,
//       accents folded, whitespace-normalized, with at least one content word of 4+ letters); the
//       candidates are the drafts that reach the maximum. Day words never score and never narrow.
//   (b) the ONE exception: a reference that is only a day ("tomorrow's post", "the post on Friday")
//       resolves to the drafts dated that day.
// There are no numbered references: a choice between candidates is made only through chips that send
// identity text. Exactly one candidate proceeds. This is identity matching, not a consent gate: the
// verifier still judges whether he asked for the action.

export type IdDraft = { id: string; first_line: string; day: string; rev?: string | null }   // day: YYYY-MM-DD (Warsaw) or 'undated'; rev = updated_at

/** Casefolded, accent-folded word tokens. */
export function words(s: string): string[] {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFKC').toUpperCase().toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

// function words of 4+ letters never count: "about", "this", "more" must not tip a match
const STOP = new Set(['about', 'above', 'after', 'again', 'also', 'been', 'before', 'being', 'both', 'could', 'does', 'done', 'down', 'each',
  'even', 'from', 'have', 'here', 'into', 'just', 'less', 'like', 'make', 'makes', 'many', 'more', 'most', 'much', 'must', 'only', 'other',
  'over', 'same', 'should', 'some', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'very',
  'want', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'yours', 'thing', 'things', 'really'])
export const contentWord = (w: string) => (w.match(/\p{L}/gu) ?? []).length >= 4 && !STOP.has(w)

/**
 * The longest contiguous word span shared by a and b, measured in CONTENT words (4+ letters, not a
 * function word): "the gdansk" and "gdansk" are the same length, so a "the" never breaks a tie. 0 = none.
 */
export function sharedSpan(a: string[], b: string[]): number {
  let best = 0
  // per cell: the common run ending at a[i-1] == b[j-1] (its word length, and its content-word count)
  let prevLen = new Array(b.length + 1).fill(0), prevCw = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const len = new Array(b.length + 1).fill(0), cw = new Array(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue
      len[j] = prevLen[j - 1] + 1
      cw[j] = prevCw[j - 1] + (contentWord(a[i - 1]) ? 1 : 0)
      if (cw[j] > best) best = cw[j]
    }
    prevLen = len; prevCw = cw
  }
  return best
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// the command verb a message starts with: never part of the reference (Sol r10 #3)
const VERB_HEAD = /^\s*(?:ok(?:ay)?,?\s+|please\s+|can you\s+|could you\s+)*(?:approve|delete|remove the date from|remove|undate|unschedule|move|put|schedule|reschedule|date|pull|redo|rewrite|attach (?:this|the|my) (?:photo|picture|pic) to|add (?:this|the|my) (?:photo|picture|pic) to|attach|add)\b\s*/i
// a weekday as a whole word: full names, and the short forms that are not ordinary words ("sat", "sun" are)
const WEEKDAY_WORD = '(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|saturday|sunday)'
const DAY_WORD = `(?:\\btoday\\b|\\btonight\\b|\\btomorrow\\b|\\b(?:next|this)\\s+${WEEKDAY_WORD}\\b|\\b${WEEKDAY_WORD}\\b|\\b\\d{1,2}\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b)`
// a day phrase with an optional preposition before it and a date/time after it ("on tuesday 9 march 10:45")
const DAY_PHRASE = new RegExp(`(?:\\b(?:to|on|for|at|until|from)\\s+(?:the\\s+)?)?${DAY_WORD}(?:'s)?(?:\\s+\\d{1,2}(?:\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)?)?(?:\\s+(?:at\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)?`, 'gi')

/**
 * The target phrase of his message: no command verb. For a date move the DESTINATION goes ("to/until
 * X", or the day phrase that names the move's own Warsaw day `dest`, plus a bare time). For a redo the
 * direction goes (the proposed note's own span, and anything after the first comma, "make it", "but"
 * ...), where punctuation inside a quoted opener never counts as the cut.
 */
export function referencePart(text: string, kind?: string, note?: unknown, dest?: string | null, today?: string): string {
  let t = text.replace(VERB_HEAD, '')
  if (kind === 'date') {
    t = t.replace(DAY_PHRASE, (m) => {
      if (/^\s*(?:to|until)\b/i.test(m)) return ' '
      if (!dest) return m
      return namedDays(m, today).dates.some((d) => (d.length === 5 ? dest.slice(5) === d : dest === d)) ? ' ' : m
    }).replace(/\b(?:to|at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ')
  }
  if (kind === 'redo') {
    const n = typeof note === 'string' ? note.trim() : ''
    if (n) { const i = t.toLowerCase().indexOf(n.toLowerCase()); if (i >= 0) t = t.slice(0, i) + ' ' + t.slice(i + n.length) }
    // cut at the first direction marker OUTSIDE a quoted span
    const masked = t.replace(/"[^"\n]*"|“[^”\n]*”/g, (q) => 'x'.repeat(q.length))
    const m = masked.match(/,|;|\s(?:and\s+)?make it\s|\sbut\s|\swith more\s|\swith less\s/i)
    if (m && m.index != null) t = t.slice(0, m.index)
  }
  return t
}

/** The reference without its day phrases: day words never score (an opener that says "Friday" is not Friday's post). */
export function withoutDays(ref: string): string {
  return ref.replace(DAY_PHRASE, ' ')
}

// words that only point at "a post" and never identify one
const GENERIC = new Set(['post', 'posts', 'one', 'ones', 'draft', 'drafts', 'the', 'this', 'that', 'my', 'it', 's', 'from', 'on', 'for', 'of', 'a', 'an', 'next'])

/** The reference is JUST a day ("tomorrow's post", "the one on friday"): the only case where a date says which post. */
export function justADay(ref: string): boolean {
  const stripped = withoutDays(ref).toLowerCase()
  const rest = words(stripped).filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w) && !MONTHS.includes(w.slice(0, 3)))
  return rest.length === 0 && new RegExp(DAY_WORD, 'i').test(ref)
}

const addDays = (today: string, n: number) => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10)
/** Days from today to the nearest coming `weekday` (today included). */
const toNearest = (today: string, weekday: string) => (WEEKDAYS.indexOf(weekday) - new Date(today + 'T12:00:00Z').getUTCDay() + 7) % 7
const WD_FORM: Record<string, string> = { sunday: 'sunday', monday: 'mon(?:day)?', tuesday: 'tue(?:s(?:day)?)?', wednesday: 'wed(?:nesday)?',
  thursday: 'thu(?:r(?:s(?:day)?)?)?', friday: 'fri(?:day)?', saturday: 'saturday' }
const WD = (w: string, flags = '') => new RegExp(`\\b${WD_FORM[w]}\\b`, flags)

/**
 * Days his words name, as Warsaw dates (YYYY-MM-DD, or MM-DD for "26 Nov"): today, tomorrow, a weekday
 * (the nearest coming one, today included), "next <weekday>" (the one AFTER the nearest), "26 Nov", 2026-11-26.
 */
export function namedDays(text: string, today?: string): { weekdays: string[]; dates: string[] } {
  const t = text.toLowerCase()
  const weekdays = WEEKDAYS.filter((w) => WD(w).test(t))
  const dates: string[] = []
  if (today) {
    if (/\btoday\b|\btonight\b/.test(t)) dates.push(today)
    if (/\btomorrow\b/.test(t)) dates.push(addDays(today, 1))
    for (const w of weekdays) {
      const nextRe = new RegExp(`\\bnext\\s+${WD_FORM[w]}\\b`, 'g')
      const next = nextRe.test(t)
      const plain = t.replace(nextRe, ' ')
      if (next) dates.push(addDays(today, toNearest(today, w) + 7))
      if (WD(w).test(plain)) dates.push(addDays(today, toNearest(today, w)))
    }
  }
  for (const m of t.matchAll(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g)) {
    dates.push(`${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`)
  }
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) dates.push(`${m[1]}-${m[2]}-${m[3]}`)
  return { weekdays, dates }
}

/**
 * The destination of a date move, read from his words (round 14 #2): the last day phrase that is not a
 * possessive source ("tomorrow's post") and not after "from". A vague phrase ("next week", "soon") is
 * refused unless his words also give one day; an explicit date ("9 March", 2026-11-26) is his and needs no
 * check; a relative day (today, tomorrow, a weekday, "next <weekday>") must be the day the move uses.
 */
export function destinationCheck(text: string, iso: string, today: string): { ok: true; note?: string } | { ok: false; code: string; label: string } {
  const t = text.toLowerCase()
  const phrases = [...t.matchAll(new RegExp(`(\\bfrom\\s+(?:the\\s+)?)?(${DAY_WORD})('s)?`, 'gi'))].filter((m) => !m[1] && !m[3]).map((m) => m[2])
  const vague = /\b(?:next|this|coming)\s+(?:week|weekend|month)\b|\bend of (?:the )?(?:week|month)\b|\bsoon\b|\blater\b|\bsometime\b|\bin a (?:few|couple of) days\b/.test(t)
  if (!phrases.length) {
    return vague ? { ok: false, code: 'vague_date', label: 'Tell me the day, like Friday or 27 Nov, and I will move it.' } : { ok: true }
  }
  const last = phrases[phrases.length - 1]
  if (/\d/.test(last)) return { ok: true }   // an explicit date he wrote
  const want = namedDays(last, today).dates
  if (want.length !== 1) return { ok: false, code: 'vague_date', label: 'Tell me the day, like Friday or 27 Nov, and I will move it.' }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  const isNext = /^next\s/.test(last)
  const wd = WEEKDAYS.find((w) => WD(w).test(last))
  const nice = new Date(want[0] + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  if (day !== want[0]) {
    return { ok: false, code: 'date_mismatch', label: `"${last}" is ${nice} by my count${isNext ? ` (the ${cap(wd!)} after the coming one)` : ''}, and that is not the date I was about to use, so I did nothing. Say the date.` }
  }
  return isNext ? { ok: true, note: `"${last}" read as ${nice}, the ${cap(wd!)} after the coming one.` } : { ok: true }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function dayMatches(day: string, named: { weekdays: string[]; dates: string[] }, today?: string): boolean {
  if (day === 'undated') return false
  if (!today && named.weekdays.includes(WEEKDAYS[new Date(day + 'T12:00:00Z').getUTCDay()])) return true
  return named.dates.some((d) => d.length === 5 ? day.slice(5) === d : day === d)
}

export type IdResult = { ids: string[]; how: 'span' | 'day' | 'none'; span: number; rivals: string[]; why?: 'too_many_rivals' }

/** At most this many relevant alternatives are shown to the verifier; more = act on none (Sol r10 #3). */
export const RIVAL_CAP = 5

/** Resolve the target from his message (see the header). */
export function identify(text: string, cands: IdDraft[], opts: { today?: string; kind?: string; note?: unknown; dest?: string | null } = {}): IdResult {
  const ref = referencePart(text, opts.kind, opts.note, opts.dest, opts.today)
  if (justADay(ref)) {
    // the ONE case where a date says which post: every draft dated that day; it resolves only if that is one
    const named = namedDays(ref, opts.today)
    const ids = cands.filter((c) => dayMatches(c.day, named, opts.today)).map((c) => c.id)
    return ids.length ? { ids, how: 'day', span: 0, rivals: [] } : { ids: [], how: 'none', span: 0, rivals: [] }
  }
  // dates never narrow identity: day words are dropped and every candidate is scored on his other words
  const msg = words(withoutDays(ref))
  const scored = cands.map((c) => ({ c, s: sharedSpan(msg, words(c.first_line)) }))
  const max = Math.max(0, ...scored.map((x) => x.s))
  const top = max > 0 ? scored.filter((x) => x.s === max) : []
  if (!top.length) return { ids: [], how: 'none', span: 0, rivals: [] }
  const ids = top.map((x) => x.c.id)
  // relevant alternatives: other drafts that come within one content word of the best
  const relevant = scored.filter((x) => !ids.includes(x.c.id) && x.s >= Math.max(1, max - 1)).sort((a, z) => z.s - a.s).map((x) => x.c.id)
  if (ids.length === 1 && relevant.length > RIVAL_CAP) return { ids: [], how: 'span', span: max, rivals: relevant, why: 'too_many_rivals' }
  return { ids, how: 'span', span: max, rivals: relevant }
}
