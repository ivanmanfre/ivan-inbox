import { CopyChatLink } from '../../components/CopyChatLink'
import { DraftCard, PushedBar, StaleBar } from '../../screens/DraftsScreen'
import { InboxScreen } from '../../screens/InboxScreen'
import { DmHistory } from './DmHistory'
import { PreReadNote } from './PreReadNote'
import { STATUS_LABEL, filterThreads, type Filter, type Status, type Thread } from '../../lib/inbox'
import { preReadWorthwhile, waitingDays } from './chat/preread'
import { usePreRead } from './chat/usePreRead'

// DMs — the one surface a person waiting on Ivan can appear on.
//
// Ivan, twice on 2026-08-03: "the inbox section u can remove it i see no purpose
// on it having dms and sends". The census that preceded this file
// (phase1-census.json) is why it is a MERGE and not a delete: the DMs lane was
// `threads.filter(t => t.draft !== null)` and rendered ZERO rows, while Inbox
// held all 135 conversations — 28 to answer, 42 the reply detector flagged, 65
// waiting on them. Deleting the tab would have deleted the only way to see 70
// people who are waiting.
//
// So the surfaces composed instead of one eating the other:
//   · the CONVERSATION list (Inbox's job) is the body,
//   · "Draft ready" renders the approve/discard DraftCard that DraftsScreen
//     owned, so the affordance survived the job that hosted it,
//   · the stale-draft bulk escape is unchanged.
//
// 2026-08-04, Ivan, twice: the breakdown head ("2 to answer · 2 pending · 103
// answered, waiting on them · sends live in Sends") and the Ops pointer strip
// are both GONE. The head was a status axis nobody asked for on a surface whose
// whole job is "who is waiting on me", and the Ops strip put newsjacks and
// escalations — work that is approved on the Ops tab — inside a conversation
// list. DMs now shows conversations and nothing else; the rail badge still
// counts what is waiting, and Ops still owns every ops card.
//
// The view is `needs` — exactly what the rail badge counts. A draft is still
// approved from the thread it belongs to.
export function DmsSurface({
  threads, filter, setFilter, status,
  refresh, onOpenThread, loadedAt,
}: {
  threads: Thread[]
  filter: Filter
  setFilter: (f: Filter) => void
  status: Status
  refresh: () => void
  onOpenThread: (id: string) => void
  loadedAt: string | null
}) {
  // The stale-draft strip is lane-scoped so it agrees with the list under it: a
  // bar counting a lane Ivan is not looking at would be the tenancy version of a
  // phantom badge.
  const laned = filterThreads(threads, filter)
  const staleDrafts = laned.filter(t => t.draft !== null && t.draftStale)
  // Lane-scoped for the same reason the stale bar is: a count from a lane he is
  // not looking at is the tenancy version of a phantom badge.
  const pushedDrafts = laned.filter(t => t.draftSnoozedUntil !== null)

  // THE PRE-READ (item 2 of the AI pass). Measured need: 58 threads waiting,
  // median 22.9 days, 36 of them never opened here at all. The list gives him a
  // name and the first words of the newest message, which is not enough to pick
  // which one to open.
  //
  // 🔴 ON DEMAND MEANS ON DEMAND. `pre.run` is reachable from exactly one
  // place, the click handler below. There is no effect in this file, no
  // prefetch and no scroll trigger, because a 58-row list that summarises
  // itself as it scrolls is a spending bug. The hook refuses a second call
  // while one is running and stops after a session cap.
  const pre = usePreRead()

  return (
    <InboxScreen
      title="DMs"
      threads={threads}
      filter={filter}
      setFilter={setFilter}
      status={status}
      refresh={refresh}
      onOpenThread={onOpenThread}
      // A `status` is passed, so InboxScreen renders no draft banner and this
      // never fires — the drafts are rows in this same list.
      onOpenDrafts={() => {}}
      windowed
      verifiedAt={loadedAt}
      before={<>
        <StaleBar stale={staleDrafts} refresh={refresh} />
        <PushedBar pushed={pushedDrafts} onOpen={onOpenThread} />
      </>}
      // A draft is not a 73px row you read — it is a message you send or throw
      // away, so in that status the row IS the card, with the swipe gestures and
      // the confirm intact.
      // DM HISTORY (Ivan, 2026-08-03: "so i know this is working"). With zero
      // pending the surface would otherwise be an empty screen that proves
      // nothing; the history is the receipt that the engine holds conversations.
      after={<DmHistory threads={filterThreads(threads, filter)} onOpen={onOpenThread} />}
      // The generated line stands in place of the message preview (the row's
      // height is what the list windows against), and the control is a chip in
      // the right-hand column. Both are absent on any row where Ivan is not the
      // one being waited on.
      rowNote={t => {
        const st = pre.get(t.prospect_id)
        if (st.s === 'done') return st.line
        if (st.s === 'running') return 'Reading it…'
        if (st.s === 'error') return st.why
        return null
      }}
      // AND THE WHOLE OF IT, on hover, on focus and on tap. Ivan, 2026-08-22:
      // "I cannot see what is summing up. Maybe add a bubble, like a hover
      // thing." The row keeps its one line — its height is what the list
      // windows against — and PreReadNote anchors the full three parts to THIS
      // row. It renders text already fetched; there is no second call.
      renderNote={(t, note) => {
        // A line still arriving is not a line to expand: "Reading it…" fits.
        if (pre.get(t.prospect_id).s === 'running') {
          return <div className="snip snip-note">{note}</div>
        }
        return <PreReadNote line={note} name={t.prospect_name} days={waitingDays(t)} />
      }}
      rowChip={t => {
        if (!preReadWorthwhile(t)) return null
        const st = pre.get(t.prospect_id)
        if (st.s === 'done' || st.s === 'running') return null
        const days = waitingDays(t)
        return (
          <button
            type="button"
            className="wb-pre"
            title={days === null
              ? 'Sum up what this one is about, without opening it'
              : `Waiting ${days} days. Sum it up without opening it.`}
            onClick={e => { e.stopPropagation(); pre.run(t) }}
          >{st.s === 'error' ? 'again' : 'sum up'}</button>
        )
      }}
      // Ivan, 2026-08-24: "so I can copy and send to Mattan when the chat requires him
      // to do something manual". On EVERY row, because which conversation is going to
      // need a hand by is not something the row can know in advance.
      //
      // It rides the BADGE LINE and not the tail beside "sum up". `--tail-w` is a fixed
      // 62px track — the thing that keeps every trailing value in the list on one right
      // edge (faithful.css §7.7) — and two chips overflow it: measured at 1280, the
      // second one clipped mid-word. The badge line already carries pills of this
      // height, so nothing is added to the row's vertical box.
      //
      // It wears `.client`, the badge class the pills beside it already use, so it takes
      // the row's existing type tier and box by construction rather than adding an N+1
      // text size to the census. `.rowlink` only removes the underline an anchor gets.
      rowTag={t => (
        <CopyChatLink
          chatProviderId={t.chat_provider_id}
          url={t.linkedin_url}
          name={t.prospect_name}
          className="client rowlink"
        />
      )}
      renderRow={status === 'approve'
        ? t => <DraftCard key={t.prospect_id} thread={t} onOpenThread={onOpenThread} refresh={refresh} />
        : undefined}
      emptyLine={
        status === 'needs' ? 'Nothing waiting on you — replies land here, sends live in Sends'
          : status === 'all' ? 'No conversations — replies land here, sends live in Sends'
            : `No conversations in “${STATUS_LABEL[status]}”`
      }
    />
  )
}
