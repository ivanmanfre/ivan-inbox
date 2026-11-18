// Target identity from IVAN'S OWN WORDS (Sol desk-backend r9 #1, round 10 design, round 14 scope cut).
//
// The model proposes only an action kind and its arguments. Which draft it acts on is decided here,
// by data matching against his CURRENT message, never from the model's handle, excerpt or day:
//   (a) the longest word-level span shared by his message and each draft's first line (casefolded,
//       accents folded, whitespace-normalized, with at least one content word of 4+ letters); the
//       candidates are the drafts that reach the maximum. Day words never score and never narrow.
//   (b) the ONE exception: an UNQUOTED calendar reference with no other selector ("tomorrow's post",
//       "the post on Friday") resolves to the drafts dated that day.
//   (c) a source day he names next to other words may only VETO a unique text match on another day;
//       it never selects. Quoted words are always text, never a date.
// There are no numbered references: a positional selector ("#2", "number 2", "the second one") is refused
// with chips, and a choice between candidates is made only through chips that send identity text. Exactly one candidate proceeds. This is identity matching, not a consent gate: the
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
    // only outside quotes: a quoted word is text, never a date or a time
    t = outsideQuotes(t, (seg) => seg.replace(DAY_PHRASE, (m) => {
      if (/^\s*(?:to|until)\b/i.test(m)) return ' '
      if (!dest) return m
      return namedDays(m, today).dates.some((d) => (d.length === 5 ? dest.slice(5) === d : dest === d)) ? ' ' : m
    }).replace(/\b(?:to|at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' '))
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

const QUOTED = /"[^"\n]*"|\u201c[^\u201d\n]*\u201d/g
/** Apply `f` to the text outside quoted spans only; quoted spans come back unchanged. */
export function outsideQuotes(text: string, f: (seg: string) => string): string {
  let out = '', last = 0
  for (const m of text.matchAll(QUOTED)) { out += f(text.slice(last, m.index!)) + m[0]; last = m.index! + m[0].length }
  return out + f(text.slice(last))
}
/** The text with every quoted span blanked to spaces (same length): what a date reader may look at. */
export function maskQuotes(text: string): string {
  return text.replace(QUOTED, (q) => ' '.repeat(q.length))
}

/** The reference without its unquoted day phrases: day words never score, and a quoted day word stays text. */
export function withoutDays(ref: string): string {
  return outsideQuotes(ref, (seg) => seg.replace(DAY_PHRASE, ' '))
}

/** The days his words name OUTSIDE quotes (a quoted word is never a date). */
export function sourceDays(ref: string, today?: string): { weekdays: string[]; dates: string[] } {
  return namedDays(maskQuotes(ref), today)
}

/**
 * A positional selector in the target position (right after the verb, or the whole reference): "#2",
 * "number 2", "no. 2", "2", "the 2nd one", "the second one", "the last one". There are no numbered
 * references, so these are refused with chips, never resolved.
 */
