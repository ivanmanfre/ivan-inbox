/* ==========================================================================
   src/wb/ask/days.ts

   Day separators for the Ask thread. Pure and clock-injectable, so "Today"
   and "Yesterday" are testable without the suite drifting at midnight.
   ========================================================================== */

/** A turn's day, as a key that never collides across months or years. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// A fixed table rather than `toLocaleDateString(..., { month: 'short' })|`:
// `en-GB`'s ICU data abbreviates September as "Sept", not "Sep", which is one
// letter off the exact string this surface promises. A hand-written table
// never drifts with the ICU data a runtime happens to ship.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Today / Yesterday / `12 Sep` (this year) / `12 Sep 2025`.
 *
 * `now` is a parameter rather than `new Date()` read inline, so a test can
 * pin the clock instead of the assertion drifting the one day a year it runs
 * at midnight.
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  const day = `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`
}

/**
 * Which turns get a day separator ABOVE them, and what it says.
 *
 * A separator belongs before a turn whose calendar day differs from the
 * previous rendered turn's — never before the very first turn, which has no
 * previous turn to differ from. Bot bundles and answers count as turns here
 * exactly the same as an operator's: the walk is over every turn in order,
 * whatever `role` or `origin` it carries.
 *
 * A turn with no `at` (one hydrated before this field existed) is invisible
 * to the walk rather than treated as "no day": it neither opens a new day nor
 * closes the running one, so an old thread with a few dateless turns at its
 * head still gets sane separators on everything after them.
 */
export function daySeparators(turns: { id: string; at?: string }[], now: Date = new Date()): Map<string, string> {
  const marks = new Map<string, string>()
  let lastDay: string | null = null
  for (const t of turns) {
    if (!t.at) continue
    const key = dayKey(new Date(t.at))
    if (key !== lastDay) {
      if (lastDay !== null) marks.set(t.id, dayLabel(t.at, now))
      lastDay = key
    }
  }
  return marks
}
