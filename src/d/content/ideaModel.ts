import type { IdeaCandidate } from '../../lib/content'
import { ideaWhy, type ClientIdea } from '../../lib/clientIdeas'
import type { OutlierRow } from '../../lib/outliers'
import { age, type Lane } from './model'

// One shape for an idea from either bank: Ivan's (lm_idea_candidates) and a
// client's (client_ideas via operator_client_ideas). Highest score first; an
// unscored idea says "none" and sorts last.
export type IdeaItem = {
  id: string
  evidenceQuote?: string | null
  proof?: string
  rank?: number
  outlier?: OutlierRow
  saved?: boolean
  generating?: boolean
  lane: Lane
  title: string
  score: number | null
  src: string
  age: string
  parts: [string, number][]
  why: string | null
  angle: string | null
  format: string | null
  ivan?: IdeaCandidate
  client?: ClientIdea
  /** Ivan's bank only: a row with no content_type rides with the post ideas, labelled (today's rule). */
  unclassified?: boolean
}

const SRC: Record<string, string> = { manual: 'Manual', ivan_call: 'Your calls', kyle_call: 'Kyle’s calls', calls: 'Calls', x_viral: 'X', x_search: 'X', reddit_se: 'Reddit', claude_sessions: 'Sessions', competitor: 'Competitor posts' }

export function fromCandidate(i: IdeaCandidate, now?: number, unclassified = false): IdeaItem {
  const parts: [string, number | null][] = [['ICP', i.icp_fit_score], ['Virality', i.virality_score], ['Gap', i.gap_score], ['Beat', i.beat_fit_score], ['Signal', i.signal_strength]]
  return {
    id: i.id, lane: 'ivan', title: i.normalized_topic || i.raw_topic || 'Untitled idea',
    score: i.composite_score, src: SRC[i.source ?? ''] ?? i.source ?? '', age: i.ingested_at ? age(i.ingested_at, now) : '',
    parts: parts.filter((p): p is [string, number] => p[1] != null), why: i.why_score, angle: i.post_angle,
    format: i.format_recommendation, ivan: i, unclassified, evidenceQuote: Array.isArray(i.evidence) && typeof i.evidence[0]?.quote === 'string' ? i.evidence[0].quote : null,
  }
}

export function fromClient(i: ClientIdea, lane: Lane, now?: number): IdeaItem {
  const raw = i as ClientIdea & { idea?: Record<string, unknown>; meta?: { source_detail?: { quote?: unknown } } }
  const detail = raw.idea?.source_detail as { quote?: unknown } | undefined
  const quote = [i.score_breakdown?.quote, i.score_breakdown?.anchor_quote, i.score_breakdown?.verbatim_quote, raw.idea?.verbatim_quote, raw.idea?.anchor_quote, detail?.quote, raw.meta?.source_detail?.quote].find(v => typeof v === 'string' && v.trim())
  return {
    id: i.id, lane, title: i.title || i.hook || 'Untitled idea', score: i.icp_score,
    src: i.source_label ?? '', age: i.created_at ? age(i.created_at, now) : '',
    parts: i.icp_score != null ? [['ICP', i.icp_score]] : [], why: ideaWhy(i.score_breakdown),
    angle: i.hook && i.hook !== i.title ? i.hook : null,
    evidenceQuote: typeof quote === 'string' ? quote : null,
    format: [i.pillar, i.format].filter(Boolean).join(' · ') || null, client: i,
  }
}

export function byScore(a: IdeaItem, b: IdeaItem): number {
  return (b.score ?? -Infinity) - (a.score ?? -Infinity)
}

export function scoreText(s: number | null): string {
  return s == null || s < 0 ? 'none' : String(Math.round(s))
}

/** A source_ref is a link on some sources and a row id on others; only the link shape is drawn. */
export function linkOf(ref: string | null | undefined): string | null {
  return ref && /^https?:/.test(ref) ? ref : null
}
