// Target identity from IVAN'S OWN WORDS (Sol desk-backend r9 #1, round 10 design, rounds 14-17).
//
// The model proposes only an action kind and its arguments. Which draft it acts on is decided here,
// by data matching against his CURRENT message, never from the model's handle, excerpt or day.
// CONJUNCTIVE identity, the same for every kind (round 17): from his message remove only the fixed
// command verb phrase of the kind, the parsed destination span (moves), and the frame words
// "the/one/post/posts/draft/drafts"; every remaining token (letters or digits; quoted spans count as their
// words) must appear in the draft's first line (casefolded, accent-folded, whole words). Exactly one live
// eligible draft must satisfy that; zero or several act on none, with chips. For held kinds (pull,
// approve, delete) a reference that is only a day phrase ("tomorrow's post") keeps the day-only path. A
// source date never selects, and there are no numbered references.

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
  'want', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'yours', 'thing', 'things', 'really',
  // words that point at "a post" and never say which one (round 16: "tomorrow's post" must not match every opener with "post")
  'post', 'posts', 'draft', 'drafts'])
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

// the fixed command verb phrase of each kind: the only verb words ever removed from his message (round 17)
const KIND_VERB: Record<string, string> = {
  approve: 'approve', delete: 'delete', pull: 'pull', redo: 'redo|rewrite',
  date: 'move|put|schedule|reschedule|date', undate: 'remove the date from|undate|unschedule',
  photo_attach: '(?:attach|add) (?:this|the|my) (?:photo|picture|pic) to',
}
const verbHead = (kind?: string) => new RegExp(`^\\s*(?:${kind && KIND_VERB[kind] ? KIND_VERB[kind] : Object.values(KIND_VERB).join('|')})\\b\\s*`, 'i')
/** The frame words: they point at "a post" and never say which one. The ONLY words dropped besides the verb. */
export const FRAME = new Set(['the', 'one', 'post', 'posts', 'draft', 'drafts'])
// a weekday as a whole word: full names, and the short forms that are not ordinary words ("sat", "sun" are)
const WEEKDAY_WORD = '(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|saturday|sunday)'
const DAY_WORD = `(?:\\btoday\\b|\\btonight\\b|\\btomorrow\\b|\\b(?:next|this)\\s+${WEEKDAY_WORD}\\b|\\b${WEEKDAY_WORD}\\b|\\b\\d{1,2}\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b)`
// a day phrase with an optional preposition before it and a date/time after it ("on tuesday 9 march 10:45")
const DAY_PHRASE = new RegExp(`(?:\\b(?:to|on|for|at|until|from)\\s+(?:the\\s+)?)?${DAY_WORD}(?:'s)?(?:\\s+\\d{1,2}(?:\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)?)?(?:\\s+(?:at\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)?`, 'gi')

/**
 * The target phrase of his message: the kind's fixed verb phrase is removed, and for a date move the
 * EXACT destination span the parser returned. The reference is the message's first clause (it ends at
 * the first comma or semicolon outside quotes: "delete the ferry one, it makes no sense"). For a redo the
 * direction also goes (the proposed note's own span, "make it", "but" ...). Punctuation inside a quoted
 * opener never counts as a cut.
 */
export function referencePart(text: string, kind?: string, note?: unknown, destSpan?: { at: number; end: number } | null): string {
  let t = text
  if (kind === 'date' && destSpan) t = text.slice(0, destSpan.at) + ' ' + text.slice(destSpan.end)
  t = t.replace(verbHead(kind), '')
  // GRAMMAR.md 1 T2 (d): a trailing clause after the first comma or semicolon outside quotes; nothing else
  void note
  const m = maskQuotes(t).match(/,|;/)
  if (m && m.index != null) t = t.slice(0, m.index)
  return t
}

// straight and curly, double and single quoted spans; a single quote inside a word ("Friday's", "I'm",
// "Friday\u2019s") is an apostrophe, never a quote
const QUOTED = /"[^"\n]*"|\u201c[^\u201d\n]*\u201d|(?<![\p{L}\p{N}])'(?:[^'\n]|'(?=[\p{L}\p{N}]))*'(?![\p{L}\p{N}])|\u2018(?:[^\u2019\n]|\u2019(?=[\p{L}\p{N}]))*\u2019(?![\p{L}\p{N}])/gu
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

