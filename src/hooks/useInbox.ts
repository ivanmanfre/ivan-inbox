import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { type InboxMessage, type Thread, SPAM_REASON } from '../lib/inbox'
import { assembleInbox, loadInbox } from '../lib/inboxLoad'
import { FULL_EVERY_MS, changedSince, fetchConversations, mergeConversations, prospectOfEvent, withOverlap } from '../lib/inboxDelta'
import { playChime } from '../lib/chime'
import { readInboxCache, writeInboxCache } from '../lib/inboxCache'
import { isEditing } from '../lib/updateReload'

// A burst of dispatcher writes (one row every ~2 min per active lane, plus
// phantom-duplicate bursts) used to trigger one full 20k-row re-page EACH.
// Realtime and focus refreshes are absorbed into a single trailing run: the
// first event schedules a refresh, every event inside the window rides on it.
// A caller-initiated refresh() (pull-to-refresh, a retry tap) is never delayed.
// 2026-09-28 (CB-24): background runs are INCREMENTAL now (lib/inboxDelta.ts):
// a realtime event re-reads only its conversation, a focus, a re-subscribe or
// the 10-minute sweep asks inbox_changed_since which conversations moved. The
// whole view is read on mount, on refresh(), and once it is FULL_EVERY_MS old
// while visible. Background conversation re-reads keep MIN_GAP_MS apart (one
// run carries everything owed meanwhile), except a new inbound message, which
// runs at the coalesce so the reply chime stays prompt.
const COALESCE_MS = 1500
const TYPING_HOLD_MS = 30_000
const SWEEP_EVERY_MS = 10 * 60_000
const MIN_GAP_MS = 120_000

/**
 * `enabled` false: a second caller under a provider that already runs this read
 * (D's frame shares ONE inbox with its DMs page) mounts no read, no channel and
 * no focus listener. Default true: every existing caller is unchanged.
 * `seedCache`: paint the saved copy even while the live read waits (D's frame
 * starts its read a few seconds late off the DMs page, so the page's own reads go first).
 */
