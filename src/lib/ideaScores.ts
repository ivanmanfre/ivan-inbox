/* ==========================================================================
   IDEA SCORES — CB-15's outlier-recipe score, read on Ivan's operator idea
   lists only (lm_idea_candidates via IdeasSection, client_ideas via
   ClientIdeasSection). `operator_idea_scores('clientops', lane)` (db cb15u)
   copies operator_market_outliers' gate/grants pattern byte-for-byte:
   SECURITY DEFINER, operator_gate_ok + lane_allowed, anon revoked by name,
   authenticated-only. It returns the newest idea_scores row per
   (idea_table, idea_ref) for the lane, contributions already cut to the top
   3 by |beta|.

   idea_scores is a NEW, additive signal (P4 W-W1/W-W2) sitting beside tables
   that already have their own order (lm_idea_candidates.composite_score,
   the operator_client_ideas icp_score ordering). A failed or empty read must
   never block or reorder the list it decorates, so every function here fails
   soft to "render exactly as today" instead of throwing:
     · fetchIdeaScores never rejects — a bad read comes back `{ ok: false }`;
     · sortByScore returns the SAME array, untouched, whenever the read
       failed or the client is not validated. Validated clients are the only
       case that reorders anything (P4 W-W2: "Unvalidated clients ... NO
       change in sort order").
   ========================================================================== */
import { supabase } from './supabase'
import { CLIENT_OPS_GATE, type ContentLane } from './content'

export type IdeaContribution = { indicator: string; beta: number; words: string | null }

export type IdeaScoreRow = {
  idea_table: string
  idea_ref: string
  model_version: string | null
  stage: string | null
  score: number | null
  validated: boolean | null
  contributions: IdeaContribution[]
  recommended_format: string | null
  scored_at: string | null
}

export type IdeaScoreTable = 'lm_idea_candidates' | 'client_ideas'

export type IdeaScoreRead = {
  ok: boolean
  /** idea_ref -> row, already narrowed to the requested idea_table. */
  byRef: ReadonlyMap<string, IdeaScoreRow>
  /** True only when at least one row was read AND every row for this lane at
      this idea_table carries validated=true. Empty or mixed reads count as
      unvalidated — the fail-safe direction, since it is the direction that
      leaves sort order untouched. */
  validated: boolean
}

const EMPTY_READ: IdeaScoreRead = { ok: false, byRef: new Map(), validated: false }

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function toContribution(raw: unknown): IdeaContribution | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const indicator = str(r.indicator)
  const beta = num(r.beta)
  if (indicator === null || beta === null) return null
  return { indicator, beta, words: str(r.words) }
}

function toRow(raw: unknown): IdeaScoreRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const idea_table = str(r.idea_table)
  const idea_ref = str(r.idea_ref)
  if (idea_table === null || idea_ref === null) return null
  const contributions = Array.isArray(r.contributions)
    ? r.contributions.map(toContribution).filter((c): c is IdeaContribution => c !== null)
    : []
  return {
    idea_table, idea_ref,
    model_version: str(r.model_version),
    stage: str(r.stage),
    score: num(r.score),
    validated: typeof r.validated === 'boolean' ? r.validated : null,
    contributions,
    recommended_format: str(r.recommended_format),
    scored_at: str(r.scored_at),
  }
}

/** Reads every idea_scores row for a lane and narrows it to one idea_table.
    Never throws — a bad read renders the list exactly as it does today, so
    every call site gets `{ ok: false }` instead of a try/catch it would have
    to remember to add. */
export async function fetchIdeaScores(
  lane: ContentLane, ideaTable: IdeaScoreTable,
): Promise<IdeaScoreRead> {
  try {
    const { data, error } = await supabase.rpc('operator_idea_scores', {
      p_gate: CLIENT_OPS_GATE, p_client_id: lane,
    })
    if (error || !Array.isArray(data)) return EMPTY_READ
    const rows = data.map(toRow).filter((r): r is IdeaScoreRow => r !== null)
      .filter(r => r.idea_table === ideaTable)
    if (rows.length === 0) return EMPTY_READ
    const byRef = new Map(rows.map(r => [r.idea_ref, r]))
    const validated = rows.every(r => r.validated === true)
    return { ok: true, byRef, validated }
  } catch {
    return EMPTY_READ
  }
}

/** Plain-words contribution line, e.g. "carousel +0.4 · contrarian +0.3". */
export function contributionsLine(row: IdeaScoreRow | undefined): string | null {
  if (!row || row.contributions.length === 0) return null
  return row.contributions
    .map(c => `${c.words ?? c.indicator} ${c.beta >= 0 ? '+' : ''}${c.beta.toFixed(1)}`)
    .join(' · ')
}

/** Validated → sort by score desc, rows with no score row keep their
    relative order at the tail. Unvalidated, or a failed/empty read → the
    array comes back UNCHANGED (same values, same order) because P4 W-W2
    forbids touching the existing order function for an unvalidated client. */
export function sortByScore<T>(
  rows: readonly T[], scores: IdeaScoreRead, refOf: (row: T) => string,
): T[] {
  if (!scores.ok || !scores.validated) return [...rows]
  return rows
    .map((row, index) => ({ row, index, score: scores.byRef.get(refOf(row))?.score ?? null }))
    .sort((a, b) => {
      if (a.score !== null && b.score !== null) return b.score - a.score
      if (a.score !== null) return -1
      if (b.score !== null) return 1
      return a.index - b.index // stable: original order preserved among the unscored
    })
    .map(x => x.row)
}
