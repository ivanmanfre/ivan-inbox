import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchDraftContextGaps, fetchDraftEmailStamps, fetchDraftEvidence, fetchManualReplyIds, fetchMessages, groupThreads, type DraftContextGap, type DraftEmailStamp, type Thread } from '../lib/inbox'
import { playChime } from '../lib/chime'
import { readInboxCache, writeInboxCache } from '../lib/inboxCache'

// A burst of dispatcher writes (one row every ~2 min per active lane, plus
// phantom-duplicate bursts) used to trigger one full 20k-row re-page EACH.
// Realtime and focus refreshes are absorbed into a single trailing run: the
// first event schedules a refresh, every event inside the window rides on it.
// A caller-initiated refresh() (pull-to-refresh, a retry tap) is never delayed.
const COALESCE_MS = 1500

export function useInbox() {
  // N3-1: the last reconciled list, read SYNCHRONOUSLY so the first render pass
  // already has rows. Anything async here (IndexedDB, supabase.auth.getSession)
  // paints a frame late, which is the skeleton flash this exists to remove.
  const seed = useMemo(() => readInboxCache(), [])
  const [threads, setThreads] = useState<Thread[]>(seed?.cache.threads ?? [])
  // True while the ONLY thing on screen came off the device. It is not a
  // freshness claim and must never be read as one: `loadedAt` stays null until a
  // live fetch resolves, which is what dmsEmptyKind reads.
  const [fromCache, setFromCache] = useState(seed != null)
  const [cachedAt] = useState<string | null>(seed?.savedAt ?? null)
  // A seeded paint is not loading: there are real rows on screen. Only a cold
  // open (no cache) is still the skeleton the repair's W2-5 rule requires.
  const [loading, setLoading] = useState(seed == null)
  // A failed fetch and an empty inbox must never render the same (U2). Callers
  // that ignore `error` behave exactly as before.
  const [error, setError] = useState<string | null>(null)
  // When the last SUCCESSFUL load landed. An empty list with a fresh stamp is
  // "genuinely empty"; an empty list with no stamp at all is "never loaded".
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  // Newest inbound timestamp we've already seen — a refresh that surfaces an
  // inbound row newer than this plays the chime. Null until first load so the
  // initial fetch never dings.
  const newestInbound = useRef<string | null>(null)
  // Every mount gets its own topic. supabase.channel() hands back the EXISTING
  // channel for a topic it already holds, so a second useInbox() on screen
  // would bind postgres_changes to an already-subscribed channel — which throws
  // inside the effect and takes the whole tree down to a black screen. This
  // hook was the one exception to the rule every other hook follows
  // (useOps.ts:8-15, useContent.ts:28-35, useAgent.ts:21-26); it no longer is.
  const topic = `inbox:${useId()}`
  const refresh = useCallback(() => {
    // The needs_manual_reply probe rides alongside the message fetch, never in
    // front of it: a failed flag read degrades the badge (those threads drop to
    // "waiting"), it must not take the whole inbox down with it.
    Promise.all([
      fetchMessages(),
      fetchManualReplyIds().catch(() => new Set<string>()),
      // Same degrade rule as the flag probe: a failed stamp read only loses the
      // "also emails" badge, it must never take the inbox down.
      fetchDraftEmailStamps().catch(() => new Map<string, DraftEmailStamp>()),
    ]).then(async ([rows, manualReplyIds, emailStamps]) => {
      const draftIds = groupThreads(rows, manualReplyIds).flatMap(t =>
        [t.draft, t.companionDraft, t.ownerConfirmation].flatMap(m => m ? [m.id] : []))
      const [evidence, contextGaps] = await Promise.all([
        fetchDraftEvidence(draftIds).catch(() => null),
        fetchDraftContextGaps(draftIds).catch(() => new Map<string, DraftContextGap>()),
      ])
      const pendingIds = new Set(draftIds)
      for (const m of rows) {
        const em = emailStamps.get(m.id)
        if (em) { m.recipient_email = em.recipient_email; m.email_mirror_text = em.email_mirror_text }
        const cg = contextGaps.get(m.id)
        if (cg) m.context_gap = cg
        m.draft_evidence_unavailable = evidence === null && pendingIds.has(m.id)
        const ev = evidence?.get(m.id)
        if (ev) m.draft_evidence = ev
      }
      const latest = rows
        .filter(m => m.direction === 'inbound')
        .map(m => m.created_at).sort().at(-1) ?? null
      if (latest && newestInbound.current && latest > newestInbound.current) playChime()
      if (latest) newestInbound.current = latest
      setThreads(groupThreads(rows, manualReplyIds))
      setFromCache(false)
      setError(null)
      setLoadedAt(new Date().toISOString())
      setLoading(false)
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'inbox unavailable')
      setLoading(false)
    })
  }, [])
  // THE CACHE IS WRITTEN FROM WHAT THE SCREEN IS RENDERING, never from the raw
  // response. `threads` is the reconciled array: anything the app removed or
  // changed locally after the fetch is already in it, so the next open cannot
  // resurrect a row this session took away. Gated on `loadedAt`, which is only
  // stamped by a fetch that RESOLVED, so a 4xx/5xx session writes nothing at all
  // and a cache-seeded paint never rewrites itself.
  useEffect(() => {
    if (loadedAt === null) return
    writeInboxCache(threads)
  }, [threads, loadedAt])

  const pending = useRef<number | null>(null)
  useEffect(() => {
    refresh()
    // Trailing-edge coalesce: while a refresh is already scheduled, further
    // events are dropped rather than queued.
    const nudge = () => {
      if (pending.current !== null) return
      pending.current = window.setTimeout(() => { pending.current = null; refresh() }, COALESCE_MS)
    }
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outreach_messages' }, nudge)
      .subscribe()
    window.addEventListener('focus', nudge)
    return () => {
      if (pending.current !== null) { clearTimeout(pending.current); pending.current = null }
      supabase.removeChannel(ch)
      window.removeEventListener('focus', nudge)
    }
  }, [refresh, topic])
  return { threads, loading, error, loadedAt, fromCache, cachedAt, refresh }
}
