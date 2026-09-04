// recall.ts — pure noun extraction for the "recall <noun>" inline action.
//
// Brief item 3: "a one-tap recall <noun> action that sends /recall <noun> as a
// new turn (pick nouns from the answer: capitalised multiword names and *.md
// mentions; never invent)". This file finds those candidates in an answer's
// text; the renderer underlines each occurrence and wires it to
// `buildRecallCommand`.
//
// "Never invent" is the whole contract: every returned string is a verbatim
// substring of the input, nothing is cased, trimmed of meaning, or guessed at.

// `notes-app.md`, `feedback-lm-cover-2026-08-21.md` — any bare filename ending
// in .md. Word-boundary on both sides so this never grabs a trailing clause.
const MD_RE = /\b[\w][\w-]*\.md\b/g

// A run of 2-4 Capitalized words: "Ivan Manfredi", "RISE DTC", "Content
// Radar", "Kyle Hunt". Bounded at 4 so a whole capitalised sentence (a
// markdown heading pasted into an answer) is not swallowed as one "noun".
const NAME_RE = /\b[A-Z][a-zA-Z0-9]*(?:[ \t][A-Z][a-zA-Z0-9]*){1,3}\b/g

// A small stopword list for two-word sequences that are capitalised but are
// grammar, not a name — the start of a new sentence right after one that ended
// mid-line is the main source of these false positives ("Ivan. The Content
// engine..." would otherwise treat "The Content" as a name candidate).
const LEADING_STOP = new Set(['The', 'This', 'That', 'These', 'Those', 'A', 'An'])

/**
 * Every recall-worthy noun in a block of answer text, first-seen order,
 * de-duplicated. Pure: testable without a DOM, and this is what decides what
 * gets underlined, so it has to be exactly right about what it will and won't
 * touch.
 */
export function extractRecallNouns(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const v = raw.trim()
    if (v.length < 3 || seen.has(v)) return
    seen.add(v)
    out.push(v)
  }
  for (const m of text.match(MD_RE) ?? []) push(m)
  for (const m of text.match(NAME_RE) ?? []) {
    const words = m.split(/\s+/)
    if (LEADING_STOP.has(words[0])) continue
    // Every word has to be at least three characters. Two-character tokens are
    // where the false positives live: a sentence opening with a capitalised
    // verb followed by a short label reads as a name to the regex ("Ran R1"
    // was underlined in a live answer during evidence capture) and there is
    // nothing in memory under it.
    if (words.some(w => w.length < 3)) continue
    push(m)
  }
  return out
}

/** The exact turn text a recall tap sends. */
export function buildRecallCommand(noun: string): string {
  return `/recall ${noun}`
}
