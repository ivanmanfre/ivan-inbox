import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { type InboxMessage, type Thread, SPAM_REASON } from '../lib/inbox'
import { assembleInbox, loadInbox, loadPriority } from '../lib/inboxLoad'
import { FULL_EVERY_MS, changedSince, fetchConversations, mergeConversations, prospectOfEvent, withOverlap } from '../lib/inboxDelta'
import { playChime } from '../lib/chime'
import { readInboxCache, writeInboxCache } from '../lib/inboxCache'
import { SNAPSHOT_READ_MS, SNAPSHOT_SAVE_EVERY_MS, readInboxSnapshot, snapshotDelta, writeInboxSnapshot } from '../lib/inboxSnapshot'
import { currentUserId } from '../lib/swr'
import { withTimeout } from '../d/ui/timeout'
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
/** After a warm start over an overdue snapshot, the whole read waits this long (the app may close first). */
const OVERDUE_FULL_AFTER_MS = 120_000
/** The first-rows read holds every prospect with an inbound row this recent (db: inbox_phone_first_rows_r2). */
const PRIORITY_INBOUND_MS = 15 * 86_400_000

/**
 * 'all': the whole message view (the DMs list). 'priority' (2026-11-17 speed pass): only the
 * complete conversations of every Needs-you and Coming-up candidate (lib/inboxLoad loadPriority),
 * which is all the frame needs off the DMs page (the per-seat counts, the Glance line, the reply
 * chime). A whole read in 'priority' is that read; it never writes the saved copy or the snapshot
 * (both stay the whole list), and it never starts from the snapshot. Once 'all' is asked for it
 * stays 'all' for the life of the hook: the whole read follows (snapshot first), and until it lands
 * the hook reports the Needs-you rows the way it reports its own early paint (priorityAt set,
 * loadedAt null, loading true), so the DMs page never shows a part list as the whole one.
 */
export type InboxScope = 'all' | 'priority'

/**
 * `enabled` false: a second caller under a provider that already runs this read
 * (D's frame shares ONE inbox with its DMs page) mounts no read, no channel and
 * no focus listener. Default true: every existing caller is unchanged.
 * `seedCache`: paint the saved copy even while the live read waits (D's frame
 * starts its read a few seconds late off the DMs page, so the page's own reads go first).
 * `scope`: see InboxScope. Default 'all': every existing caller is unchanged.
 */
