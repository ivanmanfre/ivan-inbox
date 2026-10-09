import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { internalTestDraft, operatorDeleted, type ContentDraft } from '../../lib/content'
import { supabase } from '../../lib/supabase'
import { readSwr, writeSwr } from '../../lib/swr'
import { BRAIN_INVALIDATED, useBrainMembers, validMemberRows } from '../../hooks/useBrainMembers'
import { contentWeek, nextWeekDays, type ContentWeek } from '../lanes/glance/model'
import { SEATS, type Seat } from '../seats'
import { withTimeout } from '../ui/timeout'
import type { Read } from './model'

const COLS = 'id,cb34_p2_member,client_id,status,title,topic,post_body,scheduled_at,published_at,board_visible,updated_at,created_at,taxonomy'
const PAGE = 1000
type Weeks = Record<Seat, ContentWeek>

/** Home needs only dated rows around next week, across all seats. The guarded view remains the sole source. */
export async function fetchHomeWeekRows(now: number): Promise<ContentDraft[]> {
  const days = nextWeekDays(now)
  const from = new Date(Date.parse(`${days[0].key}T00:00:00Z`) - 86_400_000).toISOString()
  const to = new Date(Date.parse(`${days[4].key}T00:00:00Z`) + 2 * 86_400_000).toISOString()
  const rows: ContentDraft[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.from('cb34_p2_safe_drafts').select(COLS)
      .gte('scheduled_at', from).lt('scheduled_at', to).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw error
    const batch = (data ?? []) as unknown as ContentDraft[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  const ordinary = rows.filter(r => r.cb34_p2_member !== true)
  const members = rows.filter(r => r.cb34_p2_member === true)
  const checked: ContentDraft[] = []
  for (const client of [null, 'ivan', 'risedtc', 'arch']) {
    const mine = members.filter(r => r.client_id === client)
    for (let i = 0; i < mine.length; i += 50) {
      const subset = mine.slice(i, i + 50)
      let q = supabase.from('cb34_p2_safe_drafts').select('*').in('id', subset.map(r => r.id))
      q = client === null ? q.is('client_id', null) : q.eq('client_id', client)
      const { data, error } = await q
      if (error) throw error
      checked.push(...validMemberRows(data, subset))
    }
  }
  return [...ordinary, ...checked].filter(r => !operatorDeleted(r.taxonomy) && !internalTestDraft(r.taxonomy))
}

export function homeWeeks(rows: ContentDraft[], now: number): Weeks {
  const days = nextWeekDays(now)
  return Object.fromEntries(SEATS.map(seat => [seat, contentWeek(rows.filter(r => r.client_id === seat || seat === 'ivan' && r.client_id == null), seat, days)])) as Weeks
}

export function useHomeContentWeek(now: number): { content: Record<Seat, Read<ContentWeek>>; refresh: () => void } {
  const key = `home-next-week:${nextWeekDays(now)[0].key}`
  const [seed] = useState(() => readSwr<Weeks>(key))
  const [weeks, setWeeks] = useState<Weeks | null>(() => seed && Date.now() - Date.parse(seed.savedAt) < 30 * 60_000 ? seed.payload : null)
  const lastWeeks = useRef(weeks)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const generation = useRef(0)
  const topic = `home-week:${useId()}`
  const refresh = useCallback(() => setVersion(v => v + 1), [])
  // Keep the guarded member invalidation feed active while Home is open.
  useBrainMembers([], () => {}, () => {}, 'home-week')

  useEffect(() => {
    let live = true
    const request = ++generation.current
    setLoading(true)
    void withTimeout(fetchHomeWeekRows(now)).then(rows => {
      if (!live || request !== generation.current) return
      const next = homeWeeks(rows, now)
      if (SEATS.every(seat => next[seat].n === 0) && lastWeeks.current && SEATS.some(seat => lastWeeks.current![seat].n > 0)) {
        setError('The refresh returned no posts over a saved week that held posts.')
        return
      }
      lastWeeks.current = next
      setWeeks(next)
      setError(null)
      // A member's release must be revalidated on every mount, never saved as a durable count or stub.
      writeSwr(key, homeWeeks(rows.filter(r => r.cb34_p2_member !== true), now))
    }).catch(e => { if (live && request === generation.current) setError(e instanceof Error ? e.message : 'next week could not be read') })
      .finally(() => { if (live && request === generation.current) setLoading(false) })
    return () => { live = false }
  }, [now, key, version])

  useEffect(() => {
    const onFocus = () => refresh()
    const ch = supabase.channel(topic).on('postgres_changes', { event: '*', schema: 'public', table: 'carousel_drafts' }, onFocus).subscribe()
    window.addEventListener('focus', onFocus)
    window.addEventListener(BRAIN_INVALIDATED, onFocus)
    return () => { void supabase.removeChannel(ch); window.removeEventListener('focus', onFocus); window.removeEventListener(BRAIN_INVALIDATED, onFocus) }
  }, [refresh, topic])

  const content = Object.fromEntries(SEATS.map(seat => [seat, error && !weeks ? { fail: error }
    : weeks ? { v: weeks[seat], ...(error ? { stale: error } : {}) }
      : loading ? { wait: true } : { fail: 'next week could not be read' }])) as Record<Seat, Read<ContentWeek>>
  return { content, refresh }
}
