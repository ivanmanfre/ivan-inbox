import { internalHoldSummary, isReplyRetryPending, offersReplyMyself, restoreDraft, REPLY_MYSELF, type DiscardMode } from '../../lib/inbox'
/* ==========================================================================
   src/wb/dms/InboxList.tsx — S02 / S33: the conversation list.

   Rebuilt from src/screens/InboxScreen.tsx. The windowing, the pull-to-refresh,
   the whole-lane search, the status axis, the row-level discard with its
   confirm, the command layer's row registration and every string are the ones
   that were there. What changed is the view: the list is a data table read as a
   run of dense hairline rows inside one Group, the age is mono and right
   aligned, and the row's own controls live in the row and appear on hover or
   focus instead of sitting on it all day.

   THE ROW HEIGHT IS LOAD-BEARING. `useRowWindow` maps a scroll offset onto a
   fixed ROW_H, so the row box is pinned to that same constant from JS — one
   number, used by the arithmetic and by the box, so the two cannot drift.
   ========================================================================== */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type HoldAction = { label: string; icon: IconName; run: () => void }
import { Banner, Button, Chip, PopoverItem, Sheet, type IconName, DayHeader, EmptyState, FilterTokens, IconButton, Input } from '../../ds'
import { Body, Group, Head, Bar, Row, Rows, Screen } from '../kit'
import { Face, PullMark, Pill, timeAgo } from './parts'
import { InboxSkeleton } from '../chrome/Skeleton'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { returnsIn } from '../../lib/pushLater'
import { useConfirm } from '../chrome/ConfirmSheet'
import { browseOrder, discardLegs, draftLegs, legFailureText, filterByStatus, filterThreads, inboxWaitingCount, isLeadMagnet, searchThreads, threadKind, type Filter, type Status, type Thread, eventTime } from '../../lib/inbox'
import { DM_FIELDS, applyThreadTokens, hasStatusToken, tokensForFilter, type FilterToken } from '../../lib/filterTokens'
import { checkedPhrase } from '../../lib/today'
import { clientBadge, copyRouteTag, threadLaneLabel } from '../../lib/labels'
import { RowSelect } from '../../exp/v2c/RowSelect'
import './dms.css'

// ---- windowed list (opt-in) ----
//
// fetchMessages pages up to 20,000 rows and groupThreads renders every one of
// them: the live inbox is ~1,354 rows and nine of them are ever visible. Rows
// are a fixed 73px, so a scroll offset maps straight to an index; the unrendered
// remainder is held open by two spacer divs so the scrollbar and every scroll
// position stay honest. Opt-in via `windowed`.
// ONE constant per width, read once and re-read when the width changes: on the
// phone the row carries the same parts on two lines (the trailing values do not
// fit beside a readable name at 390), so the number the arithmetic uses and the
// number the box is pinned to are the phone's own. Nothing else changes: a row
// is still a fixed height, and it is still the same height in both places.
const ROW_H_DESKTOP = 73
const ROW_H_PHONE = 96
// GRAFT B-1 (DECISIONS D16): the desktop list is cut into day groups, each with
// its own count on the right. THE SAME NUMBER lives in dms.css as the header
// host's height. Move one and move the other or the window drifts.
const DAY_H = 32
const PHONE_MQ = '(max-width: 767px)'
const OVERSCAN = 6

function useRowH() {
  const read = () => (typeof window !== 'undefined' && window.matchMedia(PHONE_MQ).matches
    ? ROW_H_PHONE : ROW_H_DESKTOP)
  const [h, setH] = useState(read)
  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ)
    const on = () => setH(mq.matches ? ROW_H_PHONE : ROW_H_DESKTOP)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return h
}

/* E3 · THE CANVAS THE HOVER VERB IS FOR. Not "not the phone": a hover verb on
   a touch device is a control that is either always on (the `hover:none` rule
   in wb.css paints the inline actions at rest) or unreachable. This asks the
   two questions that actually decide it -- is there a pointer that can hover,
   and is the list wide enough to spend a tail on a verb -- and it is the SAME
   condition the sheet uses, spelled once in each language. */
const DESKTOP_HOVER_MQ = '(hover:hover) and (pointer:fine) and (min-width:768px)'

function useDesktopHover(): boolean {
  const [on, setOn] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(DESKTOP_HOVER_MQ).matches)
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_HOVER_MQ)
    const fn = (e: MediaQueryListEvent) => setOn(e.matches)
    setOn(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return on
}

/** The phone, as a boolean. The day groups are a desktop move. */
export function usePhone(): boolean {
  const [on, setOn] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(PHONE_MQ).matches)
  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ)
    const fn = (e: MediaQueryListEvent) => setOn(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return on
}

// The day label the group header prints. Ivan, 2026-09-15: "we should have
// everything properly ordered like today... yesterday... one day less.. and then
// all the rest". Today and yesterday in words, the rest of the week as weekday +
// date so a reader never has to work out which Tuesday, and everything older
// than a week under ONE header - a run of dated headers over month-old rows
// says nothing he acts on. `now` is a parameter so a test can pin the clock.
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return 'Earlier'
}

type Item =
  | { kind: 'day'; key: string; label: string; count: number; section?: boolean }
  | { kind: 'fold'; key: string; label: string; count: number; fold: 'older' | 'auto'; open: boolean }
  | { kind: 'row'; key: string; t: Thread }

/** How far the reader has scrolled INTO the rows: 0 until the rows reach the top of the scroller. */
export function rowsScrollTop(scroller: HTMLElement, anchor: HTMLElement | null): number {
  if (!anchor) return scroller.scrollTop
  return Math.max(0, scroller.getBoundingClientRect().top - anchor.getBoundingClientRect().top)
}

