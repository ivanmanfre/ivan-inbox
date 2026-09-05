import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Avatar, Badge, Button, Card, Chip, DayHeader, EmptyState, Header, Icon, IconButton,
  Input, Skeleton, ToastStack, rise, spring, type ToastItem,
} from '../../../ds'
import { PullIndicator } from '../../../components/PullIndicator'
import { usePullToRefresh } from '../../../hooks/usePullToRefresh'
import { returnsIn } from '../../../components/PushLaterSheet'
import { useConfirm } from '../../../components/ConfirmSheet'
import {
  discardDraft, filterByStatus, filterThreads, inboxWaitingCount, isLeadMagnet, searchThreads,
  threadBucket, threadKind, STATUS_LABEL,
  type Filter, type Status, type Thread, eventTime,
} from '../../../lib/inbox'
import { checkedPhrase } from '../../../lib/today'
import { clientBadge } from '../../../lib/labels'
import { RowSelect } from '../../../exp/v2c/RowSelect'
import './dms.css'

// Direction B copy of src/screens/InboxScreen.tsx (S02 + S33). Same props, same
// hooks in the same order, same writes, same guards, same strings.
//
// THE ONE MOVE. A conversation is a CARD, not a hairline row: the person is an
// avatar with a live dot, the state is the app's own bucket label as a chip, the
// last message is QUOTED, and the row's one action (discard, on a row carrying a
// pending draft) is inline and revealed on hover or focus, CSS only. The card
// carries a `layoutId`, so on the phone — where the list is unmounted the moment
// a thread takes the screen (layout.ts: `work: 'hidden'`) — tapping it GROWS the
// card into the thread's header (Morphing Dialog, ibelick; Shared Element
// Gallery, jahed). On desktop the list and the peer are on screen together, so
// nothing is shared: two live nodes on one `layoutId` is not a shared element,
// it is a fight.
//
// The card KEEPS the class `r`. Three things find a row by it: the keyboard
// layer's registration (`RowSelect` walks `closest('.ct-card, .r')`), the
// pre-read popover's `avoidEl`, and the screenshot recipe. Direction B repaints
// the row; it does not rename it.

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yday'
  return `${d}d`
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return 'TODAY'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}

// ---- windowed list (opt-in) ----
//
// fetchMessages pages up to 20,000 rows and groupThreads renders every one of
// them: the live inbox is ~1,354 rows and nine rows are ever visible. The build
// contract forbids a virtualization dependency unless it is ~40 lines
// implemented here, and this is those lines.
//
// Direction B changed the arithmetic in exactly one way. The stock list is a
// column of identical 73px rows, so an offset divided by ROW_H IS the index.
// This list has two item shapes — a day header and a card — so the offsets are
// summed once per render instead of divided. Everything else is the original:
// a visible slice, two spacer divs holding the remainder open, and `windowed`
// still opt-in.
// The card is taller on the phone than on the desktop, because at 390 the lane,
// channel and state chips need a second line under the name and at 1440 they do
// not. Read once at module load, the way this app already reads its width: the
// windowing is an optimisation, and a resize across the breakpoint costs a
// scroll position, not correctness.
const PHONE = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
// THE SAME NUMBERS live in dms.css as the card's own height (each minus the 8
// the column adds after it). Move one and move the other or the list drifts.
const CARD_H = PHONE ? 168 : 112
const DAY_H = 32    // the sticky day header (24) plus the 8 that follows it
const OVERSCAN = 6

type Item =
  | { kind: 'day'; key: string; label: string; count: number }
  | { kind: 'row'; key: string; t: Thread }

const itemH = (it: Item) => (it.kind === 'day' ? DAY_H : CARD_H)

const PHONE_MQ = '(max-width: 767px)'

/** The phone, read once and kept in sync. The shared layout id is gated on it. */
function usePhone(): boolean {
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

function useRowWindow(ref: React.RefObject<HTMLDivElement | null>, items: Item[], on: boolean) {
  const [top, setTop] = useState(0)
  const [view, setView] = useState(900)
  useEffect(() => {
    const el = ref.current
    if (!el || !on) return
    const onScroll = () => setTop(el.scrollTop)
    const onSize = () => setView(el.clientHeight || 900)
    onSize()
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onSize)
    return () => { el.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onSize) }
  }, [ref, on])
  // The day header condenses once the column has moved. It condenses by taking
  // a hairline, never by changing height: a header that resized would
  // desynchronise every offset below it.
  const stuck = top > 0
  if (!on) return { start: 0, end: items.length, padTop: 0, padBottom: 0, stuck }
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
  return { start, end, padTop, padBottom: Math.max(0, acc - consumed), stuck }
}

const CHIPS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
  { key: 'arch', label: 'Arch' },
  { key: 'email', label: 'Email' },
]

