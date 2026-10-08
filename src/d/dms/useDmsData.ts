// The DMs page's reads. The list is TODAY'S read (useInbox: the whole message view, the four
// side probes, groupThreads, the saved copy for a fast first paint). Around it, three small reads
// the sections need, each failing on its own without taking the list down:
//   · inbox_interest_cards() (all seats; the raw rows also give Ivan's scan-open days for the lift)
//   · warm_signal_cards() (Ivan's seat)
//   · dated follow-ups    (outreach_prospects skip_reason='follow_up_dated': id + date only;
//                          the seat comes from the conversation's own client_id)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDInbox } from '../counts/inbox'
import { groupThreads, type InboxMessage, type Thread } from '../../lib/inbox'
import { withSolved } from '../counts/solved'
import { supabase } from '../../lib/supabase'
import { FOLLOW_UP_REASON } from '../../lib/followUp'
import { interestPriority, scanOpenDays, scanReopenOnlyIvan, type CameBackCard } from '../../wb/dms/cameBackData'
import { fetchWarmCards, type WarmCard } from '../../wb/dms/warmSignalsData'
import { fetchConversationAgentCards, type ConversationAgentCard, type ConversationAgentFeed } from '../../wb/dms/conversationAgentData'
import { projectFollowups, type FollowupSource } from './upcoming'
import { forget, recall, remember } from '../../lib/pageMemo'

export type Side<T> = { rows: T[]; failed: boolean; loaded: boolean }
export type DatedFollowUp = { prospect_id: string; at: string }

const none = <T,>(): Side<T> => ({ rows: [], failed: false, loaded: false })

async function readCameBackRaw(): Promise<CameBackCard[]> {
  const { data, error } = await supabase.rpc('inbox_interest_cards')
  if (error) throw error
  return (data ?? []) as CameBackCard[]
}

async function readDatedFollowUps(): Promise<DatedFollowUp[]> {
  const { data, error } = await supabase.from('outreach_prospects')
    .select('id,next_touch_after')
    .eq('skip_reason', FOLLOW_UP_REASON).not('next_touch_after', 'is', null)
    .is('call_booked_at', null).eq('blacklisted', false).is('skip_state', null)
    .in('stage', ['replied','positive_reply','dm_sent','connected'])
    .order('next_touch_after', { ascending: true }).limit(500)
  if (error) throw error
  return ((data ?? []) as { id: string; next_touch_after: string }[]).map(r => ({ prospect_id: r.id, at: r.next_touch_after }))
}

// Today's agent read (conversation_agent_cards): 'unavailable' is a reason to show, not a failure.
async function readAgent(): Promise<ConversationAgentFeed[]> { return [await fetchConversationAgentCards()] }
async function fetchFollowupSources(): Promise<FollowupSource[]> {
  const { data, error } = await supabase.rpc('inbox_followup_sources')
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Could not read the follow-up schedule')
  return data as FollowupSource[]
}

