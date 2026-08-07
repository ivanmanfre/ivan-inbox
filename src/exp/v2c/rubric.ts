// THE QA RUBRIC, PARSED — best effort, and the fallback is the whole point.
//
// D14. `QaSummary` carries a dozen structured fields and the pane drew one of
// them: `feedback`, verbatim, as 2,187 characters of monospace running 1,240px
// tall in a 754px rail. Inside that string is the only copy of the nine-
// dimension rubric the judge actually scored — VOICE 8/10, SUBSTANCE 8/10,
// SPECIFICITY 7/10 and six more — with no parsed field anywhere in the schema.
//
// So it gets parsed out of the prose, under three rules:
//
//  1. BEST EFFORT, NEVER LOSSY. The raw string is always kept and always
//     reachable. This module extracts; it never edits and never summarises.
//  2. GRACEFUL FALLBACK. Under three matched dimensions the parse is declared
//     failed and the caller renders exactly what it rendered before — the
//     unfolded dump. A half-drawn rubric would be worse than no rubric,
//     because a missing dimension reads as a dimension that scored nothing.
//  3. THE CONTRADICTION IS THE INFORMATION. A live row carries
//     `verdict:'PASS'` with feedback opening `VERDICT: REWRITE_OK` — see
//     normalizeQa's comment at content.ts:1561. The verdict written INSIDE the
//     prose is therefore extracted as its own field so the pane can show the
//     disagreement rather than pick a winner.
//
// The shapes it reads, all observed on live rows:
//   `VERDICT: REWRITE_OK (total 71/90)`
//   `VOICE: 8/10 — sounds like him`
//   `AI_TELLS: 9/10`
//   `Summary: …`   `Spice: …`

export type RubricDim = {
  /** The judge's own key, verbatim and uppercase (`AI_TELLS`, never "AI tells"). */
  key: string
  score: number
  /** The denominator the judge printed. Never assumed — a dimension scored /5
   *  beside eight scored /10 is a real thing and averaging over it would lie. */
  max: number
  /** Whatever the judge wrote after the number on the same line, or null. */
  note: string | null
}

export type ParsedRubric = {
  ok: boolean
  dims: RubricDim[]
  /** The verdict word printed inside the prose — compare it to `qa.verdict`. */
  verdict: string | null
  /** `(total 71/90)` if the line carried one. */
  total: { score: number; max: number } | null
  summary: string | null
  spice: string | null
}

const EMPTY: ParsedRubric = {
  ok: false, dims: [], verdict: null, total: null, summary: null, spice: null,
}

// A dimension line. The key is SCREAMING_SNAKE by the judge's own convention,
// which is what keeps this from matching an ordinary sentence containing a
// fraction ("we cut 3/4 of the hook"): the key must be uppercase, 2+ chars, and
// sit at the head of its line.
const DIM = /^\s*([A-Z][A-Z0-9_]{1,23})\s*:\s*(\d{1,3}(?:\.\d)?)\s*\/\s*(\d{1,3})\s*(?:[—–\-·|]\s*)?(.*)$/
const VERDICT = /^\s*VERDICT\s*:\s*([A-Z_]{2,32})\s*(?:\(\s*total\s+(\d{1,3})\s*\/\s*(\d{1,3})\s*\))?/i
const LABELLED = /^\s*(Summary|Spice)\s*:\s*(.*)$/i

// Keys that are a HEADER rather than a dimension. `VERDICT: PASS` has no
// fraction so it never reaches DIM, but `TOTAL: 71/90` does and it is the sum
// of the dimensions, not one of them.
const NOT_A_DIM = new Set(['TOTAL', 'SCORE', 'OVERALL', 'VERDICT'])

/** The minimum a rubric has to yield before it is drawn as one. */
export const MIN_DIMS = 3

export function parseRubric(feedback: string | null | undefined): ParsedRubric {
  if (!feedback || typeof feedback !== 'string') return EMPTY
  const lines = feedback.split('\n')
  const dims: RubricDim[] = []
  const seen = new Set<string>()
  let verdict: string | null = null
  let total: { score: number; max: number } | null = null
  let summary: string | null = null
  let spice: string | null = null

  for (const raw of lines) {
    const v = VERDICT.exec(raw)
    if (v && verdict === null) {
      verdict = v[1].toUpperCase()
      if (v[2] && v[3]) total = { score: Number(v[2]), max: Number(v[3]) }
      continue
    }
    const l = LABELLED.exec(raw)
    if (l) {
      const body = l[2].trim()
      if (body) {
        if (l[1].toLowerCase() === 'summary') summary ??= body
        else spice ??= body
      }
      continue
    }
    const m = DIM.exec(raw)
    if (!m) continue
    const key = m[1].toUpperCase()
    // FIRST WIN, not last. A regeneration appends a second pass to the same
    // string and the first block is the one the printed verdict belongs to;
    // taking the last would caption pass 1's verdict with pass 2's numbers.
    if (NOT_A_DIM.has(key) || seen.has(key)) continue
    const max = Number(m[3])
    const score = Number(m[2])
    if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(score)) continue
    seen.add(key)
    dims.push({ key, score, max, note: m[4].trim() || null })
  }

  return { ok: dims.length >= MIN_DIMS, dims, verdict, total, summary, spice }
}

/**
 * Does the prose disagree with the stored verdict?
 *
 * 🔴 This is a QUESTION, never a correction. The live pair (`verdict:'PASS'` /
 * `VERDICT: REWRITE_OK`) is a real fact about the gate and the pane's job is to
 * show both, so this only ever returns whether to SAY that they differ.
 */
export function verdictsDisagree(stored: string | null, inProse: string | null): boolean {
  if (!stored || !inProse) return false
  return stored.trim().toUpperCase() !== inProse.trim().toUpperCase()
}