// TWO item shapes now, so the offsets are SUMMED once per render rather than
// divided. With no day headers (the phone) the sum reduces to the multiplication
// it replaced, and the rows are still a fixed height either way.
// `anchor` is a zero-height marker placed where the rows START. The scroller also holds the
// `before` slot (stale and pushed bars, Warm signals, Came back), so the scroller's scrollTop
// overstates how far into the ROWS the reader is by that slot's height. Measured off scrollTop
// alone, a tall slot (Came back, 2026-09-18, ~700px) unmounted the rows still on screen and left
// the grey spacer showing: "scrolling down it blurries gray every chat". The offset is re-read
// on every scroll and after every render, because the slot loads late and collapses.
function useRowWindow(ref: React.RefObject<HTMLDivElement | null>, anchor: React.RefObject<HTMLDivElement | null>, items: Item[], on: boolean, rowH: number) {
  const [top, setTop] = useState(0)
  const [view, setView] = useState(900)
  // The offset the window is cut at, snapped DOWN to two rows. Every scroll event
  // used to set a new pixel offset and re-render the whole list; snapped, the
  // list re-renders once per two rows travelled. Two rows short at the bottom
  // edge is inside the six-row OVERSCAN, so no unrendered row can show.
  const step = rowH * 2
  useEffect(() => {
    const el = ref.current
    if (!el || !on) return
    const onScroll = () => setTop(Math.floor(rowsScrollTop(el, anchor.current) / step) * step)
    const onSize = () => setView(el.clientHeight || 900)
    onSize()
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onSize)
    return () => { el.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onSize) }
  }, [ref, anchor, on, step])
  // The slot above the rows changes height without a scroll event (cards load, a section folds).
  // setTop with an unchanged number is a no-op, so this settles in one pass.
  useEffect(() => {
    const el = ref.current
    if (el && on) setTop(Math.floor(rowsScrollTop(el, anchor.current) / step) * step)
  })
  const itemH = (it: Item) => (it.kind === 'row' ? rowH : DAY_H)
  if (!on) return { start: 0, end: items.length, padTop: 0, padBottom: 0 }
  const offs: number[] = []
  let acc = 0
  for (const it of items) { offs.push(acc); acc += itemH(it) }
  let first = 0
  while (first < items.length && offs[first] + itemH(items[first]) < top) first += 1
  const start = Math.max(0, first - OVERSCAN)
  let last = start
  while (last < items.length && offs[last] < top + view) last += 1
  const end = Math.min(items.length, last + OVERSCAN)
  const padTop = offs[start] ?? 0
  const consumed = end > start ? offs[end - 1] + itemH(items[end - 1]) : padTop
  return { start, end, padTop, padBottom: Math.max(0, acc - consumed) }
}

const CHIPS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
  { key: 'arch', label: 'Arch' },
  { key: 'email', label: 'Email' },
  // Cold pitches the reply detector (or Ivan) filed. Out of every other chip and
  // out of the badge; here so nothing a client's seat received is ever unreachable.
  { key: 'spam', label: 'Likely spam' },
]

// The list holds CONVERSATIONS (send echoes moved to Sends), so an empty lane
// says exactly that instead of implying nothing was ever sent.
const EMPTY: Record<Filter, string> = {
  all: 'No conversations, replies land here, sends live in Sends',
  ivan: 'No Ivan conversations, sends live in Sends',
  risedtc: 'No Rise conversations, sends live in Sends',
  arch: 'No Arch conversations, the reply detector for Davorin’s seat is not armed yet',
  email: 'No email conversations, sends live in Sends',
  spam: 'Nothing filed as likely spam, cold pitches to a client seat land here without a push',
}

// The honest-empty register. "No threads yet" and "the fetch failed" rendered
// the identical sentence on the screen Ivan opens first every morning, and the
// fix is only half a state machine — the other half is saying so in language an
// operator actually trusts. The claim is only made where the HOST has
// established there was no error, which is why `verifiedAt` is a prop and not a
// constant: a screen that cannot see its own fetch must not promise a live read.
// W2-5: pure so it is unit-testable without mounting the list. A screen with
// zero rows on screen is either (a) still waiting on its first fetch, (b) a
// search that found nothing, or (c) a fetch that DID resolve to zero, and
// only (c) is allowed to assert "nothing waiting on you". `verifiedAt === null`
// means the host has not yet established the fetch outcome, so the row
// skeleton renders instead of a claim the app cannot back up.
export function dmsEmptyKind(shownLength: number, query: string, verifiedAt: string | null | undefined): 'none' | 'search' | 'loading' | 'verified' {
  if (shownLength > 0) return 'none'
  if (query) return 'search'
  if (verifiedAt === null) return 'loading'
  return 'verified'
}

function EmptyVerified({ line, verifiedAt }: { line: string; verifiedAt?: string | null }) {
  return (
    <EmptyState
      icon="inbox"
      title={line}
      sub={verifiedAt !== undefined
        ? `${checkedPhrase(verifiedAt)}. This is a live read, not a stall.`
        : undefined}
    />
  )
}

/* R2 · THE VERB UNDER THE THUMB.

   On the phone a pending-draft row's ONLY affordance was `Discard`, a 76x34
   button under the 44px floor — six of eight rows on the live list offered
   destruction and nothing else. A list is not where a draft is destroyed on a
   first tap, and it is certainly not where the only verb is destructive.

   Desktop is untouched: a pointer on a 73px row reaching a hover-revealed
   Discard is the affordance that has always been there and nothing about it is
   under a thumb.

   Pure and exported so the fork is a unit test rather than a screenshot. */
export function rowVerb({ mobile, pendingDraft, preRead }: {
  mobile: boolean
  pendingDraft: boolean
  preRead: boolean
}): 'discard' | 'open' | null {
  if (!pendingDraft) return null
  if (!mobile) return 'discard'
  // The row already offers an affirmative verb (Sum up). It keeps the slot: two
  // 44px pills do not fit the row's one action track at 390, and the row itself
  // is 96px of tap target that opens the thread.
  return preRead ? null : 'open'
}

