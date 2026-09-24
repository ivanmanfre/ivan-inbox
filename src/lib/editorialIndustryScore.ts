/** content-brain-15: the industry outlier engine inside the editorial lane.
 *
 * Two inputs, both read-only:
 *  - a source's industry score: the within-author log-lift of the v3 outlier finding linked to
 *    that exact industry post (mapped by the collector bridge into candidate_fields.linked_findings);
 *  - the client's recipe: the newest outlier_recipe_models row at stage 'idea'. Its `validated`
 *    flag (pre-registered holdout, CB-15 fork 4) decides whether scores may ORDER anything.
 *
 * An unvalidated recipe never reorders: its scores travel as labelled fields "for inspection only".
 * Formats are dynamic (fork 5): the engine picks from text | carousel | single_image only. */

export const V3_METHOD_VERSION = 'content-evidence-methods-v3'
export const ENGINE_FORMATS = ['text', 'carousel', 'single_image'] as const
export type EngineFormat = typeof ENGINE_FORMATS[number]
/** A count+purpose slot: the frozen week carries no format decision; the brief takes one of
 * ENGINE_FORMATS at synthesis. Never video. */
export const DYNAMIC_SLOT_FORMAT = 'dynamic'

export const isEngineFormat = (value: unknown): value is EngineFormat =>
  typeof value === 'string' && (ENGINE_FORMATS as readonly string[]).includes(value)

/** True when a frozen slot may be filled with `format` (exact, or a dynamic slot and an engine format). */
export const slotAcceptsFormat = (slotFormat: string, format: unknown) =>
  slotFormat === DYNAMIC_SLOT_FORMAT ? isEngineFormat(format) : slotFormat === format

/** A slot whose brief may become `format`: used to decide which format-specific canon a week needs. */
export const slotMayBecome = (slotFormat: string, format: string) => slotAcceptsFormat(slotFormat, format)

export type RecipeContribution = { indicator: string; beta: number; words: string }
export type IndustryRecipe = {
  model_version: string
  validated: boolean
  top_contributions: RecipeContribution[]
  /** Format indicator betas for the three engine formats, highest first (missing indicator = 0, the reference). */
  format_ranking: Array<{ format: EngineFormat; beta: number }>
}

const finite = (value: unknown) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}
const round4 = (n: number) => Math.round(n * 10_000) / 10_000

/** Log-lift of a v3 finding: ln(lift) for a positive lift, 4 decimals so snapshot hashes stay stable. */
export function v3LogLift(finding: { method_version?: unknown; lift?: unknown }): number | null {
  if (finding.method_version !== V3_METHOD_VERSION) return null
  const lift = finite(finding.lift)
  return lift !== null && lift > 0 ? round4(Math.log(lift)) : null
}

/** The source's industry score: the highest log-lift among its linked v3 findings, or null. */
export function industryScoreOf(source: { candidate_fields?: Record<string, unknown> | null }): number | null {
  const findings = source.candidate_fields?.linked_findings
  if (!Array.isArray(findings)) return null
  const scores = findings.map(f => f && typeof f === 'object' ? finite((f as Record<string, unknown>).log_lift) : null)
    .filter((n): n is number => n !== null)
  return scores.length ? Math.max(...scores) : null
}

function wordsFor(plainWords: unknown, indicator: string): string {
  if (Array.isArray(plainWords)) {
    const hit = plainWords.find(x => x && typeof x === 'object' && (x as Record<string, unknown>).indicator === indicator)
    const words = hit ? (hit as Record<string, unknown>).words : null
    return typeof words === 'string' && words.trim() ? words : indicator
  }
  if (plainWords && typeof plainWords === 'object') {
    const words = (plainWords as Record<string, unknown>)[indicator]
    if (typeof words === 'string' && words.trim()) return words
  }
  return indicator
}

/** Parse the newest outlier_recipe_models row (stage 'idea') for one client. Anything malformed is
 * treated as absent, which is the unvalidated (never-reorder) path. */
