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

export type IdDraft = { id: string; first_line: string; day: string }   // day: YYYY-MM-DD (Warsaw) or 'undated'

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

/** A list reference in his message: "number 2", "#2", "no. 2", "the 2nd one", "the second one", or just "2". */
export function listNumber(text: string): number | null {
  const t = text.trim().toLowerCase()
  const m = t.match(/(?:^|\s)(?:number|no\.?|#)\s*(\d{1,2})\b/) ?? t.match(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)?\s+one\b/) ?? t.match(/^(\d{1,2})[.!]?$/)
  if (m) return Number(m[1])
  const o = t.match(/\bthe\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/)
  return o ? ORD[o[1]] : null
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
  // with a known today, weekdays already resolved to exact dates; without one, a weekday name matches any week
  if (!today && named.weekdays.includes(WEEKDAYS[new Date(day + 'T12:00:00Z').getUTCDay()])) return true
  return named.dates.some((d) => d.length === 5 ? day.slice(5) === d : day === d)
}

export type IdResult = { ids: string[]; how: 'list' | 'span' | 'none'; span: number; rivals: string[] }

/**
 * Resolve the target from his message. `shown` maps list numbers the previous desk answer displayed
 * to draft ids. `today` (Warsaw) resolves today, tomorrow and weekdays. `dayIsArg`: for a date move the
 * day he names is the NEW date, never identity. `rivals` = the other drafts that share any qualifying
 * span (for the verifier).
 */
export function identify(text: string, cands: IdDraft[], shown?: Map<number, string> | null,
  opts: { today?: string; dayIsArg?: boolean } = {}): IdResult {
  const n = listNumber(text)
  if (n != null && shown?.has(n)) {
    const id = shown.get(n)!
    return { ids: cands.some((c) => c.id === id) ? [id] : [], how: 'list', span: 0, rivals: [] }
  }
  const msg = words(text)
  const scored = cands.map((c) => ({ c, s: sharedSpan(msg, words(c.first_line)) })).filter((x) => x.s > 0)
  const max = scored.length ? Math.max(...scored.map((x) => x.s)) : 0
  let top = scored.filter((x) => x.s === max)
  const named = namedDays(text, opts.today)
  const namesDay = named.dates.length > 0 || (!opts.today && named.weekdays.length > 0)
  if (namesDay && !opts.dayIsArg) {
    // a day he names is identity here ("tomorrow's post"): the drafts on that day, among the word
    // matches when any of them is on it, else every eligible draft on it
    const onDay = cands.filter((c) => dayMatches(c.day, named, opts.today))
    const both = top.filter((x) => onDay.some((c) => c.id === x.c.id))
    if (both.length) top = both
    else if (onDay.length) return { ids: onDay.map((c) => c.id), how: 'span', span: 0, rivals: scored.map((x) => x.c.id).filter((id) => !onDay.some((c) => c.id === id)) }
  } else if (top.length > 1 && namesDay) {
    const narrowed = top.filter((x) => dayMatches(x.c.day, named, opts.today))
    if (narrowed.length) top = narrowed
  }
  if (!top.length) return { ids: [], how: 'none', span: 0, rivals: [] }
  const ids = top.map((x) => x.c.id)
  return { ids, how: 'span', span: max, rivals: scored.filter((x) => !ids.includes(x.c.id)).sort((a, z) => z.s - a.s).map((x) => x.c.id) }
}

/**
 * The drafts an answer displayed, in order of first appearance (its first 6 words appear in the body):
 * stored in that answer's meta so a later "number 2" means exactly the second one shown.
 */
export function shownDrafts(body: string, drafts: { id: string; first_line: string }[]): { n: number; id: string }[] {
  const b = ` ${words(body).join(' ')} `
  const pos: { id: string; at: number }[] = []
  for (const d of drafts) {
    const head = words(d.first_line).slice(0, 6)
    if (head.length < 3) continue
    const at = b.indexOf(` ${head.join(' ')} `)
    if (at >= 0) pos.push({ id: d.id, at })
  }
  return pos.sort((a, z) => a.at - z.at).map((p, i) => ({ n: i + 1, id: p.id }))
}
