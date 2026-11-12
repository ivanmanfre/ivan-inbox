import { useEffect, useSyncExternalStore } from 'react'
import { readTodayCard, type TodayCard } from '../../../lib/contentCard'
import { heldDecisions, usePendingDecisions } from '../decisions'
import type { DRoute } from '../../route'

// THE DAY'S POST CARD, ONE READ FOR THE WHOLE APP (db/20261112_content_daily_card). The sliding toast (Shell), the
// Content landing, Home and the side panel all read this one store, so they never disagree about whether today's
// card is waiting. It re-reads on open, when the app comes back to the front, when a push lands (the service worker
// posts {type:'push'}, the same trigger the bell's feed uses), after any held decision is written (wb-rows-changed),
// and every 5 minutes while the app is in front (a browser without push still sees the 11:00 card arrive).
// Kept light: the shell imports it, so it must not pull in the Content page's code.

export type CardSnap = { card: TodayCard | null; loaded: boolean; failed: boolean; version: number }
let snap: CardSnap = { card: null, loaded: false, failed: false, version: 0 }
const subs = new Set<() => void>()
let inflight: Promise<void> | null = null
let wired = false
const POLL_MS = 5 * 60_000

function publish(next: CardSnap) { snap = next; for (const l of subs) l() }

/** Re-read today's card. A failed read keeps the last card on screen and says it failed (never "no card"). */
export function refreshTodayCard(): Promise<void> {
  if (inflight) return inflight
  inflight = readTodayCard()
    .then(card => publish({ card, loaded: true, failed: false, version: snap.version + 1 }),
      e => { console.error('[d] post card read failed', e); publish({ ...snap, loaded: true, failed: true, version: snap.version + 1 }) })
    .finally(() => { inflight = null })
  return inflight
}

/** This tab's own change (a skip, its Undo), shown at once; the next read confirms it. */
export function patchTodayCard(card: TodayCard | null): void {
  publish({ ...snap, card, version: snap.version + 1 })
}

function wire() {
  if (wired || typeof window === 'undefined') return
  wired = true
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshTodayCard() })
  navigator.serviceWorker?.addEventListener?.('message', (e: MessageEvent) => {
    if ((e.data as { type?: string } | undefined)?.type === 'push') void refreshTodayCard()
  })
  window.addEventListener('wb-rows-changed', () => { void refreshTodayCard() })
  window.setInterval(() => { if (document.visibilityState === 'visible') void refreshTodayCard() }, POLL_MS)
}

const subscribe = (l: () => void) => { subs.add(l); return () => { subs.delete(l) } }
const read = () => snap

export type LiveCard = TodayCard & { draft: NonNullable<TodayCard['draft']> }
/** Today's card is waiting: still shown, its draft unchanged and still in Review (a Post tap may be holding it). */
export function isWaiting(card: TodayCard | null): card is LiveCard {
  return !!card && card.state === 'shown' && card.live === 'ok' && !!card.draft
}
/** Waiting and not held by a Post tap inside its Undo window: the toast and Home offer it. */
export function isActive(card: TodayCard | null, held: ReadonlyMap<string, unknown> = heldDecisions()): card is LiveCard {
  return isWaiting(card) && !held.has(card.draft.id)
}

export function useTodayCard(): CardSnap & { active: boolean; waiting: boolean } {
  const s = useSyncExternalStore(subscribe, read, read)
  const held = usePendingDecisions()
  useEffect(() => {
    wire()
    if (!snap.loaded && !inflight) void refreshTodayCard()
  }, [])
  return { ...s, active: isActive(s.card, held), waiting: isWaiting(s.card) }
}

/** Content opened from its nav key or the phone's Content key: no sub-page and no link into a post, seat or view. */
export function isContentLanding(r: Pick<DRoute, 'place' | 'sub' | 'query'>): boolean {
  if (r.place !== 'content' || r.sub) return false
  for (const k of ['draft', 'view', 'magnet', 'lane', 'idea', 'focus', 'move']) if (r.query.has(k)) return false
  return true
}

/** Where Content's landing goes: 'card' while today's card waits, 'wait' while its read is still out, null = the page's
 *  own redirect (Plan), as before the card existed. */
export function cardLanding(r: Pick<DRoute, 'place' | 'sub' | 'query'>, loaded: boolean, waiting: boolean): 'card' | 'wait' | null {
  if (!isContentLanding(r)) return null
  if (!loaded) return 'wait'
  return waiting ? 'card' : null
}

/** The card itself fills the page: Content > today, or the Content landing, while the card is waiting. */
export function cardOnScreen(r: Pick<DRoute, 'place' | 'sub' | 'query'>, waiting: boolean): boolean {
  return waiting && r.place === 'content' && (r.sub === 'today' || isContentLanding(r))
}

/** Tests only. */
export function resetTodayCardForTest(next: Partial<CardSnap> = {}): void {
  inflight = null
  snap = { card: null, loaded: false, failed: false, version: 0, ...next }
  for (const l of subs) l()
}