// PERF-SMOOTH (2026-10-08): inbox_followup_sources is ~2.1 MB (every eligible prospect with its whole
// message history) and was read twice on every DMs open (the mount read, then again for the inbox's
// loadedAt that was already there), again on every inbox land (each realtime message), every 60 s and
// on every window focus: 3 reads / 6.3 MB in 90 s of sitting on DMs. One shared read now: concurrent
// asks share the request in flight, an ask answered by a read younger than its `fresh` window gets
// that read, and the first open of a visit paints the last read of this session (lib/pageMemo).
// The schedule is still never older than ~60 s while DMs is open (the minute tick asks for 55 s).
// Never a failure, never an empty list over a known non-empty one (that copy is dropped instead).
export const FOLLOWUP_FRESH = { mount: 60_000, land: 20_000, tick: 55_000, focus: 30_000, force: 0 } as const
const FOLLOWUP_MEMO = 'dms:followup-sources'
let followupInFlight: { p: Promise<FollowupSource[]>; at: number } | null = null
/** `fresh` 0 (the default, every explicit reload) always starts a new read: a verb's write must be in it. */
export function readFollowupSources(fresh: number = FOLLOWUP_FRESH.force, now: number = Date.now()): Promise<FollowupSource[]> {
  const window_ = Number.isFinite(fresh) && fresh > 0 ? fresh : 0
  if (window_ > 0) {
    if (followupInFlight && now - followupInFlight.at < window_) return followupInFlight.p
    const hit = recall<FollowupSource[]>(FOLLOWUP_MEMO, now)
    if (hit && now - hit.at < window_) return Promise.resolve(hit.value)
  }
  const at = Date.now()
  const p = fetchFollowupSources().then(rows => {
    // Only the newest read writes the copy; an empty answer over a non-empty copy drops it instead.
    if (!followupInFlight || followupInFlight.p === p) { if (!remember(FOLLOWUP_MEMO, rows, { at })) forget(FOLLOWUP_MEMO) }
    return rows
  })
  followupInFlight = { p, at }
  const done = () => { if (followupInFlight?.p === p) followupInFlight = null }
  void p.then(done, done)
  return p
}
/** The last read of this session, for the first paint of a DMs visit. */
export function rememberedFollowups(): FollowupSource[] | null {
  return recall<FollowupSource[]>(FOLLOWUP_MEMO)?.value ?? null
}
export type AgentSide = { cards: ConversationAgentCard[]; note: string | null; failed: boolean; loaded: boolean }

// `read` gets the freshness the caller asked for (readFollowupSources honours it; the others ignore it).
// `seed` is the first paint (a remembered copy); the mount read runs either way.
function useSide<T>(read: (fresh?: number) => Promise<T[]>, mountFresh?: number, seed?: () => T[] | null): [Side<T>, (fresh?: number) => void, (fn: (rows: T[]) => T[]) => void] {
  const [s, set] = useState<Side<T>>(() => { const rows = seed?.(); return rows ? { rows, failed: false, loaded: true } : none() })
  const alive = useRef(true)
  const request = useRef(0)
  const load = useCallback((fresh?: number) => {
    const id = ++request.current
    read(fresh).then(rows => { if (alive.current && id === request.current) set({ rows, failed: false, loaded: true }) })
      .catch(() => { if (alive.current && id === request.current) set(p => ({ ...p, failed: true, loaded: true })) })
  }, [read])
  useEffect(() => { alive.current = true; load(mountFresh); return () => { alive.current = false } }, [load, mountFresh])
  const edit = useCallback((fn: (rows: T[]) => T[]) => set(p => ({ ...p, rows: fn(p.rows) })), [])
  return [s, load, edit]
}

type Patch = { at: number; p: Partial<InboxMessage> }

