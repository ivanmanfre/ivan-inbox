import { useEffect, useSyncExternalStore } from 'react'
import { readTodayCard, type TodayCard } from '../../../lib/contentCard'
import { heldDecisions, usePendingDecisions } from '../decisions'
import type { DRoute } from '../../route'

// THE DAY'S POST CARD, ONE READ FOR THE WHOLE APP (db/20261112_content_daily_card). The sliding toast (Shell), the
// Content landing, Home and Ivan's Review list all read this one store, so they never disagree about whether today's
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

/** The card on screen elsewhere (Home's card block, the pick's row in Ivan's Review list): the toast does not slide in
 *  over a screen that already shows the card. */
let blocks = 0
const blockShown = () => blocks > 0
export function useCardBlockMounted(): void {
  useEffect(() => {
    blocks++; for (const l of subs) l()
    return () => { blocks--; for (const l of subs) l() }
  }, [])
}
export function useCardBlockShown(): boolean {
  return useSyncExternalStore(subscribe, blockShown, blockShown)
}

/** Content opened from its nav key or the phone's Content key: no sub-page and no link into a post, seat or view. */
export function isContentLanding(r: Pick<DRoute, 'place' | 'sub' | 'query'>): boolean {
  if (r.place !== 'content' || r.sub) return false
  for (const k of ['draft', 'view', 'magnet', 'lane', 'idea', 'focus', 'move']) if (r.query.has(k)) return false
  return true
}

/** Where Content's landing and the card's address (content/today: the push, old links) go: 'card' while today's card
 *  waits (Ivan's Review list, the pick first and focused), 'wait' while its read is still out, null = the page's own
 *  redirect (the landing goes to Plan; content/today keeps the Plan under the done line), as before the card existed. */
export function cardLanding(r: Pick<DRoute, 'place' | 'sub' | 'query'>, loaded: boolean, waiting: boolean): 'card' | 'wait' | null {
  if (!isContentLanding(r) && !(r.place === 'content' && r.sub === 'today')) return null
  if (!loaded) return 'wait'
  return waiting ? 'card' : null
}

/** A route that lands on the pick (the toast stays out while it is being opened): the landing, content/today, or
 *  Review focused on the pick. */
export function cardRoute(r: Pick<DRoute, 'place' | 'sub' | 'query'>, draftId: string): boolean {
  if (r.place !== 'content') return false
  return r.sub === 'today' || isContentLanding(r) || (r.sub === 'now' && r.query.get('focus') === draftId)
}

/** Tests only. */
export function resetTodayCardForTest(next: Partial<CardSnap> = {}): void {
  inflight = null
  snap = { card: null, loaded: false, failed: false, version: 0, ...next }
  for (const l of subs) l()
}
