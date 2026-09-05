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
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, Banner, Button, Chip, DayHeader, EmptyState, IconButton, Input } from '../../ds'
import { Body, Group, Head, Bar, Row, Rows, Screen } from '../kit'
import { Face, PullMark, Pill, timeAgo } from './parts'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { returnsIn } from '../../components/PushLaterSheet'
import { useConfirm } from '../chrome/ConfirmSheet'
import { discardDraft, filterByStatus, filterThreads, inboxWaitingCount, isLeadMagnet, searchThreads, threadKind, type Filter, type Status, type Thread, eventTime } from '../../lib/inbox'
import { checkedPhrase } from '../../lib/today'
import { clientBadge } from '../../lib/labels'
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

/** The phone, as a boolean. The day groups are a desktop move. */
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

// The day label the group header prints. Today says so in words; every other day
// is the weekday and the date, so a reader never has to work out which Tuesday.
function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return 'TODAY'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}

type Item =
  | { kind: 'day'; key: string; label: string; count: number }
  | { kind: 'row'; key: string; t: Thread }

// TWO item shapes now, so the offsets are SUMMED once per render rather than
// divided. With no day headers (the phone) the sum reduces to the multiplication
// it replaced, and the rows are still a fixed height either way.
function useRowWindow(ref: React.RefObject<HTMLDivElement | null>, items: Item[], on: boolean, rowH: number) {
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
  const itemH = (it: Item) => (it.kind === 'day' ? DAY_H : rowH)
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
]

// The list holds CONVERSATIONS (send echoes moved to Sends), so an empty lane
// says exactly that instead of implying nothing was ever sent.
const EMPTY: Record<Filter, string> = {
  all: 'No conversations — replies land here, sends live in Sends',
  ivan: 'No Ivan conversations — sends live in Sends',
  risedtc: 'No Rise conversations — sends live in Sends',
  arch: 'No Arch conversations — the reply detector for Davorin’s seat is not armed yet',
  email: 'No email conversations — sends live in Sends',
}

// The honest-empty register. "No threads yet" and "the fetch failed" rendered
// the identical sentence on the screen Ivan opens first every morning, and the
// fix is only half a state machine — the other half is saying so in language an
// operator actually trusts. The claim is only made where the HOST has
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

