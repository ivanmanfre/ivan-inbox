// D · DMs. Three seat columns + the open conversation (desktop); one seat list with seat tiles and
// the conversation as its own page (phone). Every hook runs before any branch (09-09 rule).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePreRead } from '../../exp/v2c/chat/usePreRead'
import { applyThreadTokens, readTokens, writeTokens, type FilterToken } from '../../lib/filterTokens'
import { eventTime, isConversation, searchThreads, type Thread } from '../../lib/inbox'
import { subjectForThread } from '../../wb/ask/askAbout'
import { useFrameCounts } from '../counts/useFrameCounts'
import type { PlaceProps } from '../places'
import { dHash } from '../route'
import { SEATS, seatOf, type Seat } from '../seats'
import { useFrame } from '../shell/frame'
import { useReportFailed } from '../shell/health'
import { handOffToClaude } from '../ui/claudeHandoff'
import { DmAsks } from './asks'
import type { Mode } from './Column'
import { DesktopDms, PhoneDms, type PageModel } from './Layouts'
import type { MenuAct } from './Menu'
import { outByDay, replied7d, seatView } from './model'
import { copyText } from './Thread'
import { useDmsData } from './useDmsData'
import { useDmVerbs } from './verbs'
import { AgentOnlySheet, WarmSheet } from './Warm'
import { useWarmVerbs } from './warmVerbs'
import { RowMenu } from './RowMenu'
import { useToast } from '../ui/toast'
import { useDmKeys } from './useDmKeys'
import './dms.css'
import './dms-thread.css'
import './dms-more.css'

export default function DmsPage(props: PlaceProps) {
  return <DmAsks><Dms {...props} /></DmAsks>
}

