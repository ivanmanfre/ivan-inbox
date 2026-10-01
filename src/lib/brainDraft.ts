import { taxonomyValue, type ContentDraft } from './content'

export type DraftSource = Pick<ContentDraft, 'taxonomy' | 'source_ref' | 'cb34_p2_member'>
export function isBrainPost(draft: Pick<ContentDraft, 'taxonomy' | 'cb34_p2_member'> | null): boolean {
  return !!draft && (draft.cb34_p2_member === true || taxonomyValue(draft.taxonomy, 'source') === 'content-brain')
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
export function brainDraftSource(draft: DraftSource) {
  const taxonomy = typeof draft.taxonomy === 'string' ? (() => { try { return JSON.parse(draft.taxonomy) } catch { return {} } })() : draft.taxonomy
  const brief = record(record(taxonomy).brain_brief), pattern = record(brief.pattern)
  const url = text(brief.source_url)
  const sourceUrl = url && /^https:\/\//i.test(url) ? url : null
  const dimension = text(pattern.dimension), value = text(pattern.value)
  const n = typeof pattern.n === 'number' && Number.isSafeInteger(pattern.n) && pattern.n >= 25 ? pattern.n : null
  return { sourceUrl, sourceRef: text(brief.source_ref) ?? text(draft.source_ref), why: text(brief.why_this_post), pattern: dimension && value && n != null ? `${dimension}: ${value} · n=${n}` : null }
}
