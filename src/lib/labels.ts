// The one shared label map. A raw database value (an enum, a status code, a
// pipeline slug) should never reach JSX untouched. This file is the single
// place that turns one into words a human reads, so a new caller fixes the
// CLASS of leak rather than adding an eighth hand-rolled instance.
//
// Two entry points:
//   label(value)       - the whole field IS the value ('dm_sent', 'QA_BLOCKED').
//   inlineLabel(text)   - the value is EMBEDDED inside a free-text sentence a
//                         human or a scorer already wrote (icp_reasoning), so
//                         only the known raw tokens inside it are swapped;
//                         the surrounding prose is never touched.
//
// Pure and dependency-free on purpose: nothing here reaches Supabase, reads
// the DOM, or knows about React, so it stays trivial to unit test and safe to
// import from anywhere (a .tsx call site, a .ts formatter, another lib file).

// Reserved for a future caller that needs the same raw value to read
// differently in two places at once (a 'kind' meaning one thing in the DM
// register and another in the content register). No such collision exists in
// the eight values known today, so it is accepted and otherwise unused.
export type LabelKind = 'status' | 'kind' | 'reason' | 'stage'

// The known values, lower-cased. Lookup is case-insensitive so 'dm_sent' and
// 'Dm_sent' (the same column, two casings live in production) hit one entry.
const KNOWN: Record<string, string> = {
  dm_sent: 'DM sent',
  thread_already_answered: 'Already answered',
  lead_magnet: 'Lead magnet',
  youtube_watch: 'YouTube watch',
  qa_blocked: 'Blocked by QA',
  lint_fail: 'Failed the language check',
  gold_icp_v2_seatless: 'Gold ICP (v2)',
  // The QA gate's own verdict word. sentenceCase() alone would read "Needs
  // regenerate" — grammatically off in a way the other five verdicts are not.
  needs_regenerate: 'Needs regeneration',
  // scheduled_posts' own status vocabulary (content.ts QUEUE_STATUSES). The
  // '_v2' is a migration artefact, not a fact worth printing at a reader.
  queued_v2: 'Queued',
  // agent_log.source: the automation platform's own name, not a word an
  // operator reading a log entry needs — it only ever distinguishes a live
  // pipeline step from a clickup_backfill reconstruction (isBackfillEntry).
  n8n: 'Automated',
  linkedin: 'LinkedIn',
}

// A value already written for a human: it carries a space and no underscore
// ('Not accepted yet', 'Sent'). Passed through untouched: running it through
// the fallback below would just lower-case and re-capitalise words that are
// already correct.
function isAlreadyHuman(value: string): boolean {
  return value.includes(' ') && !value.includes('_')
}

// The degrade path for a value this map has never seen. A raw token must
// never reach the screen bare: split on underscores AND colons (a race-hold
// reason arrives as 'post_approval_race:some_id'), sentence-case the words,
// keep the rest. 'some_new_enum_v3' -> 'Some new enum v3'.
function sentenceCase(value: string): string {
  const words = value.trim().split(/[_:\s]+/).filter(Boolean)
  if (words.length === 0) return value
  const joined = words.join(' ').toLowerCase()
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}

export function label(value: string | null | undefined, _kind?: LabelKind): string {
  if (value === null || value === undefined) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (isAlreadyHuman(trimmed)) return trimmed
  const known = KNOWN[trimmed.toLowerCase()]
  if (known) return known
  return sentenceCase(trimmed)
}

// The post-format vocabulary, kept DELIBERATELY out of KNOWN above. Two
// reasons. It is a closed set with its own established words (a single_image
// post is an "Image" everywhere in this app, not a "Single image"), and KNOWN
// feeds the inline replacer below, where a 'text' entry would rewrite the word
// "text" inside any sentence that happens to contain it.
//
// It lives here rather than in v2c/fmt.ts so the facet builder in src/lib can
// read it without a layer inversion; fmt.ts re-exports it, so every existing
// call site keeps working and there is exactly one map.
const TYPE_LABEL: Record<string, string> = { text: 'Text', single_image: 'Image', carousel: 'Carousel' }

export function typeLabel(t: string | null | undefined): string {
  if (!t) return 'Text'
  return TYPE_LABEL[t] ?? label(t)
}

// A regex alternation of the known raw tokens, longest first so
// 'gold_icp_v2_seatless' never partially matches a shorter neighbour that
// does not exist yet. Built once, module scope.
const KNOWN_KEYS = Object.keys(KNOWN).sort((a, b) => b.length - a.length)
const INLINE_RE = new RegExp(`\\b(${KNOWN_KEYS.join('|')})\\b`, 'gi')

// Swaps ONLY the known raw tokens found inside a larger, already-human
// sentence (icp_reasoning: "RISE warm engager (gold_icp_v2_seatless 66/78):
// ..."). Everything else in the string is the scorer's own prose and stays
// exactly as written: running the whole sentence through label()'s fallback
// would lower-case and re-join words that were never a database value.
export function inlineLabel(text: string | null | undefined): string {
  if (text === null || text === undefined) return ''
  if (!text) return text
  return text.replace(INLINE_RE, m => KNOWN[m.toLowerCase()] ?? m)
}
