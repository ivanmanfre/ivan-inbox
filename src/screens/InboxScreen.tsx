import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Avatar } from '../components/Avatar'
import { PullIndicator } from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { returnsIn } from '../components/PushLaterSheet'
import { useConfirm } from '../components/ConfirmSheet'
import { discardDraft, filterByStatus, filterThreads, inboxWaitingCount, isLeadMagnet, searchThreads, threadKind, type Filter, type Status, type Thread, eventTime } from '../lib/inbox'
import { checkedPhrase } from '../lib/today'
import { RowSelect } from '../exp/v2c/RowSelect'

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

// ---- windowed list (opt-in) ----
//
// fetchMessages pages up to 20,000 rows and groupThreads renders every one of
// them: the live inbox is ~1,354 rows, 83,453px of DOM and 49,558 words at
// 390px, and the word count does not change between 390px and 1440px because it
// tracks the DOM, not the screen. Nine rows are ever visible.
//
// The build contract forbids a virtualization dependency unless it is ~40 lines
// implemented here and justified. This is those lines. Rows are a fixed 72px
// (12px padding + a 48px avatar), so a scroll offset maps straight to an index;
// the unrendered remainder is held open by two spacer divs so the scrollbar and
// every scroll position stay honest. Opt-in via `windowed` — the live app passes
// nothing and behaves exactly as before.
const ROW_H = 73
const OVERSCAN = 6

function useRowWindow(ref: React.RefObject<HTMLDivElement | null>, count: number, on: boolean) {
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
  if (!on) return { start: 0, end: count, padTop: 0, padBottom: 0 }
  const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN)
  const end = Math.min(count, Math.ceil((top + view) / ROW_H) + OVERSCAN)
  return { start, end, padTop: start * ROW_H, padBottom: (count - end) * ROW_H }
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

// The honest-empty register. "No threads yet" and "the fetch failed" rendered the
// identical sentence on the screen Ivan opens first every morning (U2/U3), and the
// fix is only half a state machine — the other half is saying so in language an
// operator actually trusts. The claim is only made where the HOST has established
// there was no error, which is why `verifiedAt` is a prop and not a constant: a
// screen that cannot see its own fetch must not promise a live read.
function EmptyVerified({ line, verifiedAt }: { line: string; verifiedAt?: string | null }) {
  return (
    <div className="empty">
      {line}
      {verifiedAt !== undefined && (
        <div className="empty-f">
          <span className="empty-dot" />
          {checkedPhrase(verifiedAt)}. This is a live read, not a stall.
        </div>
      )}
    </div>
  )
}

function clientLabel(id: string): string {
  if (id === 'risedtc') return 'RISE'
  if (id === 'ivan') return 'IVAN'
  return id.toUpperCase()
}