export function useInbox(enabled = true, seedCache = enabled, scope: InboxScope = 'all') {
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
  // Complete priority conversations are live, while the older archive still follows.
  const [priorityAt, setPriorityAt] = useState<string | null>(null)
  // When the read that last landed STARTED (ms). A local write is in that read only if the write came first,
  // so callers drop an optimistic patch against this, never against the time the read landed.
  const readStarted = useRef(0)
  const [readStartedAt, setReadStartedAt] = useState(0)
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
  // 2026-11-15 speed review (lib/inboxSnapshot): the MOUNT may start from the device's last whole read
  // plus the conversations that moved since, instead of reading the whole view again. Only the mount:
  // an explicit refresh() (pull, Retry, after a write) always reads the whole view.
  const mayWarmStart = useRef(false)
  const snapshotSavedAt = useRef(0)
  const snapshotTimer = useRef<number | null>(null)
  // When the last whole read behind viewRows landed (the snapshot's, after a warm start).
  const fullAt = useRef(0)
  // Who the rows in viewRows belong to (captured when a read STARTS), and whether this hook is still
  // mounted: a read that finishes after a sign-out or an unmount never writes a snapshot (review r1).
  const rowsOwner = useRef<string | null>(null)
  const overdueTimer = useRef<number | null>(null)
  const alive = useRef(true)
  // PERF-COLD: which whole read may still paint its newest page, and whether the screen holds one.
  const fullRun = useRef(0)
  const provisional = useRef(false)
  // The list on screen before a warm Needs-you paint, put back if the whole read fails.
  const savedBeforePaint = useRef<Thread[] | null>(null)
  // When the last background conversation re-read started (the MIN_GAP_MS clock), and the
  // effect's scheduler, so a run that ends with work still owed hands it back to the schedule.
  const lastIncremental = useRef(0)
  const nudgeRef = useRef<((urgent?: boolean) => void) | null>(null)
  // What the next run owes: a whole read, these conversations, or a changed-since sweep.
  // `urgent`: an inbound message or a return/reconnect check is owed, which runs at the coalesce even inside the gap.
  const owed = useRef<{ full: boolean; pids: Set<string>; sweep: boolean; urgent: boolean }>({ full: false, pids: new Set(), sweep: false, urgent: false })
  // 2026-11-17 speed pass (InboxScope): whether the whole view is wanted (sticky), and what the rows
  // behind viewRows are: nothing yet, the Needs-you read only, or the whole view.
  const [all, setAll] = useState(scope === 'all')
  if (scope === 'all' && !all) setAll(true)
  const wantAll = useRef(all)
  const base = useRef<'none' | 'priority' | 'full'>('none')
  const [baseKind, setBaseKind] = useState<'none' | 'priority' | 'full'>('none')
  const land = useCallback((rows: InboxMessage[], grouped: Thread[], kind: 'priority' | 'full' = base.current === 'priority' ? 'priority' : 'full') => {
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
    // The whole read landing over a Needs-you read: an inbound newer than the last one heard is new
    // only inside the window that read holds (every prospect with an inbound in 15 days); an older
    // one was outside it, never a new message.
    const widened = kind === 'full' && base.current === 'priority'
    if (latest && newestInbound.current && latest > newestInbound.current
      && (!widened || Date.parse(latest) >= Date.now() - PRIORITY_INBOUND_MS)) playChime()
    if (latest) newestInbound.current = latest
    base.current = kind
    setBaseKind(kind)
    provisional.current = false
    savedBeforePaint.current = null
    knownRows.current = grouped.length
    setThreads(grouped)
    setFromCache(false)
    setError(null)
    setReadStartedAt(readStarted.current)
    setLoadedAt(new Date().toISOString())
    setLoading(false)
    return true
  }, [])
  // Store the rows as read (never the annotated copies) with their watermark, off the paint path.
  // `minGapMs` 0 = after a whole read; otherwise at most once per SNAPSHOT_SAVE_EVERY_MS.
  const saveSnapshot = useCallback((minGapMs: number) => {
    if (snapshotTimer.current !== null) return
    snapshotTimer.current = window.setTimeout(() => {
      snapshotTimer.current = null
      const user = rowsOwner.current, rows = viewRows.current, mark = watermark.current
      if (!alive.current || !user || user !== currentUserId() || !rows || rows.length === 0 || !mark || !fullAt.current || base.current !== 'full') return
      if (minGapMs > 0 && Date.now() - snapshotSavedAt.current < minGapMs) return
      snapshotSavedAt.current = Date.now()
      void writeInboxSnapshot({ user, rows, watermark: mark, fullAt: fullAt.current })
    }, 3000)
  }, [])
  // The mount's warm start: the snapshot, the conversations that moved since its watermark read
  // whole (the same delta the 10-minute sweep runs), then a normal land. Every doubt (no snapshot,
  // a slow IndexedDB, too old for the server, an empty re-read of held conversations, a failed
  // read) answers false and the caller does the whole read instead. Nothing lands until the delta
  // is in, so `loadedAt` still means a read that resolved.
  const warmStart = useCallback(async (): Promise<boolean> => {
    try {
      const started = Date.now()
      const owner = currentUserId()
      const snap = await withTimeout(readInboxSnapshot(owner, started), SNAPSHOT_READ_MS).catch(() => null)
      if (!snap || !alive.current || currentUserId() !== owner) return false
      readStarted.current = Date.now()
      const d = await snapshotDelta(snap)
      if (!d) return false
      const rows = d.rows
      const res = await assembleInbox(rows)
      if (!alive.current || currentUserId() !== owner) return false
      if (!land(res.rows, res.threads, 'full')) return false
      viewRows.current = rows; watermark.current = d.watermark; rowsOwner.current = owner
      lastFull.current = fullAt.current = snap.fullAt
      lastIncremental.current = Date.now()
      // The stored copy is what we just started from: the next write waits out the usual gap (review r1).
      snapshotSavedAt.current = Date.now()
      // The snapshot's whole read is overdue (FULL_EVERY_MS): the whole read follows in the background
      // OVERDUE_FULL_AFTER_MS after the screen is live, if the app is still open. Short opens skip it;
      // usableSnapshot's hard cap (5 h since the last whole read) bounds how stale that can get (review r1).
      if (Date.now() - snap.fullAt >= FULL_EVERY_MS && overdueTimer.current === null) {
        overdueTimer.current = window.setTimeout(() => {
          overdueTimer.current = null
          if (!alive.current) return
          owed.current.full = true
          nudgeRef.current?.()
        }, OVERDUE_FULL_AFTER_MS)
      }
      return true
    } catch {
      return false
    }
  }, [land])
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
          const whole = wantAll.current
          // The snapshot is the whole view: only a read that wants it starts from it (the mount's,
          // or the first one after 'priority' turned into 'all').
          if (whole && base.current !== 'full' && mayWarmStart.current) {
            mayWarmStart.current = false
            if (await warmStart()) { ranIncremental = true; continue }
            // No usable snapshot, or the delta could not be trusted: the whole read, as before.
            owed.current.full = true
            continue
          }
          // PERF-COLD (2026-10-08): the clock is asked WITH the read, not before it (it cost a
          // serial round trip on every cold open). The watermark can now trail the first page's
          // snapshot by a few hundred ms; every sweep re-reads from withOverlap(watermark), two
          // minutes earlier, so nothing committed in that gap is missed.
          readStarted.current = Date.now()
          // A whole read settles an overdue warm start's pending one (review r2).
          if (overdueTimer.current !== null) { clearTimeout(overdueTimer.current); overdueTimer.current = null }
          const readOwner = currentUserId()
          const markRead = changedSince(null).then(c => c.now, () => null)
          if (!whole) {
            // 'priority': the Needs-you read, shared with the frame's DM counts (lib/firstRows: a read
            // they started up to 10 s ago, well inside the sweeps' 2-minute overlap). Null = the RPC is
            // absent: the whole read below, as before.
            const res = await loadPriority()
            if (res) {
              const mark = await markRead
              if (!land(res.rows, res.threads, 'priority')) break
              viewRows.current = res.viewRows; watermark.current = mark; lastFull.current = Date.now()
              rowsOwner.current = readOwner
              ranIncremental = true
              continue
            }
          }
          // A cold screen (nothing on it: no saved copy, no good read yet) paints the newest page
          // while the rest is read. That paint is PROVISIONAL: it never touches knownRows, the
          // cache, the chime or loadedAt (the screen still says Reading…, loading stays true, so a
          // ?thread= link that is not in it yet waits instead of saying "not in the list"), and a
          // failed read takes it back off the screen (below), the pre-2026-10-08 cold failure.
          const run = ++fullRun.current
          // 2026-11-15 (Ivan: "is not updating"): a screen WITH a saved copy used to skip the early
          // read and wait for the whole archive (25 pages, up to 17 s each on the phone), so it sat on
          // "Saved copy · reading…" and every reopen restarted the wait. It now takes the COMPLETE
          // Needs-you conversations (the priority read) over the saved copy, matched by person; the
          // partial newest page never paints over it. Same provisional rules; a failure puts the
          // saved copy back.
          const warm = knownRows.current > 0
          // Over a landed Needs-you read ('priority' turned 'all') that paint is already on screen: no second one.
          const res = await loadInbox(knownRows.current, base.current === 'priority' ? undefined : (early, priority) => {
            if (fullRun.current !== run || early.length === 0) return
            if (!warm) {
              if (knownRows.current !== 0) return
              provisional.current = true
              setThreads(early)
              if (priority) setPriorityAt(new Date().toISOString())
              return
            }
            if (!priority) return
            const fresh = new Map(early.map(t => [t.prospect_id, t]))
            provisional.current = true
            setThreads(prev => {
              if (savedBeforePaint.current === null) savedBeforePaint.current = prev
              const kept = prev.map(t => fresh.get(t.prospect_id) ?? t)
              const held = new Set(prev.map(t => t.prospect_id))
              return [...kept, ...early.filter(t => !held.has(t.prospect_id))]
            })
            setPriorityAt(new Date().toISOString())
          })
          const mark = await markRead
          // An empty read over a known-non-empty inbox is a failure (land says so): stop, never loop on it.
          if (!land(res.rows, res.threads, 'full')) break
          viewRows.current = res.viewRows; watermark.current = mark; lastFull.current = fullAt.current = Date.now()
          rowsOwner.current = readOwner
          saveSnapshot(0)
          ranIncremental = true
          continue
        }
        if (ranIncremental || (due.pids.size === 0 && !due.sweep)) break
        ranIncremental = true
        lastIncremental.current = readStarted.current = Date.now()
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
        if (nextMark) { watermark.current = nextMark; saveSnapshot(SNAPSHOT_SAVE_EVERY_MS) }
      }
    } catch (e: unknown) {
      // A newest-page paint is not a read that landed: never leave it on screen as the last good list.
      if (provisional.current) { provisional.current = false; setThreads(savedBeforePaint.current ?? []); setPriorityAt(null) }
      savedBeforePaint.current = null
      setError(e instanceof Error ? e.message : 'inbox unavailable')
      setLoading(false)
    } finally {
      busy.current = false
      const o = owed.current
      if (o.full || o.urgent) nudgeRef.current?.(true)
      else if (o.pids.size > 0 || o.sweep) nudgeRef.current?.()
    }
  }, [land, warmStart, saveSnapshot])
  const refresh = useCallback(() => {
    mayWarmStart.current = false
    owed.current.full = true
    void pump()
  }, [pump])
  // THE CACHE IS WRITTEN FROM WHAT THE SCREEN IS RENDERING, never from the raw
  // response. `threads` is the reconciled array: anything the app removed or
  // changed locally after the fetch is already in it, so the next open cannot
  // resurrect a row this session took away. Gated on `loadedAt`, which is only
  // stamped by a fetch that RESOLVED, so a 4xx/5xx session writes nothing at all
  // and a cache-seeded paint never rewrites itself.
  // The saved copy is the whole list: a Needs-you read ('priority') never writes it.
  useEffect(() => {
    if (loadedAt === null || baseKind !== 'full') return
    writeInboxCache(threads)
  }, [threads, loadedAt, baseKind])

  // 'priority' turned 'all' (the DMs page, ⌘K): the whole read is owed now, from the snapshot first.
  // Before the mount effect below, so a read that starts on this commit already wants the whole view.
  useEffect(() => {
    wantAll.current = all
    if (!all || !enabled || base.current === 'full') return
    // Nothing read and nothing reading: the mount's read below already wants the whole view.
    if (base.current === 'none' && !busy.current) return
    mayWarmStart.current = true
    owed.current.full = true
    void pump()
  }, [all, enabled, pump])

  const pending = useRef<number | null>(null)
  const pendingUrgent = useRef(false)
  useEffect(() => {
    if (!enabled) return
    alive.current = true
    // The mount's read may warm-start from the device snapshot; every later refresh() reads the whole view.
    mayWarmStart.current = true
    owed.current.full = true
    void pump()
    // Trailing-edge coalesce: while a run is already scheduled, further events
    // only add to what it owes. `urgent` (a whole read, an inbound message, or a return check)
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
      else { owed.current.sweep = true; owed.current.urgent = true; nudge(true) }
    }
    let subscribed = false
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outreach_messages' }, onEvent)
      .subscribe(status => {
        // A re-subscribe after a drop missed whatever happened in between.
        if (status === 'SUBSCRIBED') { if (subscribed) { owed.current.sweep = true; owed.current.urgent = true; nudge(true) } subscribed = true }
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
      alive.current = false
      if (overdueTimer.current !== null) { clearTimeout(overdueTimer.current); overdueTimer.current = null }
      if (snapshotTimer.current !== null) { clearTimeout(snapshotTimer.current); snapshotTimer.current = null }
      nudgeRef.current = null
      window.clearInterval(tick)
      supabase.removeChannel(ch)
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [refresh, pump, topic, enabled])
  // A Needs-you read under 'all' is the early paint, not the list: reported as one until the whole read lands.
  const partial = all && baseKind === 'priority'
  return {
    threads, loading: loading || (partial && error === null), error, loadedAt: partial ? null : loadedAt, readStartedAt,
    priorityAt: partial ? (priorityAt ?? loadedAt) : priorityAt, fromCache, cachedAt, refresh,
    /** When the last read that holds every Needs-you conversation landed (either scope): the frame's DM counts read this. */
    liveAt: loadedAt,
    scope: (all ? 'all' : 'priority') as InboxScope,
  }
}
