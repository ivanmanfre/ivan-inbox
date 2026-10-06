import { supabase } from './supabase'
import { brainDraftSource } from './brainDraft'
import type { ContentDraft } from './content'

// CONTENT BRAIN PAGE (run 51, 5 Oct). Two reads by key, both RPC:
//   cb51_draft_sources(ids)    the source behind each waiting draft: the brain member's stored passage,
//                              the draft's own source record (call quote, tracked post) and, for an
//                              outlier, its measured result against the author's usual.
//   cb51_decision_history(cl)  recorded brief decisions (as recorded, actor not relabelled) and where each
//                              judged draft went (status, published, own-post metrics when linked).
// `sourceOf` turns one draft + its read into the left column of the card. Pure.

export type OutlierStats = {
  author?: string | null
  handle?: string | null
  text?: string | null
  url?: string | null
  published_at?: string | null
  likes?: number | null
  views?: number | null
  comments?: number | null
  ratio?: number | null
  baseline?: number | null
  baseline_n?: number | null
}
export type DraftSourceRead = {
  draft_id: string
  member_state: string | null
  slot: string | null
  source_ref: string | null
  source_text: string | null
  detail: Record<string, unknown> | null
  x: OutlierStats | null
  linkedin: OutlierStats | null
  /** An editorial-brief draft: the brief's first evidence item, its objective and its planned structure. */
  brief?: { evidence: Record<string, unknown> | null; objective: string | null; structure: string | null } | null
}

export async function fetchDraftSources(ids: string[]): Promise<Map<string, DraftSourceRead>> {
  if (!ids.length) return new Map()
  const { data, error } = await supabase.rpc('cb51_draft_sources', { p_ids: ids.slice(0, 60) })
  if (error) throw new Error(error.message || 'Could not read the sources.')
  const rows = Array.isArray(data) ? data as DraftSourceRead[] : []
  return new Map(rows.filter(r => r && typeof r.draft_id === 'string').map(r => [r.draft_id, r]))
}

export type BriefRuling = { action: string; reason: string; at: string; target_kind: string; target_id: string }
export type DecisionLink = { draft_id: string; status: string | null; published_at: string | null; post_url: string | null; impressions: number | null; likes: number | null; comments: number | null }
export type DecisionHistory = { rulings: BriefRuling[]; links: Map<string, DecisionLink> }

export async function fetchDecisionHistory(lane: string): Promise<DecisionHistory> {
  const { data, error } = await supabase.rpc('cb51_decision_history', { p_client: lane })
  if (error) throw new Error(error.message || 'Could not read your decisions.')
  const d = (data ?? {}) as { rulings?: BriefRuling[]; links?: DecisionLink[] }
  return {
    rulings: Array.isArray(d.rulings) ? d.rulings : [],
    links: new Map((Array.isArray(d.links) ? d.links : []).map(l => [l.draft_id, l])),
  }
}

/** What the left column of a draft card shows. Every field is a recorded value or null, never a guess. */
export type SourceView = {
  /** One line naming what kind of source this is. */
  kind: string
  /** True when the text shown is an example of a pattern, not the post the draft adapts. */
  example: boolean
  author: string | null
  date: string | null
  url: string | null
  text: string | null
  /** How it did against that author's usual, when it was measured. */
  result: string | null
  /** Why the system picked it, in its own recorded words. */
  why: string | null
  /** What the draft borrows from it, when recorded. */
  borrowed: string | null
}

const rec = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const str = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null
const first = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) { const s = str(o[k]); if (s) return s } return null }
const fmt = (n: number) => n >= 100 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 10) / 10)

/** Only show a learning receipt when this account's brief records an applied decision. */
export function learnedFrom(r: Pick<ContentDraft, 'taxonomy'>, lane: string): string | null {
  const tax = rec(typeof r.taxonomy === 'string' ? (() => { try { return JSON.parse(r.taxonomy as string) } catch { return {} } })() : r.taxonomy)
  const learning = rec(rec(rec(tax.brain_brief).brief_v3).learning)
  const receipt = rec(learning.learned_from)
  if (learning.version !== 'cb52-a' || learning.client !== lane || !Array.isArray(learning.applied)) return null
  const id = str(receipt.id)
  if (!id || !learning.applied.some(a => rec(a).decision_id === id && rec(rec(a).decision).id === id)) return null
  return str(receipt.text)
}

/** "5,915 likes · 14.2x their usual (usual 538, 60 posts)" from measured numbers only. */
export function resultLine(s: OutlierStats | null | undefined): string | null {
  if (!s) return null
  const likes = num(s.likes), ratio = num(s.ratio), base = num(s.baseline), n = num(s.baseline_n)
  const parts: string[] = []
  if (likes != null) parts.push(`${fmt(likes)} likes`)
  if (ratio != null && ratio > 0) parts.push(`${fmt(ratio)}x their usual${base != null ? ` (usual ${fmt(base)}${n != null ? `, ${n} posts` : ''})` : ''}`)
  return parts.length ? parts.join(' · ') : null
}

