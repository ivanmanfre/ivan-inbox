import { DraftCard, OpsPending, StaleBar } from '../../screens/DraftsScreen'
import { InboxScreen } from '../../screens/InboxScreen'
import { DmHistory } from './DmHistory'
import { STATUS_LABEL, filterThreads, type Filter, type Status, type Thread } from '../../lib/inbox'
import { pendingDmLaneOps, type OpsDraft } from '../../lib/ops'
import { InboxHead } from './InboxHead'

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
//   · the BREAKDOWN BAR became the status axis — the same `threadBucket` the
//     badge sums, so a segment's printed number and the list it produces are one
//     derivation and cannot drift,
//   · "Draft ready" renders the approve/discard DraftCard that DraftsScreen
//     owned, so the affordance survived the job that hosted it,
//   · the stale-draft bulk escape and the Ops DM-lane pointer are unchanged.
//
// Default view is `needs` — exactly what the rail badge counts. "Waiting on
// them" is one click away and never hidden, because a conversation with the ball
// in their court is still a conversation.
export function DmsSurface({
  threads, opsDrafts, filter, setFilter, status, setStatus,
  refresh, onOpenThread, onOpenOps, loadedAt,
}: {
  threads: Thread[]
  opsDrafts: OpsDraft[]
  filter: Filter
  setFilter: (f: Filter) => void
  status: Status
  setStatus: (s: Status) => void
  refresh: () => void
  onOpenThread: (id: string) => void
  onOpenOps: () => void
  loadedAt: string | null
}) {
  // Both strips are lane-scoped so they agree with the list under them: the
  // client chips filter the rows, and a stale-draft bar counting a lane Ivan is
  // not looking at would be the tenancy version of a phantom badge.
  const laned = filterThreads(threads, filter)
  const staleDrafts = laned.filter(t => t.draft !== null && t.draftStale)
  const opsPend = pendingDmLaneOps(opsDrafts)
    .filter(d => filter === 'all' || (d.client_id === 'rise' ? 'risedtc' : d.client_id) === filter)

  return (
    <InboxScreen
      title="DMs"
      threads={threads}
      filter={filter}
      setFilter={setFilter}
      status={status}
      refresh={refresh}
      onOpenThread={onOpenThread}
      // The banner this prop used to feed pointed at a separate drafts screen;
      // with a status axis the drafts ARE a view of this list, so the only
      // caller left is the head's own key.
      onOpenDrafts={() => setStatus('approve')}
      windowed
      verifiedAt={loadedAt}
      head={<InboxHead threads={threads} loadedAt={loadedAt} status={status} setStatus={setStatus} />}
      before={
        <>
          <StaleBar stale={staleDrafts} refresh={refresh} />
          <OpsPending drafts={opsPend} onOpenOps={onOpenOps} />
        </>
      }
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
