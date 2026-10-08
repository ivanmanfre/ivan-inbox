import type { ContentDraft } from '../../../lib/content'
import { waitsForReview } from '../ContentBrain'
import { laneOfRow } from '../weekModel'
import type { Lane } from '../model'

/** Exact source identity wins over freshness. The fallback never crosses a seat. */
export function reviewLanding(rows: ContentDraft[], lane: Lane, idea: string): string | null {
  const candidates = rows.filter(r => laneOfRow(r) === lane && waitsForReview(r)).sort((a, b) => b.created_at.localeCompare(a.created_at))
  return candidates.find(r => r.source_ref === idea || r.source_ref?.endsWith(`:${idea}`))?.id ?? candidates[0]?.id ?? null
}