function lineOfMedian(likes: number | null, median: Record<string, unknown>): string | null {
  const m = num(median.likes), n = num(median.n)
  if (likes == null) return null
  if (m == null || m <= 0) return `${fmt(likes)} likes`
  return `${fmt(likes)} likes · ${fmt(likes / m)}x their usual (usual ${fmt(m)}${n != null ? `, ${n} posts` : ''})`
}

function dateOf(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : s.slice(0, 10)
}

export function sourceOf(r: Pick<ContentDraft, 'taxonomy' | 'source_ref' | 'cb34_p2_member' | 'source_label'>, read: DraftSourceRead | undefined): SourceView {
  const tax = rec(typeof r.taxonomy === 'string' ? (() => { try { return JSON.parse(r.taxonomy as string) } catch { return {} } })() : r.taxonomy)
  const brief = rec(tax.brain_brief)
  const brain = brainDraftSource(r)
  const detail = rec(read?.detail)
  const kindOf = str(detail.kind)
  const ref = read?.source_ref ?? str(brief.source_ref)
  const slot = read?.slot ?? str(brief.slot)
  const shape = str(brief.shape)

  // 1. Content brain, pattern-led: the text is an example of the pattern, never "the post we adapt".
  if (slot === 'pattern' || ref?.startsWith('pattern:')) {
    return {
      kind: 'Pattern-led idea', example: true, author: str(brief.source_author), date: null, url: brain.sourceUrl,
      text: read?.source_text ?? null, result: brain.pattern ? `Pattern ${brain.pattern}` : null, why: brain.why, borrowed: shape,
    }
  }
  // 2. Content brain, one outlier post.
  if (slot === 'outlier' || ref?.startsWith('outlier:')) {
    const st = read?.x ?? read?.linkedin ?? null
    return {
      kind: ref?.startsWith('outlier:x:') ? 'Industry post on X' : 'Industry post on LinkedIn', example: false,
      author: st?.author ?? str(brief.source_author), date: dateOf(st?.published_at), url: st?.url ?? brain.sourceUrl,
      text: read?.source_text ?? st?.text ?? null, result: resultLine(st), why: brain.why, borrowed: shape,
    }
  }
  // 3. A tracked X post adapted lightly.
  if (kindOf === 'x_tracked_outlier') {
    return {
      kind: 'Industry post on X', example: false, author: first(detail, ['author_name', 'handle']), date: dateOf(detail.created_at),
      url: str(detail.url), text: str(detail.original_text), result: lineOfMedian(num(detail.likes), rec(detail.author_median)),
      why: str(r.source_label), borrowed: null,
    }
  }
  // 4. A call: the quote as said on the call.
  if (kindOf === 'call') {
    const speaker = str(detail.speaker)
    return {
      kind: 'From a call', example: false, author: speaker === 'colleague' ? 'A colleague on the call' : speaker,
      date: dateOf(detail.call_date), url: null, text: str(detail.quote),
      result: null, why: first(detail, ['explanation', 'note']) ?? first(detail, ['call_title', 'label']), borrowed: null,
    }
  }
  // 5. An editorial brief: its first evidence passage, as the brief recorded it.
  if (read?.brief && (read.brief.evidence || read.brief.objective)) {
    const ev = rec(read.brief.evidence), ref = rec(ev.source_ref)
    const url = str(ref.url) ?? (str(ev.source_id)?.startsWith('https://') ? str(ev.source_id) : null)
    return {
      kind: ev.source_kind === 'public_post' ? 'Industry source' : 'Editorial brief', example: false, author: str(ev.owner),
      date: dateOf(ev.source_published_date ?? ev.captured_date), url, text: str(ev.passage), result: null,
      why: read.brief.objective, borrowed: read.brief.structure,
    }
  }
  if (detail.lm_ref || kindOf === 'lm_launch') {
    return { kind: 'Lead magnet launch', example: false, author: null, date: null, url: null, text: null, result: null, why: `Resource: ${str(detail.lm_ref) ?? str(detail.label) ?? 'not recorded'}`, borrowed: null }
  }
  // 6. Everything else that names a source: an adapted post, a source review, an editorial note.
  const author = first(detail, ['author', 'competitor_name', 'author_name'])
  const likes = num(detail.likes), comments = num(detail.comments)
  const label = str(detail.label) ?? str(r.source_label)
  const kindWord = kindOf === 'competitor_adaptation' ? 'Adapted from an industry post'
    : kindOf === 'source_review' || kindOf === 'source_commentary' ? 'Industry source'
    : kindOf === 'case_study' ? 'Client result'
    : kindOf === 'idea' ? `Idea${label ? `: ${label}` : ''}`
    : label ?? 'Source not recorded'
  return {
    kind: kindWord, example: false, author, date: dateOf(detail.published_at ?? detail.sourced_at ?? detail.call_date),
    url: str(detail.source_url), text: first(detail, ['original_text', 'source_text', 'quote', 'passage']),
    result: likes != null ? `${fmt(likes)} likes${comments != null ? ` · ${fmt(comments)} comments` : ''}` : null,
    why: first(detail, ['explanation', 'note']), borrowed: first(detail, ['structure_kept']),
  }
}
