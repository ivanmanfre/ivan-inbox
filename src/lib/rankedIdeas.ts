import { supabase } from './supabase'
import { parsePatternRead } from './earlyReads'
import { CLIENT_OPS_GATE, type IdeaCandidate } from './content'
import type { ClientIdea } from './clientIdeas'
import { splitText, type OutlierRow } from './outliers'
import { fromCandidate, fromClient, type IdeaItem } from '../d/content/ideaModel'
import { age, type Lane } from '../d/content/model'

export function parseRankedIdeas(data: unknown, lane: Lane): IdeaItem[] {
  const d = data as { ok?: boolean; client?: string; rows?: unknown[] } | null
  if (!d || d.ok !== true || d.client !== lane || !Array.isArray(d.rows)) throw new Error('Ideas returned no usable list.')
  return d.rows.map(raw => {
    const r = raw as { kind: string; id: string; bank?: IdeaCandidate | ClientIdea; outlier?: OutlierRow; proof?: string; rank?: number; pattern_read?: unknown }
    if (!r.id || !Number.isFinite(Number(r.rank))) throw new Error('An idea returned no ranking.')
    let item: IdeaItem
    if (r.kind === 'bank' && r.bank?.id) item = lane === 'ivan'
      ? fromCandidate(r.bank as IdeaCandidate, undefined, !(r.bank as IdeaCandidate).content_type)
      : fromClient(r.bank as ClientIdea, lane)
    else if (r.kind === 'outlier' && r.outlier?.post_id) {
      const [title, body] = splitText(r.outlier.text)
      item = { id: r.id, lane, title: title || `Post from ${r.outlier.author}`, src: r.outlier.platform === 'x' ? 'X' : 'LinkedIn',
        age: age(r.outlier.published_at), score: null, parts: [], why: body, angle: null, format: null, outlier: r.outlier }
    } else throw new Error('An idea returned no source row.')
    return { ...item, proof: typeof r.proof === 'string' && r.proof.trim() ? r.proof : item.src, rank: Number(r.rank), patternRead: parsePatternRead(r.pattern_read, lane) }
  })
}

export async function fetchRankedIdeas(lane: Lane, signal?: AbortSignal): Promise<IdeaItem[]> {
  const query = supabase.rpc('operator_ranked_ideas', { p_gate: CLIENT_OPS_GATE, p_client: lane })
  const { data, error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw new Error(error.message || 'Ideas could not load.')
  return parseRankedIdeas(data, lane)
}

/** Confirmed picks lead the list even if generation changes their source status. */
export function visibleIdeas(items: IdeaItem[], saved: IdeaItem[], skipped: string[]): IdeaItem[] {
  const picks = new Set(saved.map(i => i.id))
  const refs = new Set(saved.flatMap(i => i.outlier ? [`${i.outlier.platform}:${i.outlier.post_id}`] : []))
  const confirmed = saved.map(p => { const fresh = items.find(i => i.id === p.id); return fresh ? { ...fresh, saved: true, generating: p.generating } : p })
  return [...confirmed, ...items.filter(i => !picks.has(i.id) && !refs.has(i.id) && !skipped.includes(i.id))]
}
