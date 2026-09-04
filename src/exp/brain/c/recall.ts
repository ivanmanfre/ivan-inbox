// recall.ts, brain visibility item 3: a one-tap "recall <noun>" action under an
// answer. Pure extraction so the picked nouns can be asserted without a DOM: it
// reads the words that are ALREADY in the answer and never invents one.
//
// Two shapes are worth recalling by name:
//   - a `*.md` mention, a memory file the answer named outright.
//   - a capitalised multiword phrase, a person, a workflow, a project ("Alec
//     Lorenzo", "Content System"), because a single capitalised word is too
//     often just the start of a sentence to trust as a noun.

const MD_RE = /\b[\w-]+\.md\b/g
// Two or more consecutive Capitalized words. Deliberately excludes ALL-CAPS
// acronyms standing alone (RISE, ARCH), those are already the tenant filter's
// job, not a recall target, but an acronym inside a longer phrase ("RISE DTC
// Board") still matches because the run only needs each word to start upper-case.
const PHRASE_RE = /\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)+\b/g

const MAX_NOUNS = 3

/**
 * Every recall-worthy noun in an answer, in first-seen order, de-duplicated,
 * capped at MAX_NOUNS so the row under an answer stays a row and not a wall of
 * chips.
 */
export function extractRecallNouns(text: string): string[] {
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const v = raw.trim()
    const key = v.toLowerCase()
    if (v.length < 3 || seen.has(key)) return
    seen.add(key)
    out.push(v)
  }
  for (const m of text.match(MD_RE) ?? []) push(m)
  for (const m of text.match(PHRASE_RE) ?? []) push(m)
  return out.slice(0, MAX_NOUNS)
}

/** What the composer actually sends when a recall chip is tapped. */
export function recallPrompt(noun: string): string {
  return `/recall ${noun}`
}
