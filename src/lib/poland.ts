import { supabase } from './supabase'

// IS THIS A POLAND POST? (db/299p, review 2026-11-06 #31). A reasoned read, never a keyword match: the content-brain
// check's own vote when the draft has one, else one proxy read of the current body (edge function
// content-poland-read). `poland` is null while nothing has read the draft yet. Ivan's seat only.
export type PolandRead = { poland: boolean | null; source: 'brain_check' | 'read' | null; why: string | null }

export async function fetchPoland(ids: readonly string[], signal?: AbortSignal): Promise<Map<string, PolandRead>> {
  const out = new Map<string, PolandRead>()
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return out
  // One call per 200 ids keeps the request small (the RPC answers at most 500 rows).
  for (let i = 0; i < uniq.length; i += 200) {
    const q = supabase.rpc('content_poland_of', { p_ids: uniq.slice(i, i + 200) })
    const { data, error } = await (signal ? q.abortSignal(signal) : q)
    if (error) throw new Error(error.message || 'The Poland read could not load.')
    for (const r of (data ?? []) as { draft_id: string; poland: boolean | null; source: string | null; why: string | null }[]) {
      out.set(r.draft_id, {
        poland: typeof r.poland === 'boolean' ? r.poland : null,
        source: r.source === 'brain_check' || r.source === 'read' ? r.source : null,
        why: r.why ?? null,
      })
    }
  }
  return out
}
