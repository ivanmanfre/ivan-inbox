import { taxonomyValue, type ContentDraft } from './content'

export type DraftSource = Pick<ContentDraft, 'taxonomy' | 'source_ref' | 'cb34_p2_member'> & { source_kind?: string | null; source_detail?: unknown; source_label?: string | null }
export function isBrainPost(draft: Pick<ContentDraft, 'taxonomy' | 'cb34_p2_member'> | null): boolean {
  return !!draft && (draft.cb34_p2_member === true || taxonomyValue(draft.taxonomy, 'source') === 'content-brain')
}
const record = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') { try { return record(JSON.parse(value)) } catch { return {} } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
export function brainDraftSource(draft: DraftSource) {
  const taxonomy = record(draft.taxonomy), detail = record(draft.source_detail)
  const brief = record(taxonomy.brain_brief), pattern = record(brief.pattern)
  const url = text(brief.source_url) ?? text(detail.url)
  const sourceRef = text(brief.source_ref) ?? text(draft.source_ref)
  const kind = (text(draft.source_kind) ?? text(detail.kind) ?? '').toLowerCase()
  const isOutlier = /^outlier:/i.test(sourceRef ?? '') || ['outlier', 'x_tracked_outlier'].includes(kind) || taxonomy.source === 'x_tracked_outlier' || (brief.slot === 'outlier' && !!url)
  let sourceAuthor = text(brief.source_author) ?? text(detail.source_author) ?? text(detail.author_name) ?? text(detail.handle)
  if (isOutlier && !sourceAuthor) {
    sourceAuthor = draft.source_label?.match(/\b(?:X|LinkedIn) outlier by (@[\w.-]+)/i)?.[1] ?? null
    if (!sourceAuthor && url) {
      try {
        const original = new URL(url)
        if (original.protocol === 'https:' && /^(www\.)?linkedin\.com$/i.test(original.hostname)) sourceAuthor = original.pathname.match(/^\/posts\/([a-z0-9-]+)_/i)?.[1] ?? null
        if (original.protocol === 'https:' && /^(www\.)?(x|twitter)\.com$/i.test(original.hostname)) sourceAuthor = original.pathname.match(/^\/([a-z0-9_]+)\/status\/\d+/i)?.[1] ?? null
      } catch { /* No author can be recovered from an invalid URL. */ }
    }
  }
  // Display name verified against competitor_roster on 2026-10-16; other handles stay literal.
  if (sourceAuthor?.replace(/^@/, '').toLowerCase() === 'davegerhardt') sourceAuthor = 'Dave Gerhardt'
  const sourceUrl = url && /^https:\/\//i.test(url) ? url : null
  const dimension = text(pattern.dimension), value = text(pattern.value)
  const n = typeof pattern.n === 'number' && Number.isSafeInteger(pattern.n) && pattern.n >= 25 ? pattern.n : null
  return { sourceUrl, sourceRef, sourceAuthor, isOutlier, why: text(brief.why_this_post), pattern: dimension && value && n != null ? `${dimension}: ${value} · n=${n}` : null }
}