// GRAMMAR.md 1 T3: exactly `tomorrow's post` | `today's post` | `<weekday>'s post` | `the post on <weekday>`
const DAY_ONLY = [
  new RegExp(`^(?:tomorrow|today|${WEEKDAY_WORD})(?:'s|\u2019s)\\s+post$`, 'i'),
  new RegExp(`^the\\s+post\\s+on\\s+${WEEKDAY_WORD}$`, 'i'),
]
/**
 * The reference is EXACTLY a day phrase ("tomorrow's post", "friday's one", "the post on friday"), with no
 * leftover token: any digit, "#", quote or other word means it is not (round 16 #1+2).
 */
export function justADay(ref: string): boolean {
  const t = ref.trim().replace(/[?!.]+$/, '').trim()
  return DAY_ONLY.some((r) => r.test(t))
}

/** The kinds that may act on a day-only reference: held ones, confirmed on a card that names the post. */
export const DAY_ONLY_KINDS = new Set(['pull', 'approve', 'delete'])

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

/** A destination the server read from his words alone (round 16 #3): a Warsaw day, a wall time if he gave one, and the exact span. */
export type Destination = { ok: true; date: string; time: string | null; span: { at: number; end: number }; note?: string } | { ok: false; code: string; label: string }

const pad = (n: number) => String(n).padStart(2, '0')
const MONTH_WORD = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
// every token that can be part of a date or a time
const DATE_TOKEN = new RegExp(`\\b(?:next\\s+${WEEKDAY_WORD}|this\\s+${WEEKDAY_WORD}|${WEEKDAY_WORD}|today|tonight|tomorrow|${MONTH_WORD}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|\\d{1,2}:\\d{2}|\\d{1,4}(?:st|nd|rd|th)?|at|noon|midday)\\b`, 'gi')
// GRAMMAR.md 2, the ONLY destination forms, consumed as ONE complete span:
//   <weekday> | <day> <month> [<yyyy>] | <month> <day> [<yyyy>] | <weekday> <day> <month> [<yyyy>]
//   optionally followed by "at H:MM" / "at HH:MM" (24-hour, exactly two-digit minutes)
// no today, tomorrow, next, noon, am/pm, hour-only, ordinals or commas
const DATE_PART = `(?:(?:(?<wd1>${WEEKDAY_WORD})\\s+)?(?<d1>\\d{1,2})\\s+(?<m1>${MONTH_WORD})(?:\\s+(?<y1>\\d{4}))?`
  + `|(?<m2>${MONTH_WORD})\\s+(?<d2>\\d{1,2})(?:\\s+(?<y2>\\d{4}))?`
  + `|(?<wd3>${WEEKDAY_WORD}))`
const TIME_PART = `(?:\\s+at\\s+(?<h1>\\d{1,2}):(?<mi1>\\d{2}))?`
const DEST_RE = new RegExp(`^${DATE_PART}${TIME_PART}$`, 'i')

/**
 * The destination of a date move, read by the SERVER from his words (rounds 15-16); the model's instant is
 * never trusted, only compared. Quoted spans are text and never read. Date-like tokens are grouped into
 * runs; a run counts when it holds a day word, an ISO date, a time or a month next to a number. A run that
 * is a possessive ("tomorrow's post"), after "from", or "post/one/draft on X" is a source, kept for the
 * veto. Exactly one other run is the destination: the one after to/until/for when there are several. It
 * must match the grammar as ONE complete span; a leftover date-like token, an invalid time or a second
 * day means nothing is done ("I could not read the date: <span>"). Defaults apply only after a full parse.
 */