export function InboxList({ threads, filter, setFilter, refresh, onOpenThread, onOpenDrafts, activeThread = null, windowed = false, head, verifiedAt, title = 'Inbox', status, before, after, rowsFor, renderRow, rowNote, rowChip, rowTag, renderNote, emptyLine }: {
  threads: Thread[]
  filter: Filter
  setFilter: (f: Filter) => void
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
  title?: string
  // The status axis (bucket filter). Omitted = no status filtering, and the
  // draft banner keeps its old job of pointing at a separate drafts screen.
  status?: Status
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
  emptyLine?: string
}) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const [query, setQuery] = useState('')
  const confirm = useConfirm()
  // Row-level draft actions (preview text + inline discard) are gated on
  // `status` being passed at all, the same opt-in signal the draft banner above
  // already uses.
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
    try { await discardDraft(t.draft.id) } finally { refresh() }
  }
  const laned = filterThreads(threads, filter)
  // A SEARCH reaches the whole lane; the LIST does not. The browsable list is
  // what is waiting on him, while typing a name still finds a conversation where
  // the ball is with them. Cutting those rows from search too would turn "I
  // don't need to browse these" into "I can never look one up".
  const shown = query
    ? searchThreads(laned, query)
    : (status ? filterByStatus(laned, status) : laned)
  const rowH = useRowH()
  const phone = usePhone()
  // GRAFT B-1: the run of rows becomes a run of day groups on the desktop, each
  // header carrying how many conversations landed that day. The phone keeps the
  // flat run: at 390 the row already spends two lines on the same parts and a
  // third band of chrome every few rows costs more than it says.
  const items: Item[] = []
  {
    let lastDay: string | null = null
    let head: Extract<Item, { kind: 'day' }> | null = null
    for (const t of shown) {
      if (!phone) {
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
  }
  const win = useRowWindow(rowsRef, items, windowed && !renderRow, rowH)
  const draftTotal = threads.filter(t => t.draft && t.draftSnoozedUntil === null).length
  // Same derivation as the tab badge (lib/inbox.ts) — the chip suffix and the
  // bubble must never say two different numbers for the same list.
  const waitingTotal = inboxWaitingCount(threads)
  rowsFor?.(shown)

  return (
    <Screen className="a-dms">
      <Head title={title} tail={<Face name="IM" size="sm" />} />
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
      <Bar>
        {CHIPS.map(c => (
          <Chip
            key={c.key}
            selected={filter === c.key}
            onClick={() => setFilter(c.key)}
            // tabs-07: the count appears only when there is one to show.
            count={c.key === 'all' && waitingTotal > 0 ? waitingTotal : undefined}
          >{c.label}</Chip>
        ))}
      </Bar>

      {head}

      <Body innerRef={rowsRef} className="a-dms-body">
        <PullMark pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {/* With a status axis present, "drafts" is one of the statuses — a banner
            pointing at a separate screen would be pointing at this one. */}
        {status === undefined && draftTotal > 0 && (
          <Banner
            icon="wand"
            title={`${draftTotal} draft${draftTotal === 1 ? '' : 's'} waiting for you`}
            action={<Button variant="quiet" iconEnd="forward" onClick={onOpenDrafts}>Clear them in one pass</Button>}
          />
        )}
        {before}
        {shown.length === 0 ? (
          query
            ? <EmptyState icon="search" title={`No matches for “${query}”`} />
            : <EmptyVerified line={emptyLine ?? EMPTY[filter]} verifiedAt={verifiedAt} />
        ) : renderRow ? (
          <div className="a-stack">{shown.map(t => renderRow(t))}</div>
        ) : (
          <Group>
            <Rows>
              {win.padTop > 0 && <div style={{ height: win.padTop }} aria-hidden />}
              {items.slice(win.start, win.end).map(it => {
                if (it.kind === 'day') {
                  return (
                    <div key={it.key} className="a-dms-dayhost" style={{ height: DAY_H }}>
                      <DayHeader sticky={false} label={it.label} tail={it.count} />
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
                let snip = t.last.message_text
                if (pendingDraft) snip = pendingDraft.message_text
                else if (isDraftLast) snip = `Draft: ${t.last.message_text}`
                else if (t.last.direction === 'outbound' && t.last.sent_at) snip = `You: ${t.last.message_text}`
                const note = rowNote?.(t) ?? null
                const kind = threadKind(t)
                const chip = rowChip?.(t)
                const tag = rowTag?.(t)
                return (
                  /* THE HOST ELEMENT is what the command layer walks. RowSelect
                     writes `data-wbrow`, `data-wbsel` and `data-wbfocus` onto its
                     own parent, so the mark and the row it registers have to be
                     siblings inside one box — and that box is what carries the
                     fixed height the window measures against. */
                  <div
                    key={t.prospect_id}
                    className="a-dms-rowhost"
                    style={{ height: rowH }}
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
                    />
                    <Row
                      className="r"
                      onClick={() => onOpenThread(t.prospect_id)}
                      unread={t.unread > 0}
                      selected={activeThread === t.prospect_id}
                      lead={<Face name={t.prospect_name} />}
                      title={
                        <span className="a-dms-titleline">
                          <span className="a-nowrap">{t.prospect_name}</span>
                          <Pill>{clientBadge(t.client_id)}</Pill>
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
                      sub={note && renderNote
                        ? renderNote(t, note)
                        : (note ?? (pendingDraft ? `Draft: ${snip}` : snip))}
                      tail={<>
                        <span className="a-mono">{timeAgo(eventTime(t.last))}</span>
                        {t.unread > 0 && <Badge variant="dot" tone="accent" label={`${t.unread} unread`} />}
                        {/* A pushed draft says WHEN, not DRAFT — the row is the
                            only place a parked draft is visible from the list, so
                            it has to carry its return date rather than look like
                            queued work. */}
                        {t.draft != null && (t.draftSnoozedUntil !== null
                          ? <Chip icon="time">{returnsIn(t.draftSnoozedUntil)}</Chip>
                          : <Chip icon="wand">DRAFT</Chip>)}
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
                        {pendingDraft && (
                          <Button variant="quiet" size="sm" onClick={e => onRowDiscard(e, t)}>
                            Discard
                          </Button>
                        )}
                      </> : undefined}
                    />
                  </div>
                )
              })}
              {win.padBottom > 0 && <div style={{ height: win.padBottom }} aria-hidden />}
            </Rows>
          </Group>
        )}
        {after}
      </Body>
    </Screen>
  )
}