export function useDmsData() {
  const inbox = useDInbox()
  const [cameRaw, reloadCame, editCame] = useSide(readCameBackRaw)
  const [warm, reloadWarm, editWarm] = useSide<WarmCard>(fetchWarmCards)
  const [dated, readDates] = useSide(readDatedFollowUps)
  const [followupRaw, reloadFollowups] = useSide(readFollowupSources, FOLLOWUP_FRESH.mount, rememberedFollowups)
  const upcoming = useMemo(() => ({ ...followupRaw, rows: projectFollowups(followupRaw.rows) }), [followupRaw])
  // An explicit reload (a verb's `dated`, Retry, pull) always reads; the background asks say how fresh is enough.
  const reloadDated = useCallback((fresh: number = FOLLOWUP_FRESH.force) => { readDates(); reloadFollowups(fresh) }, [readDates, reloadFollowups])
  useEffect(() => {
    const tick = () => { if (document.visibilityState !== 'hidden') reloadDated(FOLLOWUP_FRESH.tick) }
    const focus = () => { if (document.visibilityState !== 'hidden') reloadDated(FOLLOWUP_FRESH.focus) }
    const interval = window.setInterval(tick, 60_000)
    window.addEventListener('focus', focus)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', focus) }
  }, [reloadDated])
  // A land of the inbox (a message moved) re-reads; the loadedAt already there when the page mounted does
  // not (the mount read above covers it: it was the second 2 MB read of every open).
  const landSeen = useRef(inbox.loadedAt)
  useEffect(() => {
    if (!inbox.loadedAt || inbox.loadedAt === landSeen.current) return
    landSeen.current = inbox.loadedAt
    reloadDated(FOLLOWUP_FRESH.land)
  }, [inbox.loadedAt, reloadDated])
  const [agentRaw, reloadAgent] = useSide(readAgent)
  const agent: AgentSide = useMemo(() => {
    const f = agentRaw.rows[0]
    return { cards: f?.kind === 'ready' ? f.cards : [], note: f && f.kind !== 'ready' ? f.reason : null, failed: agentRaw.failed || f?.kind === 'error', loaded: agentRaw.loaded }
  }, [agentRaw])

  // Optimistic overlay: a verb's effect shows at once and is dropped the moment a read that
  // started after it lands (that read already carries the write).
  const [patches, setPatches] = useState<Map<string, Patch>>(new Map())
  const patch = useCallback((ids: string[], p: Partial<InboxMessage>) => {
    setPatches(prev => {
      const next = new Map(prev)
      const at = Date.now()
      for (const id of ids) next.set(id, { at, p: { ...(prev.get(id)?.p ?? {}), ...p } })
      return next
    })
  }, [])
  const loadedMs = inbox.loadedAt ? Date.parse(inbox.loadedAt) : 0
  useEffect(() => {
    setPatches(prev => {
      if (!prev.size) return prev
      const next = new Map([...prev].filter(([, v]) => v.at > loadedMs - 1500))
      return next.size === prev.size ? prev : next
    })
  }, [loadedMs])

  const threads: Thread[] = useMemo(() => {
    if (!patches.size) return inbox.threads
    const rows = inbox.threads.flatMap(t => t.messages.map(m => {
      const hit = patches.get(m.id)
      return hit ? { ...m, ...hit.p } : m
    }))
    const flags = new Set(inbox.threads.filter(t => t.needsManualReply).map(t => t.prospect_id))
    // Regrouping drops what the view does not carry: put the merged "Mark as solved" stamps back.
    const solved = new Map(inbox.threads.filter(t => t.solvedAt).map(t => [t.prospect_id, t.solvedAt ?? null] as const))
    return withSolved(groupThreads(rows, flags), solved)
  }, [inbox.threads, patches])

  const cameBack = useMemo(() => cameRaw.rows.filter(c => !scanReopenOnlyIvan(c)), [cameRaw.rows])
  const scanDays = useMemo(() => new Map(cameRaw.rows.map(c => [c.prospect_id, scanOpenDays(c)])), [cameRaw.rows])
  const interestRanks = useMemo(() => new Map(cameRaw.rows.map(c => [c.prospect_id, interestPriority(c)])), [cameRaw.rows])

  const refreshAll = useCallback(() => {
    inbox.refresh(); reloadCame(); reloadWarm(); reloadDated(); reloadAgent()
  }, [inbox, reloadCame, reloadWarm, reloadDated, reloadAgent])

  return {
    threads, loading: inbox.loading, error: inbox.error, loadedAt: inbox.loadedAt, fromCache: inbox.fromCache, cachedAt: inbox.cachedAt,
    refreshList: inbox.refresh, refreshAll, patch, solved: inbox.solved,
    cameBack: { ...cameRaw, rows: cameBack }, dropCameBack: (pid: string) => editCame(r => r.filter(c => c.prospect_id !== pid)), reloadCame,
    scanDays, interestRanks, warm, dropWarm: (pid: string) => editWarm(r => r.filter(c => c.prospect_id !== pid)), reloadWarm,
    dated, reloadDated, upcoming,
    agent, reloadAgent,
  }
}

export type DmsData = ReturnType<typeof useDmsData>
