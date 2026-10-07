import { useBrainMembers, mergeCheckedMembers } from '../../hooks/useBrainMembers'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { fetchWeekDrafts, type ContentDraft } from '../../lib/content'
import { supabase } from '../../lib/supabase'
import { readSwr, redactCapability, swrSafe, writeSwr } from '../../lib/swr'
import { DAY_MS } from './model'
import { laneOfRow } from './weekModel'

// THE WEEK READ behind Content > Review, painted from the saved copy first.
//
// First render: the last reconciled week off this device (lib/swr, keyed by the
// signed-in user), so the stack draws at once on a second open. Then one read
// of only the rows the week can show (fetchWeekDrafts), not the three full
// 1,000-row lane reads. The page starts those after this one settles.
//
// The SWR rules this app already paid for (inbox-native-pass, N3b):
//   · a failed read never becomes a paint (nothing is written on an error);
//   · an EMPTY answer over a saved copy that held posts is a failed refresh,
//     never a truth: the copy stays, and the page says the refresh failed;
//   · capability links never reach storage (bodies redacted, writeSwr refuses).
export const WEEK_CACHE = 'content-week-guarded-v2'

export type WeekRead = {
  rows: ContentDraft[]
  /** Where the rows on screen came from. */
  source: 'none' | 'cache' | 'live'
  memberReadState?: 'idle' | 'pending' | 'partial' | 'failed'
  /** When the rows on screen were read (the saved copy's stamp while it is shown). */
  at: string | null
  loading: boolean
  error: string | null
  /** The server's exact count, when it is more than the rows that came back. */
  capped: number | null
  /** The first live read has answered (rows or an error). */
  settled: boolean
  refresh: () => void
}

type Saved = { rows: ContentDraft[] }

/** What goes to storage: this week's rows of the three seats, with capability links out of every text. */
export function toSaved(rows: ContentDraft[]): Saved {
  const clean = (s: string | null | undefined) => (s == null ? s ?? null : redactCapability(s))
  return {
    rows: rows.filter(r => laneOfRow(r) !== null && r.cb34_p2_member !== true).map(r => ({
      ...r,
      title: clean(r.title), topic: clean(r.topic), post_body: clean(r.post_body),
      source_label: clean(r.source_label), log_body: clean(r.log_body),
      source_ref: r.source_ref && swrSafe(r.source_ref) ? r.source_ref : null,
    })),
  }
}

export function weekRange(now: number): { from: string; to: string } {
  return { from: new Date(now - 8 * DAY_MS).toISOString(), to: new Date(now + 9 * DAY_MS).toISOString() }
}

export function memberFitsWeek(r: ContentDraft, now: number): boolean {
  const { from, to } = weekRange(now)
  return laneOfRow(r) !== null && (r.status === 'review' || r.scheduled_at != null && r.scheduled_at >= from && r.scheduled_at < to)
}

export function useWeekRead(enabled: boolean, now: number): WeekRead {
  const [saved] = useState(() => (enabled ? readSwr<Saved>(WEEK_CACHE) : null))
  const [rows, setRows] = useState<ContentDraft[]>(() => saved?.payload.rows ?? [])
  const [memberReadState, setMemberReadState] = useState<'idle' | 'pending' | 'partial' | 'failed'>('idle')
  const [source, setSource] = useState<WeekRead['source']>(saved ? 'cache' : 'none')
  const [at, setAt] = useState<string | null>(saved?.savedAt ?? null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [capped, setCapped] = useState<number | null>(null)
  const [settled, setSettled] = useState(false)
  const shown = useRef(rows.filter(r => r.cb34_p2_member !== true).length)
  shown.current = rows.filter(r => r.cb34_p2_member !== true).length
  const topic = `carousel_drafts:week:${useId()}`
  const generation = useRef(0)
  const fullAccepted = useRef(false)
  const visibilityEpoch = useRef(0)
  const fullPendingEpoch = useRef<number | null>(null)
  const active = useRef(false)
  const scope = useRef({ enabled, now })
  scope.current = { enabled, now }

  const refresh = useCallback(() => {
    if (!active.current || !enabled || !scope.current.enabled || scope.current.now !== now) return
    const epoch = visibilityEpoch.current
    fullAccepted.current = false
    fullPendingEpoch.current = epoch
    const request = ++generation.current
    const current = () => active.current && request === generation.current && epoch === visibilityEpoch.current && scope.current.enabled && scope.current.now === now
    setLoading(true)
    // A saved release is not current validation. Keep ordinary SWR rows only.
    setRows(previous => previous.filter(r => r.cb34_p2_member !== true))
    const { from, to } = weekRange(now)
    fetchWeekDrafts(from, to)
      .then(page => {
        if (!current()) return
        const mine = page.rows.filter(r => laneOfRow(r) !== null)
        if (mine.length === 0 && shown.current > 0) {
          setError('The refresh came back empty over a saved week that held posts, so the saved copy stays.')
        } else {
          fullAccepted.current = true; setMemberReadState('idle'); setRows(mine); setSource('live'); setAt(new Date().toISOString()); setError(null)
          setCapped(page.count != null && page.count > page.rows.length ? page.count : null)
          writeSwr(WEEK_CACHE, toSaved(mine))
        }
      })
      .catch((e: unknown) => { if (current()) setError(e instanceof Error ? e.message : 'this week is unavailable') })
      .finally(() => { if (current()) { fullPendingEpoch.current = null; setLoading(false); setSettled(true) } })
  }, [enabled, now])

  // Opened on another Content place first (the page mounts once): paint the saved copy the moment Review is picked.
  useEffect(() => {
    if (!enabled || source !== 'none') return
    const s = readSwr<Saved>(WEEK_CACHE)
    if (s?.payload.rows?.length) { setRows(s.payload.rows); setSource('cache'); setAt(s.savedAt) }
  }, [enabled, source])

  useEffect(() => {
    if (!enabled) return
    active.current = true
    refresh()
    let t: ReturnType<typeof setTimeout> | null = null
    const soon = () => {
      if (!active.current) return
      ++generation.current
      setRows(previous => previous.filter(r => r.cb34_p2_member !== true))
      setLoading(true)
      if (t) clearTimeout(t)
      t = setTimeout(refresh, 700)
    }
    let ch: ReturnType<typeof supabase.channel> | null = null
    try {
      ch = supabase.channel(topic).on('postgres_changes', { event: '*', schema: 'public', table: 'carousel_drafts' }, soon).subscribe()
    } catch { ch = null }
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener('wb-rows-changed', soon)
    return () => {
      active.current = false
      ++generation.current
      if (t) clearTimeout(t)
      if (ch) void supabase.removeChannel(ch)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('wb-rows-changed', soon)
    }
  }, [enabled, refresh, topic])

  useBrainMembers(rows, () => { fullAccepted.current = false; ++visibilityEpoch.current; setMemberReadState('pending'); setCapped(null); ++generation.current; setRows(previous => previous.filter(r => r.cb34_p2_member !== true)) }, (fresh, checkedIds) => {
    if (fullAccepted.current) return true
    if (fullPendingEpoch.current === visibilityEpoch.current) return false
    const mine = fresh.filter(r => memberFitsWeek(r, now))
    setRows(previous => mergeCheckedMembers(previous, mine, checkedIds))
    setMemberReadState('partial'); setLoading(false)
  }, String(now), enabled, () => { if (!fullAccepted.current) setMemberReadState('failed') }, () => fullPendingEpoch.current === visibilityEpoch.current)

  return { rows, source, at, loading, error, capped, settled, memberReadState, refresh }
}
