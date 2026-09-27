// D · DMs. Three seat columns + the open conversation (desktop); one seat list with seat tiles and
// the conversation as its own page (phone). Every hook runs before any branch (09-09 rule).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePreRead } from '../../exp/v2c/chat/usePreRead'
import { applyThreadTokens, readTokens, writeTokens, type FilterToken } from '../../lib/filterTokens'
import { eventTime, isOlderOwed, searchThreads, type Thread } from '../../lib/inbox'
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
import { useDmKeys } from './useDmKeys'
import './dms.css'
import './dms-thread.css'

export default function DmsPage(props: PlaceProps) {
  return <DmAsks><Dms {...props} /></DmAsks>
}

function Dms({ layout, route, navigate }: PlaceProps) {
  const data = useDmsData()
  const counts = useFrameCounts()
  const frame = useFrame()
  const pre = usePreRead()
  const [q, setQ] = useState('')
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
  const stale = useMemo(() => threads.filter(t => t.draft && !t.spam && (t.draftStale || isOlderOwed(t, now))), [threads, now])
  const open = threadId ? byId.get(threadId) ?? null : null

  const failedN = (data.error ? 1 : 0) + (data.cameBack.failed ? 1 : 0) + (data.warm.failed ? 1 : 0) + (data.dated.failed ? 1 : 0)
  useReportFailed('dms', failedN)

  const go = useCallback((extra: Record<string, string | null>) => {
    const next = new URLSearchParams(route.query)
    for (const [k, v] of Object.entries(extra)) { if (v == null) next.delete(k); else next.set(k, v) }
    navigate(dHash('dms', null, next))
  }, [route.query, navigate])
  const openThread = useCallback((t: Thread) => go({ thread: t.prospect_id }), [go])
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
    else if (a === 'stale-discard') void verbs.bulkDiscard(stale, 'Drafts nobody approved in 14 days, and drafts answering a message you already replied to.')
    else if (a === 'copy-thread') void copyText(`${location.origin}${location.pathname}${dHash('dms', null, { thread: t.prospect_id })}`)
  }, [verbs, closeThread, toggleCheck, stale])

  useDmKeys({ searchRef, open, openThread, closeThread, toggleCheck })

  const model: PageModel = {
    layout, mode, folder, q, setQ, tokens, setTokens, searchRef, views, stats, matches, open, threadId, threads, byId,
    data, counts, verbs, now, busy, setBusy, checked, setChecked, openThread, closeThread, ask, onMenu, staleN: stale.length, pre,
    phoneSeat, setPhoneSeat: (s: Seat) => go({ seat: s }), setFolder: (f: string | null) => go({ folder: f, thread: null }),
  }
  return layout === 'desktop' ? <DesktopDms m={model} /> : <PhoneDms m={model} />
}
