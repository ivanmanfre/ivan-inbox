import { supabase } from './supabase'
import { CLIENT_OPS_GATE } from './content'
import type { Lane } from '../d/content/model'

export type PatternRate = {
  client_id: string; dimension: string; value: string; n: number; breakouts: number; rate: number
  base_n: number; base_rate: number; lift: number | null
  computed_at: string | null; study_id: string | null
  wilson_low: number | null; wilson_high: number | null
}
export type Holdout = {
  state: 'confirmed' | 'not_confirmed' | 'cannot_judge'; reason: string | null; limitation: string | null
  train_n: number | null; test_n: number | null; eligible_n: number | null; unsupported_n: number | null
  top: { n: number | null; rate: number | null }; bottom: { n: number | null; rate: number | null }
}
export type PatternRead = {
  state: 'ready' | 'no_read_yet' | 'loading' | 'failed' | 'unsaved'
  reason: string | null; pattern: PatternRate | null; sentence: string | null
  recipeFit: { score: number | null; validated: boolean; reason: string | null; modelVersion: string | null; stage: 'idea' | 'draft' | null } | null
  bodyHash: string | null; computedAt: string | null
  holdout: Holdout | null; smallSample: boolean
}
export type DraftRead = PatternRead & { draftId: string }
export type PatternResults = {
  client: Lane; computedAt: string | null; patterns: PatternRate[]
  topPatterns: PatternRate[]; bottomPatterns: PatternRate[]; holdout: Holdout | null; smallSample: boolean
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v : null
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null
const fraction = (v: unknown): number | null => { const n = number(v); return n != null && n >= 0 && n <= 1 ? n : null }
const count = (v: unknown): number | null => { const n = number(v); return n != null && Number.isInteger(n) && n >= 0 ? n : null }

export function parsePattern(raw: unknown, lane?: Lane): PatternRate | null {
  const p = object(raw)
  const n = count(p.n), breakouts = count(p.breakouts), rate = fraction(p.rate), baseN = count(p.base_n), baseRate = fraction(p.base_rate)
  if ((lane && p.client_id !== lane) || !['topic_class', 'angle', 'proof_type', 'stakes'].includes(String(p.dimension)) || !text(p.value) || n == null || n < 25 || breakouts == null || breakouts > n || rate == null || baseN == null || baseN < 25 || baseRate == null) return null
  return { client_id: text(p.client_id) ?? '', dimension: String(p.dimension), value: String(p.value), n, breakouts, rate, base_n: baseN, base_rate: baseRate,
    lift: number(p.lift), computed_at: text(p.computed_at), study_id: text(p.study_id), wilson_low: fraction(p.wilson_low), wilson_high: fraction(p.wilson_high) }
}
function parseHoldout(raw: unknown): Holdout | null {
  const h = object(raw), top = object(h.top), bottom = object(h.bottom)
  if (h.state !== 'confirmed' && h.state !== 'not_confirmed' && h.state !== 'cannot_judge') return null
  return { state: h.state, reason: text(h.reason), limitation: text(h.limitation), train_n: count(h.train_n), test_n: count(h.test_n), eligible_n: count(h.eligible_n), unsupported_n: count(h.unsupported_n),
    top: { n: count(top.n), rate: fraction(top.rate) }, bottom: { n: count(bottom.n), rate: fraction(bottom.rate) } }
}
export function holdoutText(h: Holdout): string {
  if (h.state === 'confirmed') return h.reason || 'Recent-post check passed.'
  const state = 'Not yet confirmed on recent posts.'
  return h.reason && h.reason.toLowerCase().replace(/\.$/, '') !== state.toLowerCase().replace(/\.$/, '') ? `${state} ${h.reason}` : state
}
export function readReasonText(reason: string | null): string {
  const messages: Record<string, string> = {
    body_changed: 'The body changed. Waiting for a read of this version.',
    empty_body: 'This draft needs a body before an early read can be made.',
    queued: 'This body is queued for an early read.',
    refused: 'The label request was refused. No read was made.',
    provider_timeout: 'The label request timed out. No read was made.',
    empty_response: 'The label request returned no text. No read was made.',
    invalid_labels: 'The label request returned unusable labels. No read was made.',
    budget_exhausted: 'The early-read call limit has been reached.'
  }
  return reason ? messages[reason] || reason : 'No eligible pattern with at least 25 niche posts.'
}
export function noRead(reason = 'No matching labelled read is stored yet.'): PatternRead {
  return { state: 'no_read_yet', reason, pattern: null, sentence: null, recipeFit: null, bodyHash: null, computedAt: null, holdout: null, smallSample: false }
}
export function parsePatternRead(raw: unknown, lane?: Lane): PatternRead {
  const r = object(raw), pattern = parsePattern(r.pattern, lane), recipe = object(r.recipe_fit)
  const ready = r.state === 'ready' && pattern != null && text(r.sentence) != null
  return { state: ready ? 'ready' : 'no_read_yet', pattern: ready ? pattern : null,
    reason: text(r.reason) ?? (ready ? null : r.state === 'ready' ? 'No eligible pattern with at least 25 niche posts.' : 'No matching labelled read is stored yet.'),
    sentence: text(r.sentence), bodyHash: text(r.body_hash), computedAt: text(r.computed_at) ?? pattern?.computed_at ?? null,
    recipeFit: typeof recipe.validated === 'boolean' ? { score: number(recipe.score), validated: recipe.validated, reason: text(recipe.reason), modelVersion: text(recipe.model_version), stage: recipe.stage === 'idea' || recipe.stage === 'draft' ? recipe.stage : null } : null,
    holdout: parseHoldout(r.holdout), smallSample: r.small_sample === true }
}
export function parseDraftReads(raw: unknown, lane: Lane, ids: string[]): DraftRead[] {
  const d = object(raw)
  if (d.ok !== true || d.client !== lane || !Array.isArray(d.reads)) throw new Error('Early reads returned no usable client data.')
  const wanted = new Set(ids), seen = new Set<string>()
  return d.reads.map(raw => {
    const r = object(raw), id = text(r.draft_id)
    if (!id || !wanted.has(id) || seen.has(id) || r.client_id !== lane) throw new Error('An early read returned a different draft.')
    seen.add(id)
    return { ...parsePatternRead(r, lane), draftId: id }
  })
}
export function parseResults(raw: unknown, lane: Lane): PatternResults {
  const d = object(raw)
  if (d.ok !== true || d.client !== lane || !Array.isArray(d.patterns) || !Array.isArray(d.top_patterns) || !Array.isArray(d.bottom_patterns)) throw new Error('Niche patterns returned no usable client data.')
  const rows = (r: unknown[]) => r.map(p => parsePattern(p, lane)).filter((p): p is PatternRate => p != null)
  return { client: lane, computedAt: text(d.computed_at), patterns: rows(d.patterns), topPatterns: rows(d.top_patterns).slice(0, 3), bottomPatterns: rows(d.bottom_patterns).slice(0, 3), holdout: parseHoldout(d.holdout), smallSample: d.small_sample === true }
}
export async function fetchDraftReads(lane: Lane, ids: string[], signal?: AbortSignal): Promise<DraftRead[]> {
  const query = supabase.rpc('cb33_draft_reads', { p_gate: CLIENT_OPS_GATE, p_client: lane, p_draft_ids: ids })
  const { data, error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw new Error(error.message || 'Could not read the niche patterns for these drafts.')
  return parseDraftReads(data, lane, ids)
}
export async function fetchPatternResults(lane: Lane, signal?: AbortSignal): Promise<PatternResults> {
  const query = supabase.rpc('cb33_results', { p_gate: CLIENT_OPS_GATE, p_client: lane })
  const { data, error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw new Error(error.message || 'Could not read what works in this niche.')
  return parseResults(data, lane)
}
export const rateText = (rate: number): string => `${(rate * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
