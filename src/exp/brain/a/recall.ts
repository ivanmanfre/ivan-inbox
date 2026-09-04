// recall.ts — pure extraction of "things worth asking the recall skill about"
// out of an answer's own text. Brain visibility item 3: a one-tap action that
// sends `/recall <noun>` as a new turn. The nouns are picked, never invented —
// capitalised multiword names ("Ivan Manfredi", "RISE DTC") and `*.md`
// mentions, exactly what the families doc and the memory system actually use
// as handles.

// A `.md` mention: word characters, dots and hyphens, ending `.md`. Deliberately
// does not require a path — "feedback-thing-2026-09-02.md" is how the memory
// system names its own files, with no directory in the sentence.
const MD_RE = /\b[\w][\w.-]*\.md\b/g

// Two to four capitalised words in a row: "Ivan Manfredi", "RISE DTC",
// "Kyle Hunt". A single capitalised word is just a sentence start, not a name —
// requiring at least two words is what keeps "The System" out without a
// dictionary of stopwords.
const NAME_RE = /\b([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){1,3})\b/g

// The residual case a two-word minimum does not catch: a sentence that opens
// with a capitalised common word followed by another capitalised word, e.g.
// "The Content board...". Checked against the FIRST word only — a real name
// never starts with one of these.
const LEADING_STOPWORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'A', 'An', 'It', 'If', 'When',
  'What', 'Why', 'How', 'So', 'Once', 'Every', 'Each', 'Here', 'There',
])

/**
 * Nouns worth recalling, in first-seen order, deduplicated case-insensitively,
 * capped at `max`. Pure: no network, no invented entity — every result is a
 * literal substring of `text`.
 */
export function extractRecallNouns(text: string, max = 5): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => {
    const key = s.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(s)
  }
  for (const m of text.match(MD_RE) ?? []) push(m)
  for (const m of text.matchAll(NAME_RE)) {
    const val = m[1]
    const first = val.split(/\s+/)[0]
    if (LEADING_STOPWORDS.has(first)) continue
    push(val)
    if (out.length >= max * 3) break // bound the scan on a very long answer
  }
  return out.slice(0, max)
}

/** The literal prompt the recall action sends. One place, so the wording never drifts. */
export function recallPrompt(noun: string): string {
  return `/recall ${noun}`
}
