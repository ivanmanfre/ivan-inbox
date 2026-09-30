// The DMs page's reads. The list is TODAY'S read (useInbox: the whole message view, the four
// side probes, groupThreads, the saved copy for a fast first paint). Around it, three small reads
// the sections need, each failing on its own without taking the list down:
//   · came_back_cards()   (all seats; the raw rows also give Ivan's scan-open days for the lift)
//   · warm_signal_cards() (Ivan's seat)
//   · dated follow-ups    (outreach_prospects skip_reason='follow_up_dated': id + date only;
//                          the seat comes from the conversation's own client_id)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDInbox } from '../counts/inbox'
import { groupThreads, type InboxMessage, type Thread } from '../../lib/inbox'
import { withSolved } from '../counts/solved'
import { supabase } from '../../lib/supabase'
import { FOLLOW_UP_REASON } from '../../lib/followUp'
import { scanOpenDays, scanReopenOnlyIvan, type CameBackCard } from '../../wb/dms/cameBackData'
import { fetchWarmCards, type WarmCard } from '../../wb/dms/warmSignalsData'
import { fetchConversationAgentCards, type ConversationAgentCard, type ConversationAgentFeed } from '../../wb/dms/conversationAgentData'
import { projectFollowups, type FollowupSource } from './upcoming'

export type Side<T> = { rows: T[]; failed: boolean; loaded: boolean }
export type DatedFollowUp = { prospect_id: string; at: string }

const none = <T,>(): Side<T> => ({ rows: [], failed: false, loaded: false })

async function readCameBackRaw(): Promise<CameBackCard[]> {
  const { data, error } = await supabase.rpc('came_back_cards')
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
async function readFollowupSources(): Promise<FollowupSource[]> {
  const { data, error } = await supabase.rpc('inbox_followup_sources')
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Could not read the follow-up schedule')
  return data as FollowupSource[]
}
export type AgentSide = { cards: ConversationAgentCard[]; note: string | null; failed: boolean; loaded: boolean }

function useSide<T>(read: () => Promise<T[]>): [Side<T>, () => void, (fn: (rows: T[]) => T[]) => void] {
  const [s, set] = useState<Side<T>>(none)
  const alive = useRef(true)
  const request = useRef(0)
  const load = useCallback(() => {
    const id = ++request.current
    read().then(rows => { if (alive.current && id === request.current) set({ rows, failed: false, loaded: true }) })
      .catch(() => { if (alive.current && id === request.current) set(p => ({ ...p, failed: true, loaded: true })) })
  }, [read])
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false } }, [load])
  const edit = useCallback((fn: (rows: T[]) => T[]) => set(p => ({ ...p, rows: fn(p.rows) })), [])
  return [s, load, edit]
}

type Patch = { at: number; p: Partial<InboxMessage> }

export function useDmsData() {
  const inbox = useDInbox()
  const [cameRaw, reloadCame, editCame] = useSide(readCameBackRaw)
  const [warm, reloadWarm, editWarm] = useSide<WarmCard>(fetchWarmCards)
  const [dated, readDates] = useSide(readDatedFollowUps)
  const [followupRaw, reloadFollowups] = useSide(readFollowupSources)
  const upcoming = useMemo(() => ({ ...followupRaw, rows: projectFollowups(followupRaw.rows) }), [followupRaw])
  const reloadDated = useCallback(() => { readDates(); reloadFollowups() }, [readDates, reloadFollowups])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') reloadDated() }
    const interval = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh) }
  }, [reloadDated])
  useEffect(() => { if (inbox.loadedAt) reloadDated() }, [inbox.loadedAt, reloadDated])
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

  const refreshAll = useCallback(() => {
    inbox.refresh(); reloadCame(); reloadWarm(); reloadDated(); reloadAgent()
  }, [inbox, reloadCame, reloadWarm, reloadDated, reloadAgent])

  return {
    threads, loading: inbox.loading, error: inbox.error, loadedAt: inbox.loadedAt, fromCache: inbox.fromCache, cachedAt: inbox.cachedAt,
    refreshList: inbox.refresh, refreshAll, patch, solved: inbox.solved,
    cameBack: { ...cameRaw, rows: cameBack }, dropCameBack: (pid: string) => editCame(r => r.filter(c => c.prospect_id !== pid)), reloadCame,
    scanDays, warm, dropWarm: (pid: string) => editWarm(r => r.filter(c => c.prospect_id !== pid)), reloadWarm,
    dated, reloadDated, upcoming,
    agent, reloadAgent,
  }
}

export type DmsData = ReturnType<typeof useDmsData>
