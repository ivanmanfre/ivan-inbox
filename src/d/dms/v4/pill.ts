// Row-line prefixes that are states, not words (Brief 3.0's bridge linePill, now React-owned).
// Estimated and Scheduled return stay distinct (FINISH.md). Pure: no hooks, no writes.
export type PillTone = 'warn' | 'neutral' | 'info' | 'ok' | 'bad'
export type LinePill = { label: string; tone: PillTone; rest: string }

export function linePill(text: string): LinePill | null {
  const match = /^(Due|Estimated follow-up|Estimated|Scheduled return) · (.+)$/s.exec(text)
  if (match) {
    const label = match[1] === 'Estimated follow-up' ? 'Estimated' : match[1]
    return { label, tone: label === 'Due' ? 'warn' : label === 'Scheduled return' ? 'info' : 'neutral', rest: match[2] }
  }
  // The two Later lines (later.ts via upcoming.ts) carry no " · rest" step of their own.
  if (text === 'Draft returns for review') return { label: 'Draft returns', tone: 'info', rest: '' }
  if (text === 'Scheduled return · draft when due') return { label: 'Scheduled return', tone: 'info', rest: 'draft when due' }
  return null
}

/** "John Mark Pero" -> "JM"; "Acme, Inc." -> "A". Letters and digits only: an emoji before a name
 *  ("👩🏽‍💻 Krishna Solanki") must never become half a surrogate pair. */
export function initials(n: string): string {
  return n.replace(/,.*/, '').split(/\s+/).map(w => w.match(/[\p{L}\p{N}]/u)?.[0] ?? '').filter(Boolean).join('').slice(0, 2).toUpperCase()
}

/** The shared next step, said only when it says something ("Conversation check pending" is the default). */
export function nextStepOf(rest: string): string | null {
  const r = rest.trim()
  return r && r !== 'Conversation check pending' && r !== 'draft when due' ? r : null
}
