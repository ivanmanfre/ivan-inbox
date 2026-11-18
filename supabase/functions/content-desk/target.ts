// Target identity from IVAN'S OWN WORDS (Sol desk-backend r9 #1, round 10 design).
//
// The model proposes only an action kind and its arguments. Which draft it acts on is decided here,
// by data matching against his CURRENT message, never from the model's handle, excerpt or day:
//   (a) a list number he uses that the previous desk answer displayed (its meta.shown_drafts);
//   (b) otherwise the longest word-level span shared by his message and each draft's first line
//       (casefolded, accents folded, whitespace-normalized, with at least one content word of 4+
//       letters); the candidates are the drafts that reach the maximum;
//   (c) a weekday, a "26 Nov" date or a 2026-11-26 date in his message may narrow (b)'s candidates by
//       their dated day.
// Exactly one candidate proceeds. This is identity matching, not a consent gate: the verifier still
// judges whether he asked for the action.

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

const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// the command verb a message starts with: never part of the reference (Sol r10 #3)
const VERB_HEAD = /^\s*(?:ok(?:ay)?,?\s+|please\s+|can you\s+|could you\s+)*(?:approve|delete|remove the date from|remove|undate|unschedule|move|put|schedule|reschedule|date|pull|redo|rewrite|attach (?:this|the|my) (?:photo|picture|pic) to|add (?:this|the|my) (?:photo|picture|pic) to|attach|add)\b\s*/i
const DAY_WORD = '(?:today|tonight|tomorrow|(?:next|this)\\s+(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|\\d{1,2}\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\\d{4}-\\d{2}-\\d{2})'
// a date move's destination ("to Friday", "on tuesday 9 march 10:45"): never identity (Sol r10 #2)
const DESTINATION = new RegExp(`\\b(?:to|on|for|at|until)\\s+(?:the\\s+)?${DAY_WORD}[^,.;!?]*`, 'gi')