/* E3 · THE ROW NAMES ITS ONE VERB (isaiahbjork/leads-data-table).

   The move: a row is quiet until it is pointed at, and the row under the
   pointer swaps its right-hand metadata for the ONE thing that row is for. Here
   the metadata is the age, the unread dot and the DRAFT chip, and the verb is
   the affirmative action this row kind already offers -- nothing new is
   introduced except the word `Open` on a plain conversation, which is what the
   row's own click has always done and has never said.

   WHY IT IS NAMED AND NOT JUST DRAWN: two of the three verbs already render
   (Discard from `rowVerb`, `Sum up` from the host's `rowChip`), so without this
   the tail would have to guess whether a row has a verb worth receding for. It
   answers that in one place, and the sheet recedes the tail only where this
   says there is something to recede FOR.

   🔴 NOTHING HERE SENDS. `discard` stops a draft, `sumup` is a read, `open`
   is a route. There is no branch of this function that can reach an approve,
   and a conversation row's `caps` stay ['discard'] / [] regardless of it. */
export function hoverVerbFor({ desktopHover, pendingDraft, preRead }: {
  desktopHover: boolean
  pendingDraft: boolean
  preRead: boolean
}): 'discard' | 'sumup' | 'open' | null {
  // The phone and every touch canvas keep `rowVerb` exactly as R2 left it.
  if (!desktopHover) return null
  if (pendingDraft) return 'discard'
  // The row already draws `Sum up`; it IS this row's verb, so no second one is
  // added beside it.
  if (preRead) return 'sumup'
  return 'open'
}

// The phone's way back to Discard. Ported from the draft card's own swipe
// (DraftCard.tsx): the same pointer model, the same directional lock, the same
// threshold constant — one gesture, one meaning, in both places a draft can be
// thrown away. LEFT ONLY: the card's right-swipe approves, and approving from
// a list is the one thing this surface may never offer.
//
// It rides the ROW HOST, not a new wrapper, so `RowSelect` and the row stay the
// siblings the command layer registers and the fixed height the window measures
// against is untouched.
const ROW_SWIPE_THRESHOLD = 72

// DMs rebuild: HOLD a row (touch only, 500ms, finger still) for its menu: Sum up, Copy chat,
// Ask Claude. A pointer has the hover verbs instead. The click the lift would fire is swallowed so
// a hold never also opens the thread.
const HOLD_MS = 500
function useHold(onHold: (() => void) | undefined) {
  const timer = useRef<number | null>(null)
  const at = useRef({ x: 0, y: 0 })
  const held = useRef(false)
  const clear = () => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null } }
  useEffect(() => clear, [])
  return {
    down(e: React.PointerEvent) {
      held.current = false
      clear()
      if (!onHold || e.pointerType === 'mouse') return
      at.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(() => {
        timer.current = null
        held.current = true
        navigator.vibrate?.(10)
        onHold()
      }, HOLD_MS)
    },
    move(e: React.PointerEvent) {
      if (timer.current !== null && Math.hypot(e.clientX - at.current.x, e.clientY - at.current.y) > 8) clear()
    },
    up: clear,
    click(e: React.MouseEvent) {
      if (!held.current) return false
      held.current = false
      e.stopPropagation()
      e.preventDefault()
      return true
    },
  }
}

function RowHost({ height, onDiscard, onHold, children }: {
  height: number
  /** Absent on any row with nothing to discard: no gesture is bound at all. */
  onDiscard?: () => void
  onHold?: () => void
  children: ReactNode
}) {
  const hold = useHold(onHold)
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, y: 0 })
  const axis = useRef<'none' | 'x' | 'y'>('none')
  const dxRef = useRef(0)
  // A gesture that travelled sideways must not also open the thread. The click
  // is swallowed in the CAPTURE phase, before the row's own handler sees it.
  //
  // R2b · IT IS CLEARED AT POINTERDOWN, NOT AT POINTERUP. Clearing it when the
  // gesture ends would be too early — the click this flag exists to swallow is
  // dispatched AFTER pointerup, on the same gesture. Clearing it only in the
  // click handler was too late: a drag that locked sideways and then died under
  // the threshold fires no click at all, so the flag survived and ate the NEXT
  // tap on that row. The start of a new gesture is the one moment that is both.
  const swiped = useRef(false)

  if (!onDiscard) {
    return (
      <div
        className="a-dms-rowhost"
        data-hold={onHold ? '' : undefined}
        style={{ height }}
        onPointerDown={hold.down}
        onPointerMove={hold.move}
        onPointerUp={hold.up}
        onPointerCancel={hold.up}
        onClickCapture={e => { hold.click(e) }}
        onContextMenu={onHold ? e => e.preventDefault() : undefined}
      >{children}</div>
    )
  }
  const reset = () => {
    setDragging(false)
    axis.current = 'none'
    dxRef.current = 0
    setDx(0)
  }
  return (
    <div
      className="a-dms-rowhost"
      data-swipe=""
      data-hold={onHold ? '' : undefined}
      onContextMenu={onHold ? e => e.preventDefault() : undefined}
      style={{
        height,
        transform: dx ? `translateX(${dx}px)` : undefined,
        transition: dragging ? 'none' : 'transform var(--ds-dur) var(--ds-ease)',
      }}
      onPointerDown={e => {
        hold.down(e)
        start.current = { x: e.clientX, y: e.clientY }
        axis.current = 'none'
        swiped.current = false
        setDragging(true)
      }}
      onPointerMove={e => {
        hold.move(e)
        if (!dragging) return
        const ddx = e.clientX - start.current.x
        const ddy = e.clientY - start.current.y
        if (axis.current === 'none') {
          if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return
          axis.current = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y'
          if (axis.current === 'x') {
            swiped.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
          }
        }
        if (axis.current !== 'x') return
        // Left only. A rightward drag springs back rather than arming anything.
        dxRef.current = Math.min(0, ddx)
        setDx(dxRef.current)
      }}
      onPointerUp={() => {
        hold.up()
        if (!dragging) return
        const final = axis.current === 'x' ? dxRef.current : 0
        reset()
        if (final < -ROW_SWIPE_THRESHOLD) onDiscard()
      }}
      onPointerCancel={() => { hold.up(); reset() }}
      onClickCapture={e => {
        if (hold.click(e)) return
        if (!swiped.current) return
        swiped.current = false
        e.stopPropagation()
        e.preventDefault()
      }}
    >{children}</div>
  )
}