export function useInbox(enabled = true, seedCache = enabled) {
  // N3-1: the last reconciled list, read SYNCHRONOUSLY so the first render pass
  // already has rows. Anything async here (IndexedDB, supabase.auth.getSession)
  // paints a frame late, which is the skeleton flash this exists to remove.
  // A disabled caller never pays for parsing the saved copy.
  const seed = useMemo(() => (seedCache ? readInboxCache() : null), []) // eslint-disable-line react-hooks/exhaustive-deps
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
  // N3b-2: how many conversations we already know exist, from the saved copy or
  // from the last good read. A fetch that comes back with zero against this is a
  // failed refresh, never a truth. Kept in a ref rather than read off `threads`
  // so `refresh` stays a stable callback (the realtime subscription is bound to
  // it and re-subscribing on every list change is a channel churn bug).
  const knownRows = useRef<number>(seed?.cache.threads.length ?? 0)
  // The view's rows as last read (never annotated; lib/inboxLoad assembles
  // copies), the server-clock watermark they are good from, and when the whole
  // view was last read. Refs, so `refresh` stays a stable callback.
  const viewRows = useRef<InboxMessage[] | null>(null)
  const watermark = useRef<string | null>(null)
  const lastFull = useRef(0)
  const busy = useRef(false)
  // When the last background conversation re-read started (the MIN_GAP_MS clock), and the
  // effect's scheduler, so a run that ends with work still owed hands it back to the schedule.
  const lastIncremental = useRef(0)
  const nudgeRef = useRef<((urgent?: boolean) => void) | null>(null)
  // What the next run owes: a whole read, these conversations, or a changed-since sweep.
  // `urgent`: a new inbound message is owed, which runs at the coalesce even inside the gap (the chime).
  const owed = useRef<{ full: boolean; pids: Set<string>; sweep: boolean; urgent: boolean }>({ full: false, pids: new Set(), sweep: false, urgent: false })
  const land = useCallback((rows: InboxMessage[], grouped: Thread[]) => {
    // 2026-09-10 (Ivan: strangers filed under Likely spam get "no notifications or sound"):
    // a filed thread never moves the chime watermark. Registration inserts old messages with
    // a fresh created_at, so without this every triage batch would ring the open app.
    const latest = rows
      .filter(m => m.direction === 'inbound' && (m.prospect_skip_reason ?? null) !== SPAM_REASON)
      .map(m => m.created_at).sort().at(-1) ?? null
    // THE SAME RULE fetchMessages applies to its first page, applied once more
    // to the grouped list: an empty result over an inbox we KNOW had rows is a
    // failed refresh. It must not wipe the rows, must not write the cache, and
    // must not stamp `loadedAt`, because `loadedAt` is what licenses the
    // screen to say "this is a live read, not a stall". A genuinely empty
    // inbox on a cold open (knownRows 0) falls through and keeps that copy.
    if (grouped.length === 0 && knownRows.current > 0) {
      setError('The inbox read came back empty')
      setLoading(false)
      return false
    }
    if (latest && newestInbound.current && latest > newestInbound.current) playChime()
    if (latest) newestInbound.current = latest
    knownRows.current = grouped.length
    setThreads(grouped)
    setFromCache(false)
    setError(null)
    setLoadedAt(new Date().toISOString())
    setLoading(false)
    return true
  }, [])
  // One run at a time. A whole read owed meanwhile (an explicit refresh after a button write) runs
  // straight after; background work owed meanwhile goes back through the schedule, so it still
  // waits for the coalesce, the gap and the typing hold.
  const pump = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    let ranIncremental = false
    try {
      for (;;) {
        const due = owed.current
        if (due.full || viewRows.current === null) {
          // A whole read settles everything owed before it started.
          owed.current = { full: false, pids: new Set(), sweep: false, urgent: false }
          const mark = await changedSince(null).then(c => c.now, () => null)
          const res = await loadInbox(knownRows.current)
          // An empty read over a known-non-empty inbox is a failure (land says so): stop, never loop on it.
          if (!land(res.rows, res.threads)) break
          viewRows.current = res.viewRows; watermark.current = mark; lastFull.current = Date.now()
          ranIncremental = true
          continue
        }
        if (ranIncremental || (due.pids.size === 0 && !due.sweep)) break
        ranIncremental = true
        lastIncremental.current = Date.now()
        owed.current = { full: false, pids: new Set(), sweep: false, urgent: false }
        const pids = new Set(due.pids)
        let nextMark: string | null = null
        if (due.sweep) {
          if (watermark.current === null) { owed.current.full = true; continue }
          const c = await changedSince(withOverlap(watermark.current)).catch(() => null)
          // The sweep could not ask, or the watermark is too old to answer from: fall back to
          // the whole read, the pre-2026-09-28 behaviour. Anything owed rides along with it.
          if (c === null || c.ids === null) { owed.current.full = true; continue }
          for (const id of c.ids) pids.add(id)
          nextMark = c.now
        }
        if (pids.size > 0) {
          const held = viewRows.current
          const fresh = await fetchConversations([...pids])
          // N3b: an empty re-read of conversations we hold rows for is a failed read (a lost
          // session reads as zero rows), never a truth: owe the whole read, which has its own guard.
          if (fresh.length === 0 && held.some(m => pids.has(m.prospect_id))) { owed.current.full = true; continue }
          const merged = mergeConversations(held, pids, fresh)
          const res = await assembleInbox(merged)
          if (!land(res.rows, res.threads)) break
          viewRows.current = merged
        }
        if (nextMark) watermark.current = nextMark
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'inbox unavailable')
      setLoading(false)
    } finally {
      busy.current = false
      const o = owed.current
      if (o.full || o.urgent) nudgeRef.current?.(true)
      else if (o.pids.size > 0 || o.sweep) nudgeRef.current?.()
    }
  }, [land])
  const refresh = useCallback(() => {
    owed.current.full = true
    void pump()
  }, [pump])
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
  const pendingUrgent = useRef(false)
  useEffect(() => {
    if (!enabled) return
    refresh()
    // Trailing-edge coalesce: while a run is already scheduled, further events
    // only add to what it owes. `urgent` (a whole read owed, a new inbound message)
    // waits only for the coalesce; everything else also waits out MIN_GAP_MS since
    // the last background re-read.
    // 2026-09-28 (Ivan: "When I'm writing something it refreshes"): while a field is focused the
    // background re-read waits, up to TYPING_HOLD_MS, so a save of the draft being typed does not
    // re-read the inbox under the cursor.
    const nudge = (urgent = false) => {
      if (pending.current !== null) {
        if (!urgent || pendingUrgent.current) return
        clearTimeout(pending.current); pending.current = null
      }
      const since = Date.now()
      const wait = urgent ? COALESCE_MS : Math.max(COALESCE_MS, lastIncremental.current + MIN_GAP_MS - Date.now())
      pendingUrgent.current = urgent
      const run = () => {
        if (isEditing(document) && Date.now() - since < TYPING_HOLD_MS) { pending.current = window.setTimeout(run, COALESCE_MS); return }
        pending.current = null
        pendingUrgent.current = false
        void pump()
      }
      pending.current = window.setTimeout(run, wait)
    }
    nudgeRef.current = nudge
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
    // Realtime keeps flowing while the tab is hidden (the reply chime rings from a background tab);
    // each run costs one read of the conversations that moved, never the whole view.
    const onEvent = (p: { eventType?: string; new?: Record<string, unknown> | null; old?: Record<string, unknown> | null }) => {
      const byId = new Map<string, string>()
      if (p.eventType === 'DELETE') for (const m of viewRows.current ?? []) byId.set(m.id, m.prospect_id)
      const pid = prospectOfEvent(p, byId)
      if (pid) owed.current.pids.add(pid); else owed.current.sweep = true
      const inbound = p.eventType === 'INSERT' && p.new?.direction === 'inbound'
      if (inbound) owed.current.urgent = true
      nudge(inbound)
    }
    // Coming back to the app: the whole view if it is older than FULL_EVERY_MS, else only what moved.
    const onReturn = () => {
      if (!visible()) return
      if (Date.now() - lastFull.current >= FULL_EVERY_MS) { owed.current.full = true; nudge(true) }
      else { owed.current.sweep = true; nudge() }
    }
    let subscribed = false
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outreach_messages' }, onEvent)
      .subscribe(status => {
        // A re-subscribe after a drop missed whatever happened in between.
        if (status === 'SUBSCRIBED') { if (subscribed) { owed.current.sweep = true; nudge() } subscribed = true }
      })
    // Hidden: no sweeps and no whole reads (back-off); visible: a sweep every SWEEP_EVERY_MS,
    // and the whole view once it is FULL_EVERY_MS old.
    const tick = window.setInterval(() => {
      if (!visible()) return
      if (Date.now() - lastFull.current >= FULL_EVERY_MS) { owed.current.full = true; nudge(true) }
      else { owed.current.sweep = true; nudge() }
    }, SWEEP_EVERY_MS)
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      if (pending.current !== null) { clearTimeout(pending.current); pending.current = null }
      nudgeRef.current = null
      window.clearInterval(tick)
      supabase.removeChannel(ch)
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [refresh, pump, topic, enabled])
  return { threads, loading, error, loadedAt, fromCache, cachedAt, refresh }
}
