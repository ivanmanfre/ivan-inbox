import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { operatorDeleted, type ContentDraftDetail } from '../lib/content'

export type BrainMember = { id: string; client_id: string | null; cb34_p2_member?: boolean }
export type BrainInvalidation = { client: 'ivan' | 'risedtc' | 'arch'; draftId: string }
export const BRAIN_INVALIDATED = 'brain-members-invalidated'
type Watch = { rows: () => BrainMember[]; clear: () => void; fresh: (rows: ContentDraftDetail[], checkedIds: string[]) => boolean | void; revision: number; checked: string | null; hidden: boolean; pending: BrainMember[]; failed: () => void; blocked: () => boolean }
const watches = new Set<Watch>()
let busy = false
let activeRequest: AbortController | null = null
let revision = 0
let stopBridge: (() => void) | null = null

/** Only returned safe-view members in the exact requested tenant/id subset are usable. */
export function validMemberRows(rows: unknown, requested: BrainMember[]): ContentDraftDetail[] {
  if (!Array.isArray(rows)) throw new Error('member recheck returned invalid rows')
  const expected = new Map(requested.map(r => [r.id, r.client_id]))
  if (new Set(rows.map(r => r?.id)).size !== rows.length) throw new Error('duplicate member recheck row')
  if (rows.some(r => !r || r.cb34_p2_member !== true || !expected.has(r.id) || expected.get(r.id) !== r.client_id || typeof r.post_body !== 'string' || !r.qa || typeof r.qa !== 'object')) throw new Error('member recheck scope or validation mismatch')
  return rows.map(r => ({ ...r, qa_verdict: r.qa.verdict ?? null, qa_score: r.qa.score ?? null, qa_regen: r.qa.qa_regen_attempts ?? null, qa_backfilled: r.qa.backfilled ?? null })) as ContentDraftDetail[]
}

async function revalidate() {
  if (busy || String(document.visibilityState) === 'hidden') return
  const pending = [...watches].filter(w => !w.blocked() || w.rows().some(r => r.cb34_p2_member === true)).map(w => ({ w, rows: [...new Map([...w.pending, ...w.rows().filter(r => r.cb34_p2_member === true)].map(r => [r.id, r])).values()], background: !w.hidden, shown: w.rows().filter(r => r.cb34_p2_member === true), token: ++w.revision })).filter(x => x.rows.length)
  if (!pending.length) return
  busy = true
  const run = ++revision
  // Routine checks keep the last verified cards visible while the request runs.
  // Explicit visibility/auth invalidations still clear immediately.
  pending.forEach(({ w, rows, background }) => { w.pending = rows; if (!background) w.clear() })
  try {
    const unique = [...new Map(pending.flatMap(p => p.rows).map(r => [r.id, r])).values()]
    const fresh: ContentDraftDetail[] = []
    // Serial bounded SDK reads, never a full ordinary list or a private member table.
    for (const client of [null, 'ivan', 'risedtc', 'arch']) {
      const mine = unique.filter(r => r.client_id === client)
      for (let i = 0; i < mine.length; i += 50) {
        const subset = mine.slice(i, i + 50)
        let q = supabase.from('cb34_p2_safe_drafts').select('*').in('id', subset.map(r => r.id))
        q = client === null ? q.is('client_id', null) : q.eq('client_id', client)
        const controller = new AbortController()
        activeRequest = controller
        const deadline = window.setTimeout(() => controller.abort(), 20000)
        try {
          const { data, error } = await q.abortSignal(controller.signal)
          if (error) throw error
          if (run !== revision) return
          fresh.push(...validMemberRows(data, subset))
        } finally { window.clearTimeout(deadline); if (activeRequest === controller) activeRequest = null }
      }
    }
    if (run !== revision || String(document.visibilityState) === 'hidden') return
    pending.forEach(({ w, rows, shown, background, token }) => {
      if (!watches.has(w) || token !== w.revision) return
      // A full read that landed meanwhile owns the newer rows.
      const current = w.rows().filter(r => r.cb34_p2_member === true)
      if (background && (current.length !== shown.length || current.some((r, i) => r !== shown[i]))) { w.pending = []; return }
      const ids = new Set(rows.map(r => r.id))
      const mine = fresh.filter(r => ids.has(r.id) && !operatorDeleted(r.taxonomy))
      const checked = JSON.stringify([...mine].sort((a, b) => a.id.localeCompare(b.id)))
      const byId = new Map(mine.map(r => [r.id, r]))
      const sameShown = current.length === mine.length && current.every(r => {
        const freshRow = byId.get(r.id) as Record<string, unknown> | undefined
        return freshRow && Object.entries(r).every(([key, value]) => !(key in freshRow) || JSON.stringify(value) === JSON.stringify(freshRow[key]))
      })
      if (background && w.checked === checked && sameShown) { w.pending = []; return }
      // Clear and restore in the same React batch, only when the answer changed.
      if (background) w.clear()
      const accepted = w.fresh(mine, [...ids])
      w.checked = accepted === false ? null : checked
      w.hidden = accepted === false
      w.pending = accepted === false ? rows : []
    })
  } catch {
    pending.forEach(({ w, rows, shown, background, token }) => {
      if (!watches.has(w) || token !== w.revision) return
      const current = w.rows().filter(r => r.cb34_p2_member === true)
      if (background && (current.length !== shown.length || current.some((r, i) => r !== shown[i]))) { w.pending = []; w.checked = null; return }
      w.pending = rows; w.checked = null; w.hidden = true
      if (background) w.clear()
      w.failed()
    }) // Hidden known IDs retry serially; never restore stale bodies.
  }
  finally { busy = false; if (run !== revision && [...watches].some(w => w.pending.length)) void revalidate() }
}