export function InboxScreen({ threads, filter, setFilter, refresh, onOpenThread, onOpenDrafts, activeThread = null, windowed = false, head, verifiedAt, title = 'Inbox', status, before, after, rowsFor, renderRow, rowNote, rowChip, renderNote, emptyLine }: {
  threads: Thread[]
  filter: Filter
  setFilter: (f: Filter) => void
  refresh: () => void
  onOpenThread: (id: string) => void
  onOpenDrafts: () => void
  activeThread?: string | null
  // Render only the rows near the viewport. Off by default so the live app is
  // untouched; the workbench turns it on because it mounts this list beside two
  // other live regions.
  windowed?: boolean
  // Optional slot under the filter chips. The live app passes nothing.
  head?: ReactNode
  // Supplied only by a host that has already established the fetch SUCCEEDED, so
  // an empty list can honestly say it was checked. Omitted = no claim made.
  verifiedAt?: string | null
  // ---- optional, added when the Inbox job was folded into DMs (2026-08-03) ----
  // Every one of these is opt-in so `#exp/stock` renders exactly what it always
  // did: the pre-revamp shell passes none of them.
  title?: string
  // The status axis (bucket filter). Omitted = no status filtering, and the
  // draft banner keeps its old job of pointing at a separate drafts screen.
  status?: Status
  // Rendered BELOW the list, inside the same scroller: the DM history section
  // lives here so it reads as the tail of the surface rather than a second page.
  after?: React.ReactNode
  // Slot INSIDE the scroller, above the rows — the DMs surface puts the draft
  // approve/discard cards and the Ops pointer strip here.
  before?: ReactNode
  // Lets the host see (and act on) the exact set the list is about to render,
  // so a "0 conversations, but 3 draft cards above" state is decidable by the
  // host rather than guessed at.
  rowsFor?: (shown: Thread[]) => void
  // Replaces the 73px conversation row for the whole list. The DMs surface uses
  // it for the "Draft ready" status, where the row IS the approve/discard card
  // that DraftsScreen used to own. Windowing is off when it is supplied — the
  // window maps a scroll offset onto a FIXED row height, and a card is not one.
  renderRow?: (t: Thread) => ReactNode
  // Two opt-in slots on the 73px conversation row, both absent from
  // `#exp/stock` because the pre-revamp shell passes neither.
  //
  // They exist as a PAIR, and as a pair rather than one bigger prop, because
  // the row's height is load-bearing: `useRowWindow` maps a scroll offset onto
  // a fixed ROW_H, so nothing may be ADDED to the row's vertical box. `rowNote`
  // therefore REPLACES the message preview on the line it already occupies,
  // and `rowChip` sits in the right-hand column beside the time and the pills.
  rowNote?: (t: Thread) => string | null
  rowChip?: (t: Thread) => ReactNode
  // The note, drawn by the HOST instead of as plain text — the DMs surface uses
  // it to make the pre-read hoverable, since 140 characters do not fit on one
  // nowrap row and Ivan could not read what he had paid for.
  //
  // INERT WHEN ABSENT, twice over: the branch below needs BOTH a note and this
  // prop, and `#exp/stock` passes neither (App.tsx never supplies `rowNote`, so
  // `note` is null on every stock row). Stock's markup is byte-identical. The
  // contract on whoever supplies it is the same one `rowNote` carries: render
  // ONE `.snip` element and do not grow the row, because `useRowWindow` maps a
  // scroll offset onto a fixed ROW_H.
  renderNote?: (t: Thread, note: string) => ReactNode
  emptyLine?: string
}) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const [query, setQuery] = useState('')
  const confirm = useConfirm()
  // Row-level draft actions (preview text + inline discard) are gated on
  // `status` being passed at all, the same opt-in signal the draft banner
  // above already uses. #exp/stock's call site never passes `status`
  // (App.tsx:130-138), so this stays undefined there and the row renders
  // exactly as it always has: no new markup, no new class, nothing to
  // scope under `.wb`.
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
  // A SEARCH reaches the whole lane; the LIST does not. Ivan, 2026-08-03: "dms
  // section doesnt need to show sent stuff only receiveds pending response" —
  // so the browsable list is what is waiting on him, while typing a name still
  // finds a conversation where the ball is with them. Cutting those rows from
  // search too would turn "I don't need to browse these" into "I can never look
  // one up", which is a different and worse thing.
  const shown = query
    ? searchThreads(laned, query)
    : (status ? filterByStatus(laned, status) : laned)
  const win = useRowWindow(rowsRef, shown.length, windowed && !renderRow)
  const draftTotal = threads.filter(t => t.draft && t.draftSnoozedUntil === null).length
  // Same derivation as the tab badge (lib/inbox.ts) — the chip suffix and the
  // bubble must never say two different numbers for the same list.
  const waitingTotal = inboxWaitingCount(threads)
  rowsFor?.(shown)

  return (
    <>
      <div className="nav">
        <div className="row-top">
          <h2>{title}</h2>
          <div className="avatar-me">IM</div>
        </div>
        <div className="search">
          <span>🔍</span>
          <input
            className="search-in"
            placeholder="Search people or messages"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && <span className="search-x" onClick={() => setQuery('')}>✕</span>}
        </div>
        <div className="chips">
          {CHIPS.map(c => (
            <button
              type="button"
              key={c.key}
              className={`chip ${filter === c.key ? 'on' : ''}`}
              onClick={() => setFilter(c.key)}
            >
              {c.label}
              {c.key === 'all' && waitingTotal > 0 && <span className="ct"> ·{waitingTotal}</span>}
            </button>
          ))}
        </div>
      </div>

      {head}

      {/* With a status axis present, "drafts" is one of the statuses — a banner
          pointing at a separate screen would be pointing at this one. */}
      {status === undefined && draftTotal > 0 && (
        <div className="draftbanner" onClick={onOpenDrafts}>
          <div className="ic">✦</div>
          <div>
            <div className="t">{draftTotal} draft{draftTotal === 1 ? '' : 's'} waiting for you</div>
            <div className="s">Clear them in one pass</div>
          </div>
          <div className="go">›</div>
        </div>
      )}

      <div className="rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {before}
        {shown.length === 0 ? (
          query
            ? <div className="empty">No matches for “{query}”</div>
            : <EmptyVerified line={emptyLine ?? EMPTY[filter]} verifiedAt={verifiedAt} />
        ) : (
          <>
          {win.padTop > 0 && <div style={{ height: win.padTop }} aria-hidden />}
          {shown.slice(win.start, win.end).map(t => {
            if (renderRow) return renderRow(t)
            const isDraftLast = t.draft != null && t.last.id === t.draft.id
            // Discard costs 3 interactions per draft today (open the thread,
            // find the card, discard) because the list shows a DRAFT pill and
            // nothing else: the draft text itself only lives inside the
            // thread. 45% of discards happen in runs of 2-6 rows, the
            // signature of clearing a list by hand, so the row now carries
            // the draft's own text whenever one is pending, not only when it
            // happens to be the newest event in the thread. draftRowActions
            // is the workbench-only gate; stock keeps the old isDraftLast-only
            // behaviour untouched.
            const pendingDraft = draftRowActions && t.draft != null && t.draftSnoozedUntil === null
              ? t.draft : null
            let snip = t.last.message_text
            if (pendingDraft) snip = pendingDraft.message_text
            else if (isDraftLast) snip = `✦ Draft: ${t.last.message_text}`
            else if (t.last.direction === 'outbound' && t.last.sent_at) snip = `You: ${t.last.message_text}`
            const note = rowNote?.(t) ?? null
            return (
              <div
                key={t.prospect_id}
                className={`r ${t.unread > 0 ? 'unread' : ''} ${activeThread === t.prospect_id ? 'active' : ''}`}
                onClick={() => onOpenThread(t.prospect_id)}
              >
                {/* The command layer's row registration: j/k walks these rows
                    and x selects them. A conversation carries NO bulk
                    capability — an answer is written one at a time, and the
                    bulk bar says that in words rather than offering a button
                    that would refuse. A row with a pending draft is the one
                    exception: discarding sends nothing, so it is the one
                    thing this row may still do in bulk (Shell.tsx's caller
                    passes the draft's own id, not the thread's, so a bulk run
                    discards the right row). */}
                <RowSelect
                  id={pendingDraft ? pendingDraft.id : t.prospect_id}
                  kind="thread"
                  label={t.prospect_name}
                  caps={pendingDraft ? ['discard'] : []}
                  lane={t.client_id}
                />
                <Avatar name={t.prospect_name} client_id={t.client_id} channel={t.channel} />
                <div className="mid">
                  <div className="top">
                    <span className="name">{t.prospect_name}</span>
                    <span className={`client ${t.client_id === 'risedtc' ? 'rise' : ''}`}>{clientLabel(t.client_id)}</span>
                    {threadKind(t) === 'inmail' && <span className="client kind-inmail">INMAIL</span>}
                    {threadKind(t) === 'email' && <span className="client kind-email">EMAIL</span>}
                    {threadKind(t) === 'linkedin' && <span className="client kind-dm">DM</span>}
                    {isLeadMagnet(t) && <span className="client kind-lm">LEAD MAGNET</span>}
                  </div>
                  {/* The pre-read, when one has been asked for, stands IN
                      PLACE of the preview rather than under it: the row height
                      is what the list's windowing measures against. ONE .snip
                      element in every case, so the density tokens and the `ch`
                      measure cap keyed on `.r .snip` reach the pre-read too.
                      The pending-draft prefix is the no-note branch: a row that
                      was summed up shows the summary, not `✦ Draft:` twice. */}
                  {note && renderNote
                    ? renderNote(t, note)
                    : (
                      <div className={`snip${note ? ' snip-note' : ''}`} title={note ?? undefined}>
                        {note ?? (pendingDraft ? `✦ Draft: ${snip}` : snip)}
                      </div>
                    )}
                </div>
                <div className="right">
                  {rowChip?.(t)}
                  <span className="time">{timeAgo(eventTime(t.last))}</span>
                  {t.unread > 0 && <span className="udot" />}
                  {/* A pushed draft says WHEN, not DRAFT — the row is the only
                      place a parked draft is visible from the list, so it has to
                      carry its return date rather than look like queued work. */}
                  {t.draft != null && (t.draftSnoozedUntil !== null
                    ? <span className="dpill pushed">{returnsIn(t.draftSnoozedUntil)}</span>
                    : <span className="dpill">DRAFT</span>)}
                  {/* Approve is deliberately NOT here. Approving a DM sends
                      it to a real person, and the trip into the thread is
                      what puts the draft in front of him before it goes.
                      Discard sends nothing, so it is safe to run from the
                      list the same way the stale-draft bar already does. */}
                  {pendingDraft && (
                    <button
                      type="button"
                      className="pushbtn"
                      onClick={e => onRowDiscard(e, t)}
                    >
                      Discard
                    </button>
                  )}
                  {/* The NEEDS REPLY pill went with the flag's demotion: it sat
                      on threads that end with Ivan's own reply (Nour Siakir
                      Oglou), which is the opposite of what it claimed. */}
                </div>
              </div>
            )
          })}
          {win.padBottom > 0 && <div style={{ height: win.padBottom }} aria-hidden />}
          </>
        )}
        {after}
      </div>
    </>
  )
}
