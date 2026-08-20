import { DraftCard, PushedBar, StaleBar } from '../../screens/DraftsScreen'
import { InboxScreen } from '../../screens/InboxScreen'
import { DmHistory } from './DmHistory'
import { STATUS_LABEL, filterThreads, type Filter, type Status, type Thread } from '../../lib/inbox'

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