function invalidate() {
  ++revision
  activeRequest?.abort()
  watches.forEach(w => { ++w.revision; w.checked = null; w.hidden = true; const shown = w.rows().filter(r => r.cb34_p2_member === true); if (shown.length) w.pending = shown; if (w.pending.length) w.clear() })
}

function bridge() {
  let channel: ReturnType<typeof supabase.channel> | null = null
  let live = true
  const onExternal = () => { invalidate(); void revalidate() }
  // Only the WINDOW regaining focus counts. With capture on, every button's own focus (Chrome focuses a button on
  // mousedown) used to land here too, hide the brain cards mid-click and swallow the click (run 39 harness probe).
  const onFocus = (e: FocusEvent) => { if (e.target === window || e.target === document) onExternal() }
  const onVisibility = () => { invalidate(); if (document.visibilityState === 'visible') void revalidate() }
  window.addEventListener('focus', onFocus, true)
  window.addEventListener('wb-rows-changed', onExternal, true)
  document.addEventListener('visibilitychange', onVisibility)
  const timer = window.setInterval(() => { void revalidate() }, 5000)
  // The feed contains only canonical tenant/id metadata; RLS controls authenticated scope.
  let authRevision = 0
  let authenticatedUser: string | null = null
  const bind = (userId: string) => {
    if (!live) return
    authenticatedUser = userId
    if (channel) void supabase.removeChannel(channel)
    channel = supabase.channel(`cb34-members:${userId}`)
    for (const client of ['ivan', 'risedtc', 'arch'] as const) {
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cb34_p2_visibility_events', filter: `client_id=eq.${client}` }, payload => {
        if (!live || authenticatedUser !== userId) return
        const row = payload.new as Record<string, unknown>
        if (row.client_id !== client || !Number.isSafeInteger(Number(row.event_id)) || Number(row.event_id) < 1 || typeof row.draft_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.draft_id)) return
        window.dispatchEvent(new CustomEvent<BrainInvalidation>(BRAIN_INVALIDATED, { detail: { client, draftId: row.draft_id } }))
        window.dispatchEvent(new Event('wb-rows-changed'))
      })
    }
    try { channel.subscribe(status => { if (!live || authenticatedUser !== userId) return; if (status === 'SUBSCRIBED') window.dispatchEvent(new Event('wb-rows-changed')); else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onExternal() }) } catch { onExternal() }
  }
  const initialAuth = authRevision
  void supabase.auth?.getSession().then(({ data }) => { if (initialAuth === authRevision && data.session?.user.id) bind(data.session.user.id) }).catch(() => { /* Serial safe-view fallback remains available. */ })
  const auth = supabase.auth?.onAuthStateChange((_event, session) => {
    ++authRevision; invalidate()
    if ((session?.user.id ?? null) !== authenticatedUser) watches.forEach(w => { w.pending = []; ++w.revision })
    authenticatedUser = session?.user.id ?? null
    if (channel) { void supabase.removeChannel(channel); channel = null }
    if (session?.user.id) bind(session.user.id)
  })

  return () => { live = false; ++revision; activeRequest?.abort(); auth?.data.subscription.unsubscribe(); window.clearInterval(timer); if (channel) void supabase.removeChannel(channel); window.removeEventListener('focus', onFocus, true); window.removeEventListener('wb-rows-changed', onExternal, true); document.removeEventListener('visibilitychange', onVisibility) }
}

/** Shared feed and one serial fallback worker for every on-screen member consumer. */
export function useBrainMembers(rows: BrainMember[], clear: () => void, fresh: (rows: ContentDraftDetail[], checkedIds: string[]) => boolean | void, scope: string, enabled = true, failed: () => void = () => {}, blocked: () => boolean = () => false) {
  const current = useRef({ rows, clear, fresh, scope, enabled, failed, blocked })
  current.current = { rows, clear, fresh, scope, enabled, failed, blocked }
  useEffect(() => {
    if (!enabled) return
    const matches = () => current.current.scope === scope && current.current.enabled
    const watch: Watch = { rows: () => matches() ? current.current.rows : [], clear: () => { if (matches()) current.current.clear() }, fresh: (r, ids) => matches() ? current.current.fresh(r, ids) : undefined, revision: 0, checked: null, hidden: false, pending: [], failed: () => { if (matches()) current.current.failed() }, blocked: () => matches() && current.current.blocked() }
    watches.add(watch)
    if (!stopBridge) stopBridge = bridge()
    return () => { ++watch.revision; watches.delete(watch); if (!watches.size) { stopBridge?.(); stopBridge = null } }
  }, [scope, enabled])
}

export function mergeCheckedMembers<T extends { id: string }>(previous: T[], fresh: T[], checkedIds: string[]): T[] {
  const checked = new Set(checkedIds)
  return [...previous.filter(r => !checked.has(r.id)), ...fresh]
}
