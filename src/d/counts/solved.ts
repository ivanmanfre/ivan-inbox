// "Mark as solved" state (outreach_prospects.solved_at, db/20260927) merged into D's threads.
// inbox_messages_v does not carry it (the view is not recreated), so it is ONE small read: only
// the prospects whose thread owes a reply by today's rule, chunked, only rows that carry a stamp.
// Tenant-safe by construction: the ids come from threads already scoped to their seat.
// The settle/return rule itself lives in lib/inbox (isSettledBySolve, inside unansweredSince), so
// the list, the frame's per-seat counts, Home's work queue and ⌘K all read the same answer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { unansweredWaitSince, type Thread } from '../../lib/inbox'
import { supabase } from '../../lib/supabase'

const CHUNK = 60

/** Prospects whose thread owes a reply by the message rule alone (before any solve is applied). */
export function owedIds(threads: readonly Thread[]): string[] {
  return threads.filter(t => unansweredWaitSince({ ...t, solvedAt: null }) !== null).map(t => t.prospect_id)
}

export async function fetchSolvedAt(ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const uniq = [...new Set(ids)]
  const chunks: string[][] = []
  for (let i = 0; i < uniq.length; i += CHUNK) chunks.push(uniq.slice(i, i + CHUNK))
  await Promise.all(chunks.map(async chunk => {
    const { data, error } = await supabase.from('outreach_prospects')
      .select('id,solved_at').not('solved_at', 'is', null).in('id', chunk)
    if (error) throw error
    for (const r of (data ?? []) as { id: string; solved_at: string | null }[]) if (r.solved_at) out.set(r.id, r.solved_at)
  }))
  return out
}

/** Threads with solvedAt set from the map (a new object only where it changes). */
export function withSolved(threads: Thread[], solved: ReadonlyMap<string, string | null>): Thread[] {
  if (!solved.size) return threads
  return threads.map(t => {
    if (!solved.has(t.prospect_id)) return t
    const at = solved.get(t.prospect_id) ?? null
    return (t.solvedAt ?? null) === at ? t : { ...t, solvedAt: at }
  })
}

export type SolvedApi = {
  /** Show a solve (or its undo: null) at once, before the next read lands. */
  setLocal: (pid: string, at: string | null) => void
  failed: boolean
}

/** Reads solved_at for the owed threads whenever the list changes; merges it plus local marks. */
export function useSolvedMerge(threads: Thread[], on = true): { threads: Thread[]; solved: SolvedApi } {
  const [read, setRead] = useState<Map<string, string>>(new Map())
  const [local, setLocalMap] = useState<Map<string, string | null>>(new Map())
  const [failed, setFailed] = useState(false)
  const ids = useMemo(() => (on ? owedIds(threads).sort().join(',') : ''), [threads, on])
  const seq = useRef(0)
  useEffect(() => {
    if (!ids) { setRead(new Map()); return }
    const n = ++seq.current
    fetchSolvedAt(ids.split(','))
      .then(m => { if (n === seq.current) { setRead(m); setFailed(false); setLocalMap(new Map()) } })
      .catch(() => { if (n === seq.current) setFailed(true) })
  }, [ids])
  const setLocal = useCallback((pid: string, at: string | null) => setLocalMap(m => new Map(m).set(pid, at)), [])
  const merged = useMemo(() => {
    if (!local.size) return withSolved(threads, read)
    const all = new Map<string, string | null>(read)
    for (const [k, v] of local) all.set(k, v)
    return withSolved(threads, all)
  }, [threads, read, local])
  const solved = useMemo(() => ({ setLocal, failed }), [setLocal, failed])
  return { threads: merged, solved }
}