// Ask 11 — the list holds CONVERSATIONS now (send echoes moved to Sends), so
// an empty lane says exactly that instead of implying nothing was ever sent.
const EMPTY: Record<Filter, string> = {
  all: 'No conversations — replies land here, sends live in Sends',
  ivan: 'No Ivan conversations — sends live in Sends',
  risedtc: 'No Rise conversations — sends live in Sends',
  arch: 'No Arch conversations — the reply detector for Davorin’s seat is not armed yet',
  email: 'No email conversations — sends live in Sends',
}

// The honest-empty register. The claim is only made where the HOST has
// established there was no error, which is why `verifiedAt` is a prop and not a
// constant: a screen that cannot see its own fetch must not promise a live read.
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

/** One conversation. The card that lifts, and on the phone grows, into its thread. */
function DmCard({
  t, active, draftRowActions, mobile, onOpenThread, onRowDiscard,
  rowNote, rowChip, rowTag, renderNote,
}: {
  t: Thread
  active: boolean
  draftRowActions: boolean
  mobile: boolean
  onOpenThread: (id: string) => void
  onRowDiscard: (e: React.MouseEvent, t: Thread) => void
  rowNote?: (t: Thread) => string | null
  rowChip?: (t: Thread) => ReactNode
  rowTag?: (t: Thread) => ReactNode
  renderNote?: (t: Thread, note: string) => ReactNode
}) {
  // A cluster fans rather than opens: the card's own tap still opens the
  // conversation, which is the one thing this row has always done.
  const [fanned, setFanned] = useState(false)
  const isDraftLast = t.draft != null && t.last.id === t.draft.id
  // Discard costs 3 interactions per draft today because the list shows a DRAFT
  // pill and nothing else. 45% of discards happen in runs of 2-6 rows, so the
  // row carries the draft's own text whenever one is pending.
  const pendingDraft = draftRowActions && t.draft != null && t.draftSnoozedUntil === null
    ? t.draft : null
  let snip = t.last.message_text
  if (pendingDraft) snip = pendingDraft.message_text
  else if (isDraftLast) snip = `Draft: ${t.last.message_text}`
  else if (t.last.direction === 'outbound' && t.last.sent_at) snip = `You: ${t.last.message_text}`
  const note = rowNote?.(t) ?? null
  const deck = t.unread > 1
  const kind = threadKind(t)
  const bucket = threadBucket(t)

  return (
    <motion.div
      className="dirb-dmwrap dirb-lift"
      data-deck={deck}
      data-unread={t.unread > 0 ? 'true' : 'false'}
      // Shared element only where it can be one. See the header note.
      layoutId={mobile ? `dirb-dm-${t.prospect_id}` : undefined}
      variants={rise}
      initial="hidden"
      animate="show"
      exit="exit"
      transition={spring}
    >
      {deck && (
        <>
          <motion.span className="dirb-dmpeek" data-i="1" animate={{ y: fanned ? 10 : 0 }} transition={spring} />
          <motion.span className="dirb-dmpeek" data-i="2" animate={{ y: fanned ? 20 : 0 }} transition={spring} />
        </>
      )}
      <Card
        className="dirb-dmcard r"
        selected={active}
        onClick={() => onOpenThread(t.prospect_id)}
      >
        {/* The command layer's row registration: j/k walks these rows and x
            selects them. A conversation carries NO bulk capability — an answer
            is written one at a time. A row with a pending draft is the one
            exception: discarding sends nothing. */}
        <RowSelect
          id={pendingDraft ? pendingDraft.id : t.prospect_id}
          kind="thread"
          label={t.prospect_name}
          caps={pendingDraft ? ['discard'] : []}
          lane={t.client_id}
        />
        {/* Head and body, not one row: the quoted draft gets the card's whole
            width instead of the ~126px left over beside the tail, which at 390
            truncated every preview to about fifteen characters. */}
        <div className="dirb-dmhead">
        <Avatar name={t.prospect_name} live={t.unread > 0} tint={t.client_id === 'risedtc' ? 2 : 3} />
        <div className="dirb-dmmid">
          <div className="dirb-dmtop">
            <span className="ds-t-title dirb-truncate dirb-dmname">{t.prospect_name}</span>
            {/* A tenant is a CATEGORY, and the system offers no categorical
                palette: amber here read as a live problem on every RISE row.
                Which client it is stays legible from the word and from the
                avatar tint, which is the one place identity may be a colour. */}
            <Chip tone="quiet">{clientBadge(t.client_id)}</Chip>
            {kind === 'inmail' && <Chip tone="quiet">INMAIL</Chip>}
            {kind === 'email' && <Chip tone="quiet">EMAIL</Chip>}
            {kind === 'linkedin' && <Chip tone="quiet">DM</Chip>}
            {isLeadMagnet(t) && <Chip tone="quiet">LEAD MAGNET</Chip>}
            {/* The state, in the app's own words: the bucket the badge, the
                breakdown and the status filter all already read. */}
            {/* Neutral, always. The accent on this row is spent once, on the
                DRAFT mark in the tail, and "Draft ready" beside a lime DRAFT
                chip was the same fact filled twice: five rows, ten lime fills,
                and the budget is one mark per row. */}
            <Chip tone="quiet">{STATUS_LABEL[bucket]}</Chip>
            {rowTag?.(t)}
          </div>
        </div>
        <div className="dirb-dmtail">
          {rowChip?.(t)}
          {deck && (
            <span onClick={e => e.stopPropagation()}>
              <Chip
                count={t.unread}
                selected={fanned}
                onClick={() => setFanned(v => !v)}
                className="dirb-deck-count"
              />
            </span>
          )}
          <span className="ds-t-mono dirb-dim">{timeAgo(eventTime(t.last))}</span>
          {t.unread > 0 && <Badge variant="dot" tone="accent" label={t.prospect_name} />}
          {/* A pushed draft says WHEN, not DRAFT — the row is the only place a
              parked draft is visible from the list. */}
          {t.draft != null && (t.draftSnoozedUntil !== null
            ? <Chip tone="quiet">{returnsIn(t.draftSnoozedUntil)}</Chip>
            : <Chip tone="accent">DRAFT</Chip>)}
          {/* Approve is deliberately NOT here. Approving a DM sends it to a real
              person, and the trip into the thread is what puts the draft in
              front of him before it goes. Discard sends nothing. */}
          {pendingDraft && (
            <span className="dirb-dmact">
              <Button variant="quiet" size="sm" icon="discard" onClick={e => onRowDiscard(e, t)}>
                Discard
              </Button>
            </span>
          )}
        </div>
        </div>
        {/* The pre-read, when one has been asked for, stands IN PLACE of the
            preview rather than under it: the card's height is what the list's
            windowing measures against. */}
        {note && renderNote
          ? renderNote(t, note)
          : (
            <div className="dirb-quote dirb-truncate ds-t-body dirb-dmbody" title={note ?? undefined}>
              {note ?? (pendingDraft ? `Draft: ${snip}` : snip)}
            </div>
          )}
      </Card>
    </motion.div>
  )
}

