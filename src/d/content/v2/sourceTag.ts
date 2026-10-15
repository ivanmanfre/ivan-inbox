import type { ContentDraft } from '../../../lib/content'
import { brainDraftSource } from '../../../lib/brainDraft'

// WHERE A DRAFT CAME FROM, as one short tag (Ivan 2026-10-15: "I need the source visible as a tag on each
// topic. That should be the first thing I see."). Pure and synchronous: read off the row's own fields
// (taxonomy.source, brain_brief.slot, source_detail.kind, source_label, source_ref), so the tag is there on
// the first paint and never waits on the sources read. The full recorded label rides in `title`.

export type SourceKey = 'brain' | 'call' | 'outlier' | 'industry' | 'lm' | 'news' | 'client' | 'portfolio' | 'idea' | 'editorial' | 'manual' | 'test' | 'other'
export type SourceTagView = { key: SourceKey; label: string; title: string }

type Row = Pick<ContentDraft, 'taxonomy' | 'source_label' | 'source_ref' | 'cb34_p2_member'> & { source_kind?: string | null; source_detail?: unknown }

const rec = (v: unknown): Record<string, unknown> => {
  if (typeof v === 'string') { try { return rec(JSON.parse(v)) } catch { return {} } }
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const SLOT: Record<string, string> = { outlier: 'Brain · Outlier', pattern: 'Brain · Pattern', winner: 'Brain · Winner' }

export function sourceTag(r: Row, owner = ''): SourceTagView {
  const tax = rec(r.taxonomy)
  const detail = rec(r.source_detail)
  const src = str(tax.source).toLowerCase()
  const kind = (str(r.source_kind) || str(detail.kind)).toLowerCase()
  const label = str(r.source_label)
  const ref = str(r.source_ref).toLowerCase()
  const slot = str(rec(tax.brain_brief).slot).toLowerCase()
  const said = label || str(tax.source) || 'Source not recorded'
  const tag = (key: SourceKey, text: string): SourceTagView => ({ key, label: text, title: said })
  const l = label.toLowerCase()

  if (kind === 'parity_scratch' || /voice (comparison|regression|verification)|parity-harness/.test(l)) return tag('test', 'Test')
  const source = brainDraftSource(r)
  if (source.isOutlier) {
    const author = source.sourceAuthor ?? 'Author unknown'
    return { key: 'outlier', label: `Outlier · ${author}`, title: `Repurposed outlier · ${source.sourceAuthor ? `From ${source.sourceAuthor}` : 'Author not recorded'}${source.sourceUrl ? ` · ${source.sourceUrl}` : ''}` }
  }
  if (r.cb34_p2_member === true || src === 'content-brain' || l === 'content brain' || slot) return tag('brain', SLOT[slot] ?? 'Brain')
  if (kind === 'lm_launch' || detail.lm_ref || /lead magnet/.test(l)) return tag('lm', 'Lead magnet')
  if (src === 'newsjack' || kind === 'newsjack' || /newsjack/.test(l)) return tag('news', 'Newsjack')
  if (kind === 'call' || /\bcalls?\b/.test(src) || /\bcalls?\b/.test(l) || ref.startsWith('ffc-') || ref.startsWith('transcripts/')) return tag('call', 'Call')
  if (src === 'competitor' || src === 'proven-winner-mirror' || ['competitor_adaptation', 'source_review', 'source_commentary'].includes(kind) || /adapted from a post|proven winner|winner replica/.test(l)) return tag('industry', 'Industry post')
  // SwishDM's carousels copy the style of an account we watch ("SwishDM carousel style sample: WATCH-ACCOUNTS '…'"):
  // the recorded label is a planner key, so the title says it in words too.
  if (/style sample/.test(l)) return { key: 'industry', label: 'Style sample', title: 'Written in the style of an account we watch' }
  // A client's own words on record (written feedback, a call note): the client's name is the source.
  if (owner && l.includes(owner.toLowerCase())) return tag('client', `From ${owner}`)
  if (kind === 'case_study' || kind === 'ballot_b2_regen' || /portfolio/.test(l)) return tag('portfolio', 'Portfolio')
  if (kind === 'idea') return tag('idea', 'Idea')
  if (kind === 'editorial' || kind === 'infographic' || /editorial|reference/.test(l)) return tag('editorial', 'Editorial')
  if (src === 'manual') return tag('manual', 'Manual')
  return tag('other', label ? (label.length > 22 ? `${label.slice(0, 20).trimEnd()}…` : label) : 'No source')
}