export function positional(ref: string): boolean {
  const t = maskQuotes(ref).trim().toLowerCase()
  return /^(?:the\s+)?(?:number\s+|no\.?\s*|#)?\d{1,2}(?:st|nd|rd|th)?(?:\s+(?:one|post|draft))?(?=$|[\s,.!?])/.test(t)
    || /^(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|previous|other)(?:\s+(?:one|post|draft))?(?=$|[\s,.!?])/.test(t)
    || /(?:^|\s)#\d{1,2}\b/.test(t)
}

// words that only point at "a post" and never identify one
const GENERIC = new Set(['post', 'posts', 'one', 'ones', 'draft', 'drafts', 'the', 'this', 'that', 'my', 'it', 's', 'from', 'on', 'for', 'of', 'a', 'an', 'next'])

/**
 * The reference is JUST an unquoted calendar reference ("tomorrow's post", "the one on friday"): the only
 * case where a date says which post. Any quoted span or positional selector means it is not.
 */
export function justADay(ref: string): boolean {
  if (/["\u201c\u201d]/.test(ref) || positional(ref)) return false
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

/** A destination the server read from his words alone (round 15 #2): a Warsaw day and a wall time. */
export type Destination = { ok: true; date: string; time: string; note?: string } | { ok: false; code: string; label: string }

const UNCLEAR_DAY = 'I could not tell the new day from your words, so I did nothing. Say it like Friday or 27 Nov.'
const VAGUE = /\b(?:next|this|coming)\s+(?:week|weekend|month)\b|\bend of (?:the )?(?:week|month)\b|\bsoon\b|\blater\b|\bsometime\b|\bin a (?:few|couple of) days\b/i
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The destination of a date move, resolved by the SERVER from his words (round 15 #2); the model's
 * instant is never trusted, only compared. Quoted spans are text and never read as a day or a time.
 * - the day: the destination day phrase (the one after to/until/for, else the last one that is neither a
 *   possessive source like "tomorrow's post" nor after "from"). An explicit date wins ("9 March" is the
 *   next 9 March on or after today, 2026-11-26 is itself); a weekday next to it must agree. Otherwise
 *   today, tomorrow, a weekday (the nearest coming one, today included) or "next <weekday>" (the one
 *   after the nearest). With no day phrase but an explicit time, the draft's own day is kept.
 * - the time: one explicit time in the destination part ("10:45", "9am", "at 9", "noon"); none = the
 *   draft's current time if it has one, else 10:45 (the prompt's rule). Two different times are unclear.
 */
export function resolveDestination(text: string, today: string, current: { day: string; time: string } | null): Destination {
  const masked = maskQuotes(text).toLowerCase()
  const tokens = [...masked.matchAll(new RegExp(DAY_WORD, 'gi'))].map((m) => ({ at: m.index!, end: m.index! + m[0].length, w: m[0] }))
  // adjacent tokens ("tuesday 9 march") are one phrase
  const groups: { at: number; end: number; ws: string[] }[] = []
  for (const t of tokens) {
    const g = groups[groups.length - 1]
    if (g && /^[\s,]*(?:the\s+)?$/.test(masked.slice(g.end, t.at))) { g.end = t.end; g.ws.push(t.w) } else groups.push({ at: t.at, end: t.end, ws: [t.w] })
  }
  const usable = groups.filter((g) => !/^'s\b/.test(masked.slice(g.end)) && !/\bfrom\s+(?:the\s+)?$/.test(masked.slice(Math.max(0, g.at - 12), g.at)))
  const dest = usable.filter((g) => /\b(?:to|until|for)\s+(?:the\s+)?$/.test(masked.slice(Math.max(0, g.at - 12), g.at))).pop() ?? usable.pop() ?? null
  if (VAGUE.test(masked) && !dest) return { ok: false, code: 'unclear_day', label: UNCLEAR_DAY }
  // the time: only in the destination part (from its day phrase on), never in a quoted span
  const region = dest ? masked.slice(dest.at) : masked
  const times = new Set<string>()
  for (const m of region.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?\b/g)) times.add(clock(+m[1], +m[2], m[3]))
  for (const m of region.matchAll(/\b(1[0-2]|0?[1-9])\s*(am|pm)\b/g)) times.add(clock(+m[1], 0, m[2]))
  for (const m of region.matchAll(/\bat\s+([01]?\d|2[0-3])\b(?!\s*(?::|am|pm|\d))(?!\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/g)) times.add(clock(+m[1], 0))
  if (/\b(?:noon|midday)\b/.test(region)) times.add('12:00')
  times.delete('')
  if (times.size > 1) return { ok: false, code: 'unclear_time', label: `I found more than one time in your words (${[...times].join(', ')}), so I did nothing. Say one time, like 9:30.` }
  const time = [...times][0] ?? current?.time ?? '10:45'
  if (!dest) {
    // only a time: the draft keeps its own day; nothing at all: unclear
    if (times.size === 1 && current?.day) return { ok: true, date: current.day, time }
    return { ok: false, code: 'unclear_day', label: UNCLEAR_DAY }
  }
  const phrase = dest.ws.join(' ')
  let date: string | null = null
  const iso = phrase.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  const dm = phrase.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/)
  if (iso) date = validDate(+iso[1], +iso[2], +iso[3])
  else if (dm) {
    const mo = MONTHS.indexOf(dm[2]) + 1, d = +dm[1], y = +today.slice(0, 4)
    date = validDate(y, mo, d)
    if (date && date < today) date = validDate(y + 1, mo, d)
  }
  if ((iso || dm) && !date) return { ok: false, code: 'unclear_day', label: `"${phrase}" is not a real date, so I did nothing. Say the date again.` }
  const wd = WEEKDAYS.find((w) => WD(w).test(phrase))
  const isNext = /\bnext\s/.test(phrase)
  if (date) {
    if (wd && WEEKDAYS[new Date(date + 'T12:00:00Z').getUTCDay()] !== wd) {
      return { ok: false, code: 'unclear_day', label: `${niceDay(date)} is not a ${cap(wd)}, so I did nothing. Say the date again.` }
    }
    return { ok: true, date, time }
  }
  const rel = namedDays(phrase, today).dates
  if (rel.length !== 1) return { ok: false, code: 'unclear_day', label: UNCLEAR_DAY }
  return { ok: true, date: rel[0], time, ...(isNext && wd ? { note: `"${phrase}" read as ${niceDay(rel[0])}, the ${cap(wd)} after the coming one.` } : {}) }
}
const clock = (h: number, m: number, ap?: string) => {
  if (ap) { if (h < 1 || h > 12) return ''; h = (h % 12) + (ap === 'pm' ? 12 : 0) }
  return `${pad(h)}:${pad(m)}`
}
function validDate(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}
const niceDay = (date: string) => new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function dayMatches(day: string, named: { weekdays: string[]; dates: string[] }, today?: string): boolean {
  if (day === 'undated') return false
  if (!today && named.weekdays.includes(WEEKDAYS[new Date(day + 'T12:00:00Z').getUTCDay()])) return true
  return named.dates.some((d) => d.length === 5 ? day.slice(5) === d : day === d)
}

export type IdResult = { ids: string[]; how: 'span' | 'day' | 'none'; span: number; rivals: string[]; why?: 'too_many_rivals' | 'positional' | 'day_conflict' }

/** At most this many relevant alternatives are shown to the verifier; more = act on none (Sol r10 #3). */
export const RIVAL_CAP = 5

/** Resolve the target from his message (see the header). */
export function identify(text: string, cands: IdDraft[], opts: { today?: string; kind?: string; note?: unknown; dest?: string | null } = {}): IdResult {
  const ref = referencePart(text, opts.kind, opts.note, opts.dest, opts.today)
  // a positional selector never resolves: there are no numbered references
  if (positional(ref)) return { ids: [], how: 'none', span: 0, rivals: [], why: 'positional' }
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
  // an explicit source day only VETOES a unique text match on another day; it never selects among ties
  const named = sourceDays(ref, opts.today)
  if (ids.length === 1 && (named.dates.length || (!opts.today && named.weekdays.length))) {
    const c = top[0].c
    if (!dayMatches(c.day, named, opts.today)) return { ids: [], how: 'span', span: max, rivals: [c.id], why: 'day_conflict' }
  }
  return { ids, how: 'span', span: max, rivals: relevant }
}