function Dms({ layout, route, navigate }: PlaceProps) {
  const data = useDmsData()
  const counts = useFrameCounts()
  const frame = useFrame()
  const pre = usePreRead()
  const [q, setQ] = useState(() => route.query.get('q') ?? '')
  const [tokens, setTokensState] = useState<FilterToken[]>(() => readTokens('dms'))
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const i = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(i) }, [])
  useEffect(() => { setNow(Date.now()) }, [data.loadedAt])

  const setTokens = useCallback((t: FilterToken[]) => { setTokensState(t); writeTokens('dms', t) }, [])
  const refreshCounts = counts.refresh
  const ctx = useMemo(() => ({ refresh: () => { data.refreshList(); data.reloadCame(); refreshCounts('dms') }, patch: data.patch }),
    [data.refreshList, data.reloadCame, data.patch, refreshCounts]) // eslint-disable-line react-hooks/exhaustive-deps
  const verbs = useDmVerbs(ctx)
  const toast = useToast()
  const fail = useCallback((message: string) => { toast.show({ message, tone: 'failed' }) }, [toast])
  const warmAfter = useCallback(() => { data.reloadWarm(); data.reloadAgent(); ctx.refresh() }, [data.reloadWarm, data.reloadAgent, ctx]) // eslint-disable-line react-hooks/exhaustive-deps
  const warmVerbs = useWarmVerbs(warmAfter)

  const folder = route.query.get('folder')
  const mode: Mode = folder === 'spam' ? 'spam' : folder === 'email' ? 'email' : q.trim() || tokens.length ? 'search' : 'conversations'
  const threadId = route.query.get('thread')
  const phoneSeat = (SEATS as readonly string[]).includes(route.query.get('seat') ?? '') ? route.query.get('seat') as Seat : 'ivan'

  const threads = data.threads
  const byId = useMemo(() => new Map(threads.map(t => [t.prospect_id, t])), [threads])
  const views = useMemo(() => Object.fromEntries(SEATS.map(s => [s, seatView(threads, s, now, data.scanDays)])) as Record<Seat, ReturnType<typeof seatView>>, [threads, now, data.scanDays])
  const stats = useMemo(() => Object.fromEntries(SEATS.map(s => [s, { days: outByDay(threads, s, now), replied: replied7d(threads, s, now) }])) as PageModel['stats'], [threads, now])
  const matches = useMemo(() => {
    if (mode !== 'search') return { ivan: [], risedtc: [], arch: [] } as Record<Seat, Thread[]>
    const hits = applyThreadTokens(searchThreads(threads, q.trim()), tokens, now).sort((a, b) => eventTime(b.last).localeCompare(eventTime(a.last)))
    return Object.fromEntries(SEATS.map(s => [s, hits.filter(t => seatOf(t.client_id) === s)])) as Record<Seat, Thread[]>
  }, [mode, threads, q, tokens, now])
  // Today's StaleBar set, per seat (lane-scoped): drafts answering a message he already replied to.
  const staleBy = useMemo(() => Object.fromEntries(SEATS.map(s => [s, threads.filter(t => isConversation(t) && !t.spam && t.draft !== null && t.draftStale && seatOf(t.client_id) === s)])) as Record<Seat, Thread[]>, [threads])
  const [rowMenu, setRowMenu] = useState<Thread | null>(null)
  // Desktop with no ?thread: the first conversation that needs you is shown (as the mock does), but it
  // was not opened by Ivan, so its read stamp is not written (`auto`).
  const autoOpen = threadId || layout !== 'desktop' ? null
    : mode === 'conversations' ? SEATS.map(s => { const v = views[s]; return v.owner[0] ?? v.drafted[0] ?? v.nodraft[0] }).find(Boolean) ?? null
      : mode === 'spam' ? views.risedtc.spam[0] ?? views.arch.spam[0] ?? null
        : mode === 'search' ? SEATS.map(s => matches[s][0]).find(Boolean) ?? null : null
  const open = threadId ? byId.get(threadId) ?? null : autoOpen

  const failedN = (data.error ? 1 : 0) + (data.cameBack.failed ? 1 : 0) + (data.warm.failed ? 1 : 0) + (data.dated.failed ? 1 : 0)
  useReportFailed('dms', failedN)

  const go = useCallback((extra: Record<string, string | null>) => {
    const next = new URLSearchParams(route.query)
    for (const [k, v] of Object.entries(extra)) { if (v == null) next.delete(k); else next.set(k, v) }
    navigate(dHash('dms', null, next))
  }, [route.query, navigate])
  const openThread = useCallback((t: Thread) => go({ thread: t.prospect_id, warm: null }), [go])
  // `?warm=1` lands on the Warm signals section; `?warm=<prospect>` opens that card (today's deep link).
  const warm = route.query.get('warm')
  const openWarm = useCallback((pid: string) => go({ warm: pid }), [go])
  const closeWarm = useCallback(() => go({ warm: null }), [go])
  const warmFocused = useRef<string | null>(null)
  useEffect(() => {
    if (!warm || warmFocused.current === warm || !data.warm.loaded) return
    warmFocused.current = warm
    const el = warm === '1' ? document.getElementById('dm-warm') : document.querySelector(`[data-pid="${CSS.escape(warm)}"]`) ?? document.getElementById('dm-warm')
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [warm, data.warm.loaded])
  const warmCard = warm && warm !== '1' ? data.warm.rows.find(w => w.prospect_id === warm) ?? null : null
  const agentOnlyCard = warm && warm !== '1' && !warmCard ? data.agent.cards.find(a => a.prospect_id === warm) ?? null : null
  const closeThread = useCallback(() => go({ thread: null }), [go])
  const toggleCheck = useCallback((id: string) => setChecked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])

  const ask = useCallback((t: Thread, intent: 'ask' | 'draft') => {
    handOffToClaude({ subject: subjectForThread(t), intent })
    frame.setClaudeOpen(true)
  }, [frame])

  const onMenu = useCallback((t: Thread, a: MenuAct) => {
    if (a === 'spam') void verbs.spam(t)
    else if (a === 'not-spam') void verbs.notSpam(t)
    else if (a === 'delete-seat') void verbs.deleteSeat(t).then(ok => { if (ok) closeThread() })
    else if (a === 'select') toggleCheck(t.prospect_id)
    else if (a === 'stale-discard') void verbs.discardStale(staleBy[seatOf(t.client_id) ?? 'ivan'])
    else if (a === 'copy-thread') void copyText(`${location.origin}${location.pathname}${dHash('dms', null, { thread: t.prospect_id })}`)
  }, [verbs, closeThread, toggleCheck, staleBy])

  useDmKeys({ searchRef, open, openThread, closeThread, toggleCheck })

  const model: PageModel = {
    layout, mode, folder, q, setQ, tokens, setTokens, searchRef, views, stats, matches, open, threadId, auto: autoOpen !== null, threads, byId,
    data, counts, verbs, warmVerbs, fail, openWarm, now, busy, setBusy, checked, setChecked, openThread, closeThread, ask, onMenu, staleN: 0, staleBy, rowMore: setRowMenu, refreshAll: data.refreshAll, pre,
    phoneSeat, setPhoneSeat: (s: Seat) => go({ seat: s }), setFolder: (f: string | null) => go({ folder: f, thread: null }),
  }
  const agentChanged = () => { data.reloadAgent(); data.reloadWarm() }
  return <>
    {layout === 'desktop' ? <DesktopDms m={model} /> : <PhoneDms m={model} />}
    {warmCard && <WarmSheet c={warmCard} agent={data.agent.cards.find(a => a.prospect_id === warmCard.prospect_id) ?? null} thread={byId.get(warmCard.prospect_id) ?? null}
      verbs={warmVerbs} onClose={closeWarm} onOpenThread={openThread} onAgentChanged={agentChanged} />}
    {rowMenu && <RowMenu t={rowMenu} pre={pre} verbs={verbs} onClose={() => setRowMenu(null)} onOpen={() => openThread(rowMenu)} onAsk={() => ask(rowMenu, 'ask')} />}
    {agentOnlyCard && <AgentOnlySheet card={agentOnlyCard} thread={byId.get(agentOnlyCard.prospect_id) ?? null} onClose={closeWarm} onOpenThread={openThread} onAgentChanged={agentChanged} />}
  </>
}