export function parseDestination(text: string, today: string): Destination {
  const masked = maskQuotes(text)
  const toks = [...masked.matchAll(DATE_TOKEN)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, w: m[0] }))
  const runs: { at: number; end: number; ws: string[] }[] = []
  for (const t of toks) {
    const r = runs[runs.length - 1]
    if (r && /^[\s,]*$/.test(masked.slice(r.end, t.at))) { r.end = t.end; r.ws.push(t.w) } else runs.push({ at: t.at, end: t.end, ws: [t.w] })
  }
  const dateLike = (r: { ws: string[] }) => {
    const j = r.ws.join(' ').toLowerCase()
    return new RegExp(`\\b(?:${WEEKDAY_WORD}|today|tonight|tomorrow)\\b`, 'i').test(j) || /\d{4}-\d{2}-\d{2}|\d:\d{2}|\d\s*(?:am|pm)\b|\bnoon\b|\bmidday\b/i.test(j)
      || (new RegExp(`\\b${MONTH_WORD}\\b`, 'i').test(j) && /\d/.test(j))
  }
  const counted = runs.filter(dateLike)
  const before = (r: { at: number }, re: RegExp) => re.test(masked.slice(Math.max(0, r.at - 24), r.at))
  const isSource = (r: { at: number; end: number }) => /^(?:'s|\u2019s)\b/i.test(masked.slice(r.end)) || before(r, /\bfrom\s+(?:the\s+)?$/i)
    || before(r, /\b(?:post|one|draft)\s+(?:on|for|from)\s+(?:the\s+)?$/i)
  let cands = counted.filter((r) => !isSource(r))
  if (cands.length > 1) {
    const marked = cands.filter((r) => before(r, /\b(?:to|on)\s+$/i))
    if (marked.length === 1) {
      const rest = cands.filter((r) => r !== marked[0])
      return { ok: false, code: 'unclear_date', label: `I could not read the date: "${text.slice(rest[0].at, rest[0].end)}" is a second day or time.` }
    }
  }
  if (!cands.length && counted.length === 1 && before(counted[0], /\b(?:post|one|draft)\s+(?:on|for)\s+(?:the\s+)?$/i)) cands = counted   // "put the cold brew one on friday"
  if (!cands.length) return { ok: false, code: 'unclear_date', label: 'I could not read the date: there is no day in your words. Say it like "Friday" or "27 Nov at 9:30".' }
  if (cands.length > 1) return { ok: false, code: 'unclear_date', label: `I could not read the date: "${text.slice(cands[0].at, cands[0].end)}" and "${text.slice(cands[1].at, cands[1].end)}" are two days.` }
  const r = cands[0]
  // the destination span takes any characters glued to it ("10:45:30", "9/3"), so the grammar must consume them
  const glued = masked.slice(r.end).match(/^(?:[:./\-]\d+)+/)
  const end = r.end + (glued ? glued[0].length : 0)
  const span = text.slice(r.at, end)
  const bad = { ok: false as const, code: 'unclear_date', label: `I could not read the date: "${span}".` }
  // one day and one time only: any date-like token after the destination ("or 10", "and monday") means nothing is done
  const after = masked.slice(end)
  if (/\d/.test(after) || new RegExp(`\\b(?:${WEEKDAY_WORD}|today|tonight|tomorrow|${MONTH_WORD}|noon|midday)\\b`, 'i').test(after)) {
    return { ok: false, code: 'unclear_date', label: `I could not read the date: "${text.slice(r.at).trim()}".` }
  }
  const m = span.trim().match(DEST_RE)
  if (!m || !m.groups) return bad
  const g = m.groups
  // the time: "at H:MM" / "at HH:MM", 00:00-23:59
  let time: string | null = null
  if (g.h1 != null) {
    const h = +g.h1, mi = +g.mi1
    if (h > 23 || mi > 59) return bad
    time = `${pad(h)}:${pad(mi)}`
  }
  const monthNo = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1
  let date: string | null = null
  const note: string | undefined = undefined
  if (g.d1 != null || g.d2 != null) {
    const d = +(g.d1 ?? g.d2), mo = monthNo(g.m1 ?? g.m2), yGiven = g.y1 ?? g.y2
    if (yGiven) date = validDate(+yGiven, mo, d)   // a year in the text is used as given
    else {
      const y = +today.slice(0, 4)
      date = validDate(y, mo, d)
      if (date && date < today) date = validDate(y + 1, mo, d)
    }
    if (!date) return bad
    if (g.wd1) {
      const wd = WEEKDAYS.find((w) => WD(w, 'i').test(g.wd1))
      if (wd && WEEKDAYS[new Date(date + 'T12:00:00Z').getUTCDay()] !== wd) return { ok: false, code: 'unclear_date', label: `I could not read the date: ${niceDay(date)} is not a ${cap(wd)}.` }
    }
  } else if (g.wd3) {
    // GRAMMAR.md 2: the next occurrence AFTER today (Warsaw); a weekday that is today means next week's
    const wd = WEEKDAYS.find((w) => WD(w, 'i').test(g.wd3))!
    date = addDays(today, toNearest(today, wd) || 7)
  }
  if (!date) return bad
  // the exact span: the grammar's own match, plus the destination preposition right before it ("to", "until",
  // "for", "on"), which belongs to the destination and to nothing else
  const lead = span.length - span.trimStart().length
  let at = r.at + lead
  // GRAMMAR.md 2: `to|on <D>`; the preposition is read on the ORIGINAL text, never on the quote-masked copy
  const prep = text.slice(0, at).match(/\b(?:to|on)\s+$/i)
  if (!prep) return bad
  at -= prep[0].length
  return { ok: true, date, time, span: { at, end: r.at + lead + span.trim().length }, ...(note ? { note } : {}) }
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

export type IdResult = { ids: string[]; how: 'words' | 'day' | 'none'; rivals: string[]; why?: 'positional' | 'needs_words' | 'no_words' }

/** The tokens a reference must find in an opener: every word left after the verb, destination and frame words. */
export function refTokens(ref: string): string[] {
  return words(ref).filter((w) => !FRAME.has(w))
}

/** Does this opener contain every token as a whole word? */
export function hasAll(firstLine: string, tokens: string[]): boolean {
  const w = new Set(words(firstLine))
  return tokens.length > 0 && tokens.every((t) => w.has(t))
}

/**
 * Resolve the target from his message (see the header). A candidate's `ok` is its eligibility for the
 * kind: exactly one eligible draft holding every token resolves; a single ineligible match is returned
 * so the caller refuses it as itself (never swapped); zero or several act on none, with chips.
 */
export function identify(text: string, cands: (IdDraft & { ok?: boolean })[], opts: { today?: string; kind?: string; note?: unknown; destSpan?: { at: number; end: number } | null } = {}): IdResult {
  const ref = referencePart(text, opts.kind, opts.note, opts.destSpan)
  // a positional selector never resolves: there are no numbered references
  if (positional(ref)) return { ids: [], how: 'none', rivals: [], why: 'positional' }
  const onNamedDays = () => { const n = sourceDays(ref, opts.today); return cands.filter((c) => dayMatches(c.day, n, opts.today)).map((c) => c.id) }
  if (justADay(ref)) {
    // day-only identity: held kinds only; an immediate kind gets chips and must name words
    if (!DAY_ONLY_KINDS.has(opts.kind ?? '')) return { ids: [], how: 'none', rivals: onNamedDays(), why: 'needs_words' }
    // GRAMMAR.md 1 T3: exactly one live ELIGIBLE draft dated that day (a single ineligible one is refused as itself)
    const onDay = onNamedDays()
    const ok = onDay.filter((id) => cands.find((c) => c.id === id)?.ok !== false)
    const ids = ok.length ? ok : onDay
    return ids.length ? { ids, how: 'day', rivals: [] } : { ids: [], how: 'none', rivals: [] }
  }
  const tokens = refTokens(ref)
  if (!tokens.length) return { ids: [], how: 'none', rivals: [], why: 'no_words' }
  const matches = cands.filter((c) => hasAll(c.first_line, tokens))
  const eligible = matches.filter((c) => c.ok !== false)
  if (eligible.length >= 1) return { ids: eligible.map((c) => c.id), how: 'words', rivals: matches.filter((c) => c.ok === false).map((c) => c.id) }
  if (matches.length) return { ids: matches.map((c) => c.id), how: 'words', rivals: [] }
  // no draft holds every token: chips for the drafts that hold the most of them (never acted on)
  const scored = cands.map((c) => { const w = new Set(words(c.first_line)); return { c, n: tokens.filter((t) => w.has(t)).length } }).filter((x) => x.n > 0)
  const best = Math.max(0, ...scored.map((x) => x.n))
  return { ids: [], how: 'none', rivals: best ? scored.filter((x) => x.n === best).map((x) => x.c.id) : onNamedDays() }
}