export function InboxList({ threads, filter, setFilter, refresh, onOpenThread, onOpenDrafts, activeThread = null, windowed = false, head, verifiedAt, title = 'Inbox', status, before, after, rowsFor, renderRow, rowNote, rowChip, rowTag, renderNote, emptyLine }: {
  threads: Thread[]
  filter: Filter
  setFilter: (f: Filter) => void
  refresh: () => void
  onOpenThread: (id: string) => void
  onOpenDrafts: () => void
  activeThread?: string | null
  windowed?: boolean
  head?: ReactNode
  verifiedAt?: string | null
  title?: string
  status?: Status
  after?: React.ReactNode
  before?: ReactNode
  rowsFor?: (shown: Thread[]) => void
  renderRow?: (t: Thread) => ReactNode
  rowNote?: (t: Thread) => string | null
  rowChip?: (t: Thread) => ReactNode
  rowTag?: (t: Thread) => ReactNode
  renderNote?: (t: Thread, note: string) => ReactNode
  emptyLine?: string
}) {
  const mobile = usePhone()
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const [query, setQuery] = useState('')
  const confirm = useConfirm()
  // The one toast this surface raises, and the only thing it offers is the way
  // back to the row: a discarded draft is readable, and restorable, from the
  // conversation it belonged to. Nothing here invents an undo write.
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const draftRowActions = status !== undefined
  async function onRowDiscard(e: React.MouseEvent, t: Thread) {
    e.stopPropagation()
    if (!t.draft) return
    const ok = await confirm({
      title: 'Discard this draft?',
      message: 'It will not be sent.',
      confirmText: 'Discard',
      danger: true,
    })
    if (!ok) return
    try {
      await discardDraft(t.draft.id)
      setToasts(cur => [...cur, {
        id: `${t.prospect_id}-${Date.now()}`,
        message: 'It will not be sent.',
        icon: 'discard',
        actionLabel: 'Open',
        onAction: () => onOpenThread(t.prospect_id),
      }])
    } finally { refresh() }
  }
  const laned = filterThreads(threads, filter)
  // A SEARCH reaches the whole lane; the LIST does not. The browsable list is
  // what is waiting on him, while typing a name still finds a conversation
  // where the ball is with them.
  const shown = query
    ? searchThreads(laned, query)
    : (status ? filterByStatus(laned, status) : laned)
  // Day headers with the live count in the tail, built off the SORT KEY
  // (`last.created_at`, what groupThreads orders by) so a group is contiguous.
  const items: Item[] = []
  if (!renderRow) {
    let lastDay = ''
    let head: { kind: 'day'; key: string; label: string; count: number } | null = null
    for (const t of shown) {
      const d = dayLabel(t.last.created_at)
      if (d !== lastDay) {
        lastDay = d
        head = { kind: 'day', key: `day-${d}-${t.prospect_id}`, label: d, count: 0 }
        items.push(head)
      }
      if (head) head.count += 1
      items.push({ kind: 'row', key: t.prospect_id, t })
    }
  }
  const win = useRowWindow(rowsRef, items, windowed && !renderRow)
  const draftTotal = threads.filter(t => t.draft && t.draftSnoozedUntil === null).length
  // Same derivation as the tab badge (lib/inbox.ts) — the chip suffix and the
  // bubble must never say two different numbers for the same list.
  const waitingTotal = inboxWaitingCount(threads)
  rowsFor?.(shown)

  return (
    <div className="dirb-dms">
      <Header
        title={title}
        tail={<Avatar name="IM" initials="IM" tint={1} />}
      />
      <div className="dirb-dms-search">
        <Input
          type="search"
          label="Search people or messages"
          labelHidden
          icon="search"
          placeholder="Search people or messages"
          value={query}
          onChange={e => setQuery(e.target.value)}
          tail={query
            ? <IconButton icon="close" label="Clear" size="sm" onClick={() => setQuery('')} />
            : undefined}
        />
        <div className="dirb-dms-filters dirb-scroll-x">
          {CHIPS.map(c => (
            <Chip
              key={c.key}
              selected={filter === c.key}
              onClick={() => setFilter(c.key)}
              count={c.key === 'all' && waitingTotal > 0 ? waitingTotal : undefined}
            >
              {c.label}
            </Chip>
          ))}
        </div>
      </div>

      {head ? <div className="dirb-dms-head">{head}</div> : null}

      {/* With a status axis present, "drafts" is one of the statuses — a banner
          pointing at a separate screen would be pointing at this one. */}
      {status === undefined && draftTotal > 0 && (
        <div className="dirb-dms-head">
          <Card className="dirb-lift" onClick={onOpenDrafts} lead={<Icon name="wand" size={20} />}
            title={`${draftTotal} draft${draftTotal === 1 ? '' : 's'} waiting for you`}
            sub="Clear them in one pass"
            tail={<Icon name="forward" size={20} />}
          />
        </div>
      )}

      <div className="dirb-dms-scroll" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {before}
        {shown.length === 0 ? (
          query
            ? <EmptyState icon="search" title={`No matches for “${query}”`} />
            : <EmptyVerified line={emptyLine ?? EMPTY[filter]} verifiedAt={verifiedAt} />
        ) : renderRow ? (
          <AnimatePresence initial={false}>
            {shown.map(t => (
              <motion.div key={t.prospect_id} variants={rise} initial="hidden" animate="show" exit="exit">
                {renderRow(t)}
              </motion.div>
            ))}
          </AnimatePresence>
        ) : (
          <>
            {win.padTop > 0 && <div style={{ height: win.padTop }} aria-hidden />}
            <AnimatePresence initial={false}>
              {items.slice(win.start, win.end).map(it => (
                it.kind === 'day'
                  ? (
                    <div
                      key={it.key}
                      className="dirb-dayhead dirb-sticky"
                      data-stuck={win.stuck ? 'true' : 'false'}
                    >
                      <DayHeader sticky={false} label={it.label} tail={it.count} />
                    </div>
                  )
                  : (
                    <DmCard
                      key={it.key}
                      t={it.t}
                      active={activeThread === it.t.prospect_id}
                      draftRowActions={draftRowActions}
                      mobile={mobile}
                      onOpenThread={onOpenThread}
                      onRowDiscard={onRowDiscard}
                      rowNote={rowNote}
                      rowChip={rowChip}
                      rowTag={rowTag}
                      renderNote={renderNote}
                    />
                  )
              ))}
            </AnimatePresence>
            {win.padBottom > 0 && <div style={{ height: win.padBottom }} aria-hidden />}
          </>
        )}
        {after}
      </div>
      <ToastStack items={toasts} onDismiss={id => setToasts(cur => cur.filter(x => x.id !== id))} />
    </div>
  )
}

/**
 * The pre-read's own loading shape. A row that is thinking looks like a row
 * that is thinking (Chat Thread Skeleton, cnippet.dev), instead of only saying
 * so in four words.
 */
export function NoteSkeleton({ line }: { line: string }) {
  return (
    <div className="dirb-row">
      <Skeleton shape="line" width="45%" />
      <span className="ds-t-meta dirb-dim">{line}</span>
    </div>
  )
}