/** The part of his message that names the post: no command verb, and for a date move no destination. */
export function referencePart(text: string, kind?: string): string {
  let t = text.replace(VERB_HEAD, '')
  if (kind === 'date') t = t.replace(DESTINATION, ' ').replace(/\b(?:to|at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ')
  return t
}

/**
 * A list reference in the TARGET position only (Sol r10 #1): right after the command verb, or the whole
 * message: "approve 2", "delete number 2", "#2", "the 2nd one", "the second one", "2". Never "reason number 2".
 */
export function listNumber(text: string): number | null {
  const t = text.replace(VERB_HEAD, '').trim().toLowerCase()
  const m = t.match(/^(?:the\s+)?(?:number\s+|no\.?\s*|#)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+one)?(?=$|[\s,.!?])/)
  if (m) return Number(m[1])
  const o = t.match(/^the\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s+one)?(?=$|[\s,.!?])/)
  return o ? ORD[o[1]] : null
}

/** An explicit day reference to the post itself: "tomorrow's post", "friday's one", "the post on thursday". */
export function explicitDayRef(text: string): boolean {
  return new RegExp(`\\b${DAY_WORD}'s\\b|\\b(?:post|one|draft)\\s+(?:on|for|from)\\s+${DAY_WORD}`, 'i').test(text)
}

/** Days his message names, as Warsaw dates (YYYY-MM-DD or MM-DD): today, tomorrow, a weekday (the next one coming, today included), "26 Nov", 2026-11-26. */
export function namedDays(text: string, today?: string): { weekdays: string[]; dates: string[] } {
  const t = text.toLowerCase()
  const weekdays = WEEKDAYS.filter((w) => new RegExp(`\\b${w.slice(0, 3)}(?:${w.slice(3)})?\\b`).test(t))
  const dates: string[] = []
  if (today) {
    const add = (n: number) => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10)
    if (/\btoday\b|\btonight\b/.test(t)) dates.push(today)
    if (/\btomorrow\b/.test(t)) dates.push(add(1))
    for (const w of weekdays) {
      const d0 = new Date(today + 'T12:00:00Z').getUTCDay()
      dates.push(add((WEEKDAYS.indexOf(w) - d0 + 7) % 7))
    }
  }
  for (const m of t.matchAll(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g)) {
    dates.push(`${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`)
  }
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) dates.push(`${m[1]}-${m[2]}-${m[3]}`)
  return { weekdays, dates }
}

function dayMatches(day: string, named: { weekdays: string[]; dates: string[] }, today?: string): boolean {
  if (day === 'undated') return false
  if (!today && named.weekdays.includes(WEEKDAYS[new Date(day + 'T12:00:00Z').getUTCDay()])) return true
  return named.dates.some((d) => d.length === 5 ? day.slice(5) === d : day === d)
}

export type IdResult = { ids: string[]; how: 'list' | 'span' | 'day' | 'none'; span: number; rivals: string[]; why?: 'list_changed' | 'too_many_rivals' }

/** At most this many relevant alternatives are shown to the verifier; more = act on none (Sol r10 #3). */
export const RIVAL_CAP = 5

/**
 * Resolve the target from his message (see the header). `shown` maps the numbered rows the previous
 * desk answer rendered to {id, rev}; a number resolves only while that draft's revision is unchanged.
 */
export function identify(text: string, cands: IdDraft[], shown?: Map<number, { id: string; rev?: string | null }> | null,
  opts: { today?: string; kind?: string } = {}): IdResult {
  const n = listNumber(text)
  if (n != null && shown?.has(n)) {
    const row = shown.get(n)!
    const c = cands.find((x) => x.id === row.id)
    if (!c) return { ids: [], how: 'list', span: 0, rivals: [] }
    if (row.rev && c.rev && row.rev !== c.rev) return { ids: [], how: 'list', span: 0, rivals: [], why: 'list_changed' }
    return { ids: [c.id], how: 'list', span: 0, rivals: [] }
  }
  const ref = referencePart(text, opts.kind)
  const msg = words(ref)
  const scored = cands.map((c) => ({ c, s: sharedSpan(msg, words(c.first_line)) }))
  const named = namedDays(ref, opts.today)
  const namesDay = named.dates.length > 0 || (!opts.today && named.weekdays.length > 0)
  // a source day is a REQUIRED intersection; day-only matching only for an explicit day reference
  const onDay = (c: IdDraft) => !namesDay || dayMatches(c.day, named, opts.today)
  const pool = scored.filter((x) => onDay(x.c))
  const max = Math.max(0, ...pool.map((x) => x.s))
  let top = max > 0 ? pool.filter((x) => x.s === max) : []
  let how: IdResult['how'] = 'span'
  if (!top.length && namesDay && explicitDayRef(ref)) { top = pool; how = 'day' }
  if (!top.length) return { ids: [], how: 'none', span: 0, rivals: [] }
  const ids = top.map((x) => x.c.id)
  // relevant alternatives: other drafts on the day that come within one content word of the best
  const relevant = pool.filter((x) => !ids.includes(x.c.id) && x.s >= Math.max(1, max - 1)).sort((a, z) => z.s - a.s).map((x) => x.c.id)
  if (ids.length === 1 && relevant.length > RIVAL_CAP) return { ids: [], how, span: max, rivals: relevant, why: 'too_many_rivals' }
  return { ids, how, span: max, rivals: relevant }
}

/**
 * The numbered rows an answer rendered (Sol r10 #1): only list lines ("1." / "- " / "•"), numbered in
 * order, each the draft whose first 6 words the line carries, with its revision.
 */
export function shownDrafts(body: string, drafts: { id: string; first_line: string; updated_at?: string | null }[]): { n: number; id: string; rev: string | null }[] {
  const out: { n: number; id: string; rev: string | null }[] = []
  for (const line of body.split('\n')) {
    if (!/^\s*(?:\d{1,2}[.)]|[-•*])\s+/.test(line)) continue
    const lw = ` ${words(line).join(' ')} `
    const hit = drafts.find((d) => { const h = words(d.first_line).slice(0, 6); return h.length >= 3 && lw.includes(` ${h.join(' ')} `) })
    if (hit && !out.some((x) => x.id === hit.id)) out.push({ n: out.length + 1, id: hit.id, rev: hit.updated_at ?? null })
  }
  return out
}
