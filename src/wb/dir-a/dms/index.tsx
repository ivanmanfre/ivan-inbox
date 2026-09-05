/* ==========================================================================
   src/wb/dir-a/dms/index.tsx — S02, Direction A.

   The composition, rebuilt from src/exp/v2c/DmsSurface.tsx. Same props, same
   hook, same slots, same strings. The list body it delegates to now lives beside
   it (./InboxList) so the view could be rebuilt without touching the screen the
   app still ships.
   ========================================================================== */
import { InboxList } from './InboxList'
import { DraftCard, PushedBar, StaleBar } from './DraftCard'
import { DmHistory } from './DmHistory'
import { PreReadNote } from './PreReadNote'
import { ChatLink } from './parts'
import { Button } from '../../../ds'
import { STATUS_LABEL, filterThreads, type Filter, type Status, type Thread } from '../../../lib/inbox'
import { preReadWorthwhile, waitingDays } from '../../../exp/v2c/chat/preread'
import { usePreRead } from '../../../exp/v2c/chat/usePreRead'
import './dms.css'

// DMs — the one surface a person waiting on Ivan can appear on.
//
// The census that preceded this file is why it is a MERGE and not a delete: the
// DMs lane was `threads.filter(t => t.draft !== null)` and rendered ZERO rows,
// while Inbox held all 135 conversations. Deleting the tab would have deleted
// the only way to see 70 people who are waiting. So the surfaces composed:
//   · the CONVERSATION list is the body,
//   · "Draft ready" renders the approve/discard card,
//   · the stale-draft bulk escape is unchanged.
//
// The view is `needs` — exactly what the rail badge counts. A draft is still
// approved from the thread it belongs to.
export function Dms({
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
  // Lane-scoped for the same reason the stale bar is.
  const pushedDrafts = laned.filter(t => t.draftSnoozedUntil !== null)

  // THE PRE-READ. Measured need: 58 threads waiting, median 22.9 days, 36 of
  // them never opened here at all. The list gives him a name and the first words
  // of the newest message, which is not enough to pick which one to open.
  //
  // ON DEMAND MEANS ON DEMAND. `pre.run` is reachable from exactly one place,
  // the click handler below. There is no effect in this file, no prefetch and no
  // scroll trigger, because a 58-row list that summarises itself as it scrolls
  // is a spending bug. The hook refuses a second call while one is running and
  // stops after a session cap.
  const pre = usePreRead()

  return (
    <InboxList
      title="DMs"
      threads={threads}
      filter={filter}
      setFilter={setFilter}
      status={status}
      refresh={refresh}
      onOpenThread={onOpenThread}
      // A `status` is passed, so the list renders no draft banner and this never
      // fires — the drafts are rows in this same list.
      onOpenDrafts={() => {}}
      windowed
      verifiedAt={loadedAt}
      before={<>
        <StaleBar stale={staleDrafts} refresh={refresh} />
        <PushedBar pushed={pushedDrafts} onOpen={onOpenThread} />
      </>}
      // DM HISTORY ("so i know this is working"). With zero pending the surface
      // would otherwise be an empty screen that proves nothing; the history is
      // the receipt that the engine holds conversations.
      after={<DmHistory threads={filterThreads(threads, filter)} onOpen={onOpenThread} />}
      // The generated line stands in place of the message preview (the row's
      // height is what the list windows against). Absent on any row where Ivan is
      // not the one being waited on.
      rowNote={t => {
        const st = pre.get(t.prospect_id)
        if (st.s === 'done') return st.line
        if (st.s === 'running') return 'Reading it…'
        if (st.s === 'error') return st.why
        return null
      }}
      // AND THE WHOLE OF IT, on hover, on focus and on tap. The row keeps its one
      // line — its height is what the list windows against — and PreReadNote
      // anchors the full three parts to THIS row. It renders text already
      // fetched; there is no second call.
      renderNote={(t, note) => {
        // A line still arriving is not a line to expand: "Reading it…" fits.
        if (pre.get(t.prospect_id).s === 'running') {
          return <span className="a-dms-note-plain a-working">{note}</span>
        }
        return <PreReadNote line={note} name={t.prospect_name} days={waitingDays(t)} />
      }}
      rowChip={t => {
        if (!preReadWorthwhile(t)) return null
        const st = pre.get(t.prospect_id)
        if (st.s === 'done' || st.s === 'running') return null
        const days = waitingDays(t)
        return (
          <Button
            variant="quiet"
            size="sm"
            icon="quote"
            title={days === null
              ? 'Sum up what this one is about, without opening it'
              : `Waiting ${days} days. Sum it up without opening it.`}
            onClick={e => { e.stopPropagation(); pre.run(t) }}
          >{st.s === 'error' ? 'again' : 'sum up'}</Button>
        )
      }}
      // "so I can copy and send to Mattan when the chat requires him to do
      // something manual". On EVERY row, because which conversation is going to
      // need a hand is not something the row can know in advance.
      //
      // It rides the row's INLINE ACTIONS rather than the badge line: the row is
      // a fixed-height box the window measures against, and an action that only
      // appears under the pointer or the caret costs the row nothing at rest.
      rowTag={t => (
        <ChatLink
          chatProviderId={t.chat_provider_id}
          url={t.linkedin_url}
          name={t.prospect_name}
          quiet
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