export function InboxList({ threads, filter, setFilter, tokens, setTokens, refresh, onOpenThread, onOpenDrafts, activeThread = null, windowed = false, head, verifiedAt, refreshing = false, cachedAt = null, error = null, title = 'Inbox', status, browse = false, before, after, rowsFor, renderRow, rowNote, rowChip, rowTag, renderNote, rowHold, emptyLine }: {
  threads: Thread[]
  filter: Filter
  setFilter: (f: Filter) => void
  /* E2 · THE LANE IS A TOKEN SET NOW.
     Supplied together or not at all. Given both, the six lane chips become
     SHORTCUTS that write tokens, the `+` adds any of the nine fields the
     Thread type proves, and `filter` above is DERIVED from the set by the
     host (filterFromTokens) so that WarmSignals, DmHistory, PushedBar and the
     stale bar keep the `Filter` they have always taken. Given neither, this
     list is byte-for-byte the chip bar it was. */
  tokens?: FilterToken[]
  setTokens?: (t: FilterToken[]) => void
  refresh: () => void
  onOpenThread: (id: string) => void
  onOpenDrafts: () => void
  activeThread?: string | null
  // Render only the rows near the viewport.
  windowed?: boolean
  // Optional slot under the filter chips.
  head?: ReactNode
  // Supplied only by a host that has already established the fetch SUCCEEDED, so
  // an empty list can honestly say it was checked. Omitted = no claim made.
  verifiedAt?: string | null
  // N3-1: the rows on screen came off the device and the live read has not
  // landed yet. It drives the affordance below and nothing else, and it is never a
  // freshness claim, which is `verifiedAt`'s job and stays null while this is on.
  refreshing?: boolean
  cachedAt?: string | null
  // N3b-3: the refresh behind the saved copy FAILED. The strip said
  // "refreshing…" for ever after a read that had already died, which is a claim
  // about something in flight that is not in flight. Given one, the strip names
  // the failure and offers the way back instead.
  error?: string | null
  title?: string
  // The status axis (bucket filter). Omitted = no status filtering, and the
  // draft banner keeps its old job of pointing at a separate drafts screen.
  status?: Status
  // Ivan, 2026-09-15: the DMs list was two lists - the pending rows under day
  // headers, then a "DM history" block holding every answered conversation, so
  // the chats from the last day sat below drafts from ten days ago. `browse`
  // renders the WHOLE lane in one recency order (pending rows keep their DRAFT /
  // needs-reply chips), day headers on the phone too. Search, the spam folder
  // and an explicit status token still win, exactly as before.
  browse?: boolean
  // Rendered BELOW the list, inside the same scroller: the DM history section
  // lives here so it reads as the tail of the surface rather than a second page.
  after?: ReactNode
  // Slot INSIDE the scroller, above the rows — the DMs surface puts the stale
  // and pushed bars here.
  before?: ReactNode
  // Lets the host see (and act on) the exact set the list is about to render.
  rowsFor?: (shown: Thread[]) => void
  // Replaces the 73px conversation row for the whole list. The DMs surface uses
  // it for the "Draft ready" status, where the row IS the approve/discard card.
  // Windowing is off when it is supplied — the window maps a scroll offset onto
  // a FIXED row height, and a card is not one.
  renderRow?: (t: Thread) => ReactNode
  // Two opt-in slots on the 73px conversation row. They exist as a PAIR because
  // the row's height is load-bearing: nothing may be ADDED to the row's vertical
  // box. `rowNote` therefore REPLACES the message preview on the line it already
  // occupies, and `rowChip` rides the row's inline actions.
  rowNote?: (t: Thread) => string | null
  rowChip?: (t: Thread) => ReactNode
  // A third slot on the same terms. It rides the inline actions beside
  // `rowChip`, revealed by hover or focus, rather than sitting on every row all
  // day: whatever a host draws here must be control-height and must not wrap.
  rowTag?: (t: Thread) => ReactNode
  // The note, drawn by the HOST instead of as plain text — the DMs surface uses
  // it to make the pre-read hoverable, since 140 characters do not fit on one
  // nowrap row and Ivan could not read what he had paid for. The contract on
  // whoever supplies it is the one `rowNote` carries: render ONE line and do not
  // grow the row.
  renderNote?: (t: Thread, note: string) => ReactNode
  // DMs rebuild: what holding a row offers on the phone (Sum up, Copy chat, Ask Claude). The host
  // owns every verb; the list only draws the sheet. Empty = the row has no hold.
  rowHold?: (t: Thread) => HoldAction[]
  emptyLine?: string
}) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const [query, setQuery] = useState('')
  // W2-10: the search field is a permanent 44px band on a list of 17 rows. On
  // the phone it opens from the head instead, so the fold spends those pixels
  // on conversations. The DESKTOP is untouched, which is where `/` lives: the
  // input stays mounted there for CommandLayer's focusSearch to find.
  const [searchOpen, setSearchOpen] = useState(false)
  const confirm = useConfirm()
  // The receipt of a discard made FROM THE LIST, with Bring it back. It stays until he dismisses it,
  // brings it back, or discards another (the newest replaces it).
  const [held, setHeld] = useState<{ t: Thread; actions: HoldAction[] } | null>(null)
  const [receipt, setReceipt] = useState<{ name: string; ids: string[]; mine: boolean } | null>(null)
  const [restoring, setRestoring] = useState(false)
  async function onBringBack() {
    if (!receipt) return
    setRestoring(true)
    try {
      for (const id of receipt.ids) await restoreDraft(id)
      setReceipt(null)
    } catch (e) {
      window.alert(`Could not bring it back: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setRestoring(false); refresh() }
  }
  // Row-level draft actions (preview text + inline discard) are gated on
  // `status` being passed at all, the same opt-in signal the draft banner above
  // already uses.
  const draftRowActions = status !== undefined
  // `e` is null when the SWIPE calls it (R2): there is no click to stop, and the
  // confirm below is the same one the button raises.
  async function onRowDiscard(e: React.MouseEvent | null, t: Thread) {
    e?.stopPropagation()
    if (!t.draft) return
    const pair = t.companionDraft != null
    let mode: DiscardMode = null
    const ok = await confirm({
      title: pair ? 'Discard both drafts?' : 'Discard this draft?',
      message: pair ? 'Neither the LinkedIn message nor the email will be sent.' : 'It will not be sent.',
      confirmText: 'Discard',
      altText: offersReplyMyself(t) ? "Discard, I'll reply myself" : undefined,
      onAlt: () => { mode = REPLY_MYSELF },
      danger: true,
    })
    if (!ok) return
    // Every leg, and a leg that would not stop is said out loud: the row and
    // the swipe used to discard the DM alone and leave the email pending.
    try {
      const legs = draftLegs(t)
      const failed = await discardLegs(legs, mode)
      if (failed.length) window.alert(failed.map(legFailureText).join(' '))
      // The receipt: the list is where the draft disappeared, so Bring it back lives here too.
      const stopped = legs.filter((l): l is NonNullable<typeof l> => l != null && !failed.some(f => f.leg.id === l.id))
      if (stopped.length) setReceipt({ name: t.prospect_name, ids: stopped.map(l => l.id), mine: mode === REPLY_MYSELF })
    } finally { refresh() }
  }
  const tokenMode = tokens !== undefined && setTokens !== undefined
  // SCROLL JANK (feel pass, 2026-09-25): the row window re-renders this list on
  // scroll, and every one of those renders re-filtered, re-sorted and re-dated
  // all ~1,350 threads (a dayLabel `toLocaleDateString` per row). 11 of 155
  // frames went over 50ms at 4x CPU. The derivations below depend on the
  // question, never on the scroll offset, so they are memoised on the question.
  const laned = useMemo(
    () => (tokenMode ? applyThreadTokens(threads, tokens) : filterThreads(threads, filter)),
    [tokenMode, threads, tokens, filter],
  )
  // A SEARCH reaches the whole lane; the LIST does not. The browsable list is
  // what is waiting on him, while typing a name still finds a conversation where
  // the ball is with them. Cutting those rows from search too would turn "I
  // don't need to browse these" into "I can never look one up".
  // The spam folder is read whole: its rows are closed and owe nothing, so a
  // status axis would empty it.
  // A `status` TOKEN is the authority on that axis: applyThreadTokens has
  // already run filterByStatus with the value he picked, and intersecting it
  // with the surface's own default ('needs', frozen since 2026-08-04) would
  // empty every view but that one.
  const statusToken = tokenMode && hasStatusToken(tokens)
  const sectioned = !query && browse && filter !== 'spam' && !statusToken
  const ordered = useMemo(() => browseOrder(laned), [laned])
  // DMs rebuild: two folds under "Sent, waiting on them", both closed on open. Owed past 14 days
  // (the badge already dropped them; they used to be filed as waiting on THEM) and auto-replies.
  const [folds, setFolds] = useState<{ older: boolean; auto: boolean }>({ older: false, auto: false })
  const shown = useMemo(() => (query
    ? searchThreads(laned, query)
    : sectioned
      // Conversations only (someone answered, a draft is waiting, a magnet went
      // out): the lane also holds every invite that never got a reply, and those
      // are not chats. Newest activity first, drafts dated by their own clock.
      ? [...ordered.pending, ...ordered.rest, ...(folds.older ? ordered.older : []), ...(folds.auto ? ordered.auto : [])]
      : (status && filter !== 'spam' && !statusToken ? filterByStatus(laned, status) : laned)),
  [query, laned, sectioned, ordered, status, filter, statusToken, folds])
  const rowH = useRowH()
  const phone = usePhone()
  const desktopHover = useDesktopHover()
  // GRAFT B-1: the run of rows becomes a run of day groups on the desktop, each
  // header carrying how many conversations landed that day. The phone keeps the
  // flat run: at 390 the row already spends two lines on the same parts and a
  // third band of chrome every few rows costs more than it says.
  const items = useMemo(() => {
    const items: Item[] = []
    let lastDay: string | null = null
    let head: Extract<Item, { kind: 'day' }> | null = null
    if (sectioned) {
      const blocks: ['pending' | 'rest' | 'older' | 'auto', Thread[]][] = [
        ['pending', ordered.pending], ['rest', ordered.rest], ['older', ordered.older], ['auto', ordered.auto],
      ]
      for (const [s, list] of blocks) {
        if (!list.length) continue
        if (s === 'older' || s === 'auto') {
          items.push({
            kind: 'fold', key: `fold-${s}`, fold: s, open: folds[s], count: list.length,
            label: s === 'older' ? 'Older than two weeks' : 'Auto-replies',
          })
          if (!folds[s]) continue
        } else {
          items.push({
            kind: 'day', section: true, key: `section-${s}`,
            label: s === 'pending' ? 'Needs your reply' : 'Sent, waiting on them', count: list.length,
          })
        }
        lastDay = null
        head = null
        for (const t of list) {
          if ((!phone || browse) && s !== 'pending') {
            const d = dayLabel(eventTime(t.last))
            if (d !== lastDay) {
              lastDay = d
              head = { kind: 'day', key: `day-${s}-${d}-${t.prospect_id}`, label: d, count: 0 }
              items.push(head)
            }
            if (head) head.count += 1
          }
          items.push({ kind: 'row', key: t.prospect_id, t })
        }
      }
      return items
    }
    const pendingIds = new Set(ordered.pending.map(t => t.prospect_id))
    let section: 'pending' | 'rest' | null = null
    for (const t of shown) {
      // Two blocks, each under its own header: what owes him a reply, then the
      // rest. The pending block carries no day headers - the row already shows
      // its age and the block is short; the rest keeps them.
      if (sectioned) {
        const s = pendingIds.has(t.prospect_id) ? 'pending' : 'rest'
        if (s !== section) {
          section = s
          lastDay = null
          head = null
          items.push({
            kind: 'day', section: true, key: `section-${s}`,
            label: s === 'pending' ? 'Needs your reply' : 'Sent, waiting on them',
            count: s === 'pending' ? ordered.pending.length : ordered.rest.length,
          })
        }
      }
      if ((!phone || browse) && section !== 'pending') {
        const d = dayLabel(eventTime(t.last))
        if (d !== lastDay) {
          lastDay = d
          head = { kind: 'day', key: `day-${d}-${t.prospect_id}`, label: d, count: 0 }
          items.push(head)
        }
        if (head) head.count += 1
      }
      items.push({ kind: 'row', key: t.prospect_id, t })
    }
    return items
  }, [shown, sectioned, ordered, phone, browse, folds])
  const rowsAnchor = useRef<HTMLDivElement>(null)
  const win = useRowWindow(rowsRef, rowsAnchor, items, windowed && !renderRow, rowH)
  const { draftTotal, waitingTotal, spamTotal } = useMemo(() => ({
    draftTotal: threads.filter(t => t.draft && t.draftSnoozedUntil === null).length,
    // Same derivation as the tab badge (lib/inbox.ts) — the chip suffix and the
    // bubble must never say two different numbers for the same list.
    waitingTotal: inboxWaitingCount(threads),
    spamTotal: filterThreads(threads, 'spam').length,
  }), [threads])
  rowsFor?.(shown)

  return (
    <Screen className="a-dms">
      <Head
        title={title}
        // N2b-1: this head carries the phone chrome's tiles now, so the phone
        // opens on ONE 56px row instead of two. The `IM` face goes with it on
        // the phone: it is `role="img"` with no handler, and the Settings tile
        // that arrives beside it is the real route into the account.
        chrome
        tail={<>
          {phone && (
            <IconButton
              icon="search"
              label="Search people or messages"
              onClick={() => setSearchOpen(v => !v)}
            />
          )}
          {!phone && <Face name="IM" size="sm" />}
        </>}
      />
      {(!phone || searchOpen || query) && (
      <Bar>
        <Input
          label="Search people or messages"
          labelHidden
          icon="search"
          // `type=search` is what the `/` key finds. CommandLayer's focusSearch
          // looks for a search input inside the working region, and a text
          // input that only LOOKS like one leaves the surface with no `/`.
          type="search"
          className="a-grow"
          placeholder="Search people or messages"
          value={query}
          onChange={e => setQuery(e.target.value)}
          tail={query
            ? <IconButton icon="clear" label="Clear" size="sm" onClick={() => setQuery('')} />
            : undefined}
        />
      </Bar>
      )}
      <Bar>
        {CHIPS.map(c => (
          <Chip
            key={c.key}
            selected={filter === c.key}
            // E2: in token mode the chip WRITES the token set it stands for
            // (`Arch` → `lane is Arch`, `Likely spam` → `spam is yes`, `All` →
            // nothing at all) and the lane it selects is unchanged — the same
            // rows, reached by a control that can now say more than six things.
            onClick={() => (tokenMode ? setTokens!(tokensForFilter(c.key)) : setFilter(c.key))}
            // tabs-07: the count appears only when there is one to show.
            count={c.key === 'all' && waitingTotal > 0 ? waitingTotal
              : c.key === 'spam' && spamTotal > 0 ? spamTotal : undefined}
          >{c.label}</Chip>
        ))}
        {tokenMode && (
          <FilterTokens
            fields={DM_FIELDS}
            tokens={tokens}
            setTokens={setTokens!}
            surfaceLabel="DMs"
          />
        )}
      </Bar>

      {head}

      {held && createPortal(
        <Sheet open onClose={() => setHeld(null)} title={held.t.prospect_name} sub={held.t.prospect_company ?? undefined} className="a-dms-holdsheet">
          <div role="menu" aria-label={`Actions for ${held.t.prospect_name}`}>
            {held.actions.map(a => (
              <PopoverItem key={a.label} icon={a.icon} onClick={() => { setHeld(null); a.run() }}>{a.label}</PopoverItem>
            ))}
          </div>
        </Sheet>,
        document.body,
      )}
      {receipt && (
        <Banner
          icon="discard"
          className="a-dms-receipt"
          title={`Discarded the draft to ${receipt.name.split(' ')[0]}.`}
          action={<Button variant="quiet" size="sm" icon="undo" busy={restoring} onClick={restoring ? undefined : onBringBack}>Bring it back</Button>}
          onDismiss={() => setReceipt(null)}
        >{receipt.mine ? 'Still under Needs your reply, for your own answer.' : undefined}</Banner>
      )}
      <Body innerRef={rowsRef} className="a-dms-body">
        <PullMark pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {/* With a status axis present, "drafts" is one of the statuses, a banner
            pointing at a separate screen would be pointing at this one. */}
        {status === undefined && draftTotal > 0 && (
          <Banner
            icon="wand"
            title={`${draftTotal} draft${draftTotal === 1 ? '' : 's'} waiting for you`}
            action={<Button variant="quiet" iconEnd="forward" onClick={onOpenDrafts}>Clear them in one pass</Button>}
          />
        )}
        {/* N3-1: what a person sees while the saved copy is on screen. The rows
            are real and they are old, and this says both without pretending the
            screen has been checked (dmsEmptyKind still reads `verifiedAt`, which
            is null until the live read resolves). */}
        {(refreshing || error) && (
          <div className={`a-dms-refresh${error ? ' bad' : ''}`} role="status">
            {!error && <span className="a-dms-refresh-dot" aria-hidden />}
            {error ? (
              <>
                <span>Couldn’t refresh, showing the saved copy{cachedAt && timeAgo(cachedAt) !== 'now' ? ` from ${timeAgo(cachedAt)} ago` : ''}</span>
                <Button variant="quiet" size="sm" icon="refresh" onClick={refresh}>Retry</Button>
              </>
            ) : (
              /* "now" is timeAgo's under-a-minute answer and "Saved copy from
                 now" reads as nonsense, so the age is named only when there is
                 an age worth naming. */
              <span>Saved copy{cachedAt && timeAgo(cachedAt) !== 'now' ? ` from ${timeAgo(cachedAt)} ago` : ''}, refreshing…</span>
            )}
          </div>
        )}
        {before}
        {(() => {
          const kind = dmsEmptyKind(shown.length, query, verifiedAt)
          if (kind === 'search') return <EmptyState icon="search" title={`No matches for “${query}”`} />
          if (kind === 'loading') return <InboxSkeleton />
          if (kind === 'verified') return <EmptyVerified line={emptyLine ?? EMPTY[filter]} verifiedAt={verifiedAt} />
          return null
        })()}
        <div ref={rowsAnchor} aria-hidden />
        {shown.length > 0 && (renderRow ? (
          <div className="a-stack">{shown.map(t => renderRow(t))}</div>
        ) : (
          <Group>
            <Rows>
              {win.padTop > 0 && <div style={{ height: win.padTop }} aria-hidden />}
              {items.slice(win.start, win.end).map(it => {
                if (it.kind === 'day') {
                  return (
                    <div key={it.key} className="a-dms-dayhost" data-section={it.section ? '1' : undefined} style={{ height: DAY_H }}>
                      <DayHeader sticky={false} label={it.label} tail={it.count} />
                    </div>
                  )
                }
                if (it.kind === 'fold') {
                  const f = it.fold
                  return (
                    <div key={it.key} className="a-dms-dayhost" data-section="1" style={{ height: DAY_H }}>
                      <button
                        type="button"
                        className="wb-dms-fold"
                        aria-expanded={it.open}
                        onClick={() => setFolds(o => ({ ...o, [f]: !o[f] }))}
                      >
                        <DayHeader sticky={false} label={it.label} tail={it.open ? `${it.count} · Hide` : `${it.count} · Show`} />
                      </button>
                    </div>
                  )
                }
                const t = it.t
                const isDraftLast = t.draft != null && t.last.id === t.draft.id
                // Discard costs 3 interactions per draft today (open the thread,
                // find the card, discard) because the list shows a DRAFT pill and
                // nothing else: the draft text itself only lives inside the
                // thread. 45% of discards happen in runs of 2-6 rows, the
                // signature of clearing a list by hand, so the row carries the
                // draft's own text whenever one is pending.
                const pendingDraft = draftRowActions && t.draft != null && t.draftSnoozedUntil === null
                  ? t.draft : null
                const laneTag = threadLaneLabel(t.lane, t.campaignLane)
                const route = copyRouteTag(t.copyRoute)
                const hold = t.ownerConfirmation
                  ? (isReplyRetryPending(t.ownerConfirmation) ? 'Retry' : 'Owner question') : null
                let snip = t.last.message_text
                if (t.ownerConfirmation) {
                  snip = isReplyRetryPending(t.ownerConfirmation)
                    ? internalHoldSummary(t.ownerConfirmation)
                    : (t.ownerConfirmation.context_gap?.question || internalHoldSummary(t.ownerConfirmation))
                }
                else if (pendingDraft) snip = pendingDraft.message_text
                else if (isDraftLast) snip = `Draft: ${t.last.message_text}`
                else if (t.last.direction === 'outbound' && t.last.sent_at) snip = `You: ${t.last.message_text}`
                const note = rowNote?.(t) ?? null
                const kind = threadKind(t)
                const chip = rowChip?.(t)
                const tag = rowTag?.(t)
                // R2: which verb this row shows, and where Discard went on the
                // phone (a left swipe on the row, same gesture as the card).
                const verb = rowVerb({ mobile: phone, pendingDraft: pendingDraft != null, preRead: chip != null })
                // E3: which verb this row shows UNDER A POINTER, and whether
                // the tail has something to recede for. `discard` and `sumup`
                // already render (above, and as the host's chip); only `open`
                // is drawn here, and only in the tail's own overlay.
                const hover = hoverVerbFor({
                  desktopHover, pendingDraft: pendingDraft != null, preRead: chip != null,
                })
                return (
                  /* THE HOST ELEMENT is what the command layer walks. RowSelect
                     writes `data-wbrow`, `data-wbsel` and `data-wbfocus` onto its
                     own parent, so the mark and the row it registers have to be
                     siblings inside one box — and that box is what carries the
                     fixed height the window measures against. */
                  <RowHost
                    key={t.prospect_id}
                    height={rowH}
                    onDiscard={phone && pendingDraft ? () => { void onRowDiscard(null, t) } : undefined}
                    onHold={phone && rowHold ? () => {
                      const actions = rowHold(t)
                      if (actions.length) setHeld({ t, actions })
                    } : undefined}
                  >
                    {/* A conversation carries NO bulk capability — an answer is
                        written one at a time, and the bulk bar says that in words
                        rather than offering a button that would refuse. A row with
                        a pending draft is the one exception: discarding sends
                        nothing, so it is the one thing this row may still do in
                        bulk (the caller passes the draft's own id, not the
                        thread's, so a bulk run discards the right row). */}
                    <RowSelect
                      id={pendingDraft ? pendingDraft.id : t.prospect_id}
                      kind="thread"
                      label={t.prospect_name}
                      caps={pendingDraft ? ['discard'] : []}
                      lane={t.client_id}
                      pairId={pendingDraft ? t.companionDraft?.id : undefined}
                    />
                    <Row
                      className={hover ? 'r a-dms-hasverb' : 'r'}
                      onClick={() => onOpenThread(t.prospect_id)}
                      unread={t.unread > 0}
                      selected={activeThread === t.prospect_id}
                      lead={<Face name={t.prospect_name} />}
                      title={
                        <span className="a-dms-titleline">
                          <span className="a-nowrap">{t.prospect_name}</span>
                          <Pill>{clientBadge(t.client_id)}</Pill>
                          {/* The campaign lane and copy route moved into the opened
                              thread's own header (Ivan, 2026-09-24: "put them not in
                              the preview on the left like they are now... inside each
                              dm... when i click on the dm to open it"). See
                              Conversation.tsx. */}
                          {kind === 'inmail' && <Pill>INMAIL</Pill>}
                          {kind === 'email' && <Pill>EMAIL</Pill>}
                          {kind === 'linkedin' && <Pill>DM</Pill>}
                          {isLeadMagnet(t) && <Pill>LEAD MAGNET</Pill>}
                        </span>
                      }
                      /* The pre-read, when one has been asked for, stands IN
                         PLACE of the preview rather than under it: the row height
                         is what the list's windowing measures against. The
                         pending-draft prefix is the no-note branch — a row that
                         was summed up shows the summary, not a draft marker
                         twice. */
                      /* W2-2: the lane badge rides the SECOND line on the
                         phone. On the title line it collapsed to 0x0 (the name
                         is floored and the pills were what gave way), and a
                         three-tenant inbox has to say whose row this is. Here
                         it costs the name nothing. */
                      sub={<>
                        {/* DMs rebuild (blueprint v3 decision 3): the lane is back on
                            every row, reversing the 24 Sep move into the thread
                            header, because Ivan asked for it on 26 Sep ("every DM
                            row must show the lane"). Seat (phone and the 420
                            column only; the wide row has it on line 1), lane, the
                            ARCH copy route, and one hold chip. */}
                        <span className="a-dms-lane">
                          <span className="a-dms-seat"><Pill>{clientBadge(t.client_id)}</Pill></span>
                          {laneTag && <Pill>{laneTag}</Pill>}
                          {route && <span className="a-dms-route" title={route.title}><Pill>{route.label}</Pill></span>}
                          {hold && <Pill>{hold}</Pill>}
                        </span>
                        <span className="a-dms-subtext">{note && renderNote
                          ? renderNote(t, note)
                          : (note ?? (pendingDraft ? `Draft: ${snip}` : snip))}</span>
                      </>}
                      tail={<>
                        <span className="a-mono">{timeAgo(eventTime(t.last))}</span>
                        {/* A pushed draft says WHEN, not DRAFT — the row is the
                            only place a parked draft is visible from the list, so
                            it has to carry its return date rather than look like
                            queued work. */}
                        {t.draft != null && (t.draftSnoozedUntil !== null
                          ? <Chip icon="time">{returnsIn(t.draftSnoozedUntil)}</Chip>
                          /* W2-9: named so the phone can drop it where the
                             inline Discard is painting over it. The wrapper is
                             `display:contents` everywhere else. */
                          : <span className="a-dms-draftchip"><Chip icon="wand">Draft</Chip></span>)}
                        {/* E3 · THE VERB, IN THE METADATA'S OWN PLACE. It is
                            absolutely positioned over the tail (the sheet), so
                            it costs the row NOTHING at rest: the resting flex
                            line, the 73px box the window measures against and
                            the 420px list column's tuning are all untouched,
                            and no `.ds-btn` is added to `.a-row-actions`, which
                            three shipped rules key the DRAFT chip and the phone
                            action track off. Drawn only where there is a
                            pointer to reveal it. */}
                        {hover === 'open' && (
                          <span className="a-dms-verb">
                            <Button
                              variant="quiet"
                              size="sm"
                              onClick={e => { e.stopPropagation(); onOpenThread(t.prospect_id) }}
                            >Open</Button>
                          </span>
                        )}
                      </>}
                      /* In the row, on hover or focus. Approve is deliberately
                         NOT here: approving a DM sends it to a real person, and
                         the trip into the thread is what puts the draft in front
                         of him before it goes. Discard sends nothing, so it is
                         safe to run from the list the same way the stale-draft
                         bar already does. */
                      actions={(chip || tag || pendingDraft) ? <>
                        {chip}
                        {/* The copy link steps aside under 768px, where the
                            shipped sheet already hid it (styles.css: `.r
                            .rowlink`): this row is windowed against a constant
                            height, so on the phone the width goes to the name
                            and the newest message instead. */}
                        <span className="a-dms-tagact">{tag}</span>
                        {/* R2: the destructive verb is the DESKTOP's, where a
                            hover reveals it under a pointer. On the phone the
                            row's one pill is the affirmative one, and Discard is
                            the left swipe (RowHost above), which is the same
                            gesture the draft card already carries. */}
                        {verb === 'discard' && (
                          <Button variant="quiet" size="sm" onClick={e => onRowDiscard(e, t)}>
                            Discard
                          </Button>
                        )}
                        {verb === 'open' && (
                          <Button
                            variant="quiet"
                            size="sm"
                            onClick={e => { e.stopPropagation(); onOpenThread(t.prospect_id) }}
                          >Open</Button>
                        )}
                      </> : undefined}
                    />
                  </RowHost>
                )
              })}
              {win.padBottom > 0 && <div style={{ height: win.padBottom }} aria-hidden />}
            </Rows>
          </Group>
        ))}
        {after}
      </Body>
    </Screen>
  )
}