export function recipeFromModelRow(row: unknown, clientId: string): IndustryRecipe | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const value = row as Record<string, unknown>
  if (value.client_id !== clientId || value.stage !== 'idea' || typeof value.model_version !== 'string' ||
      !value.model_version.trim()) return null
  const coefficients = value.coefficients && typeof value.coefficients === 'object' && !Array.isArray(value.coefficients)
    ? value.coefficients as Record<string, unknown> : {}
  const betas = Object.entries(coefficients).map(([indicator, beta]) => ({ indicator, beta: finite(beta) }))
    .filter((x): x is { indicator: string; beta: number } => x.beta !== null)
  const top_contributions = [...betas].sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta) || a.indicator.localeCompare(b.indicator))
    .slice(0, 10).map(x => ({ indicator: x.indicator, beta: round4(x.beta), words: wordsFor(value.plain_words, x.indicator) }))
  const format_ranking = ENGINE_FORMATS.map(format => ({ format,
    beta: round4(betas.find(x => x.indicator === `format=${format}`)?.beta ?? 0) }))
    .sort((a, b) => b.beta - a.beta || ENGINE_FORMATS.indexOf(a.format) - ENGINE_FORMATS.indexOf(b.format))
  return { model_version: value.model_version, validated: value.validated === true, top_contributions, format_ranking }
}

/** Labelled per-source fields for the SOURCES JSON. Empty for a source without a v3 score, so a
 * source the engine has not scored keeps its exact prompt bytes. */
export function industryFieldsFor(source: { candidate_fields?: Record<string, unknown> | null },
  recipe: IndustryRecipe | null): Record<string, unknown> {
  const score = industryScoreOf(source)
  if (score === null) return {}
  const findings = source.candidate_fields?.linked_findings as unknown[]
  const contributions = findings.flatMap(f => f && typeof f === 'object' &&
    Array.isArray((f as Record<string, unknown>).contributions) ? (f as Record<string, unknown>).contributions as unknown[] : [])
  return { industry_score: score, industry_score_basis: 'within-author log-lift of the linked v3 outlier finding',
    industry_score_validated: recipe?.validated === true,
    industry_contributions: contributions.length ? contributions : null }
}

/** One instruction line for the prompt. Null when nothing is scored and no dynamic slot exists,
 * so a week the engine does not touch keeps its exact prompt bytes. */
export function industryInstruction(recipe: IndustryRecipe | null, anyScored: boolean, dynamicSlots: boolean): string | null {
  if (!anyScored && !dynamicSlots) return null
  const lines: string[] = []
  if (recipe) {
    const words = recipe.top_contributions.map(c => `${c.words} ${c.beta >= 0 ? '+' : ''}${c.beta}`).join('; ')
    lines.push(recipe.validated
      ? `INDUSTRY RECIPE ${recipe.model_version} (VALIDATED on a pre-registered holdout): top contributions: ${words || 'none recorded'}. Prefer directions built on sources with a higher validated industry_score.`
      : `INDUSTRY RECIPE ${recipe.model_version} (UNVALIDATED: for inspection only; it must not decide order or format): top contributions: ${words || 'none recorded'}.`)
  } else if (anyScored) lines.push('INDUSTRY SCORES (no recipe model recorded: industry_score is for inspection only and must not decide order or format).')
  if (anyScored) lines.push('industry_score is the within-author log-lift of a measured industry outlier; it describes the original author\'s post, never a prediction or a claim about this client, and never evidence for causal or commercial statements.')
  if (dynamicSlots) {
    const ranking = recipe?.validated
      ? recipe.format_ranking.map(x => `${x.format} ${x.beta >= 0 ? '+' : ''}${x.beta}`).join(' > ') : null
    lines.push(`DYNAMIC FORMAT: a FROZEN WEEK tuple whose format is "${DYNAMIC_SLOT_FORMAT}" fixes only slot_id and purpose. Copy slot_id and purpose exactly and set S.format to exactly one of ${ENGINE_FORMATS.join(' | ')} (never video, lm_promo or resource). ${ranking
      ? `The validated recipe ranks formats ${ranking}: choose the highest-ranked format the cited material can fully support.`
      : 'No validated recipe: choose the format the cited material naturally fits.'}`)
  }
  return lines.join('\n')
}
