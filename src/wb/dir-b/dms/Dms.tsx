import { CopyChatLink } from '../../../components/CopyChatLink'
import { Chip } from '../../../ds'
import { DirB } from '../shell'
import { DraftCard, PushedBar, StaleBar } from './DraftCard'
import { InboxList, NoteSkeleton } from './InboxList'
import { DmHistory } from './DmHistory'
import { PreReadNote } from './PreReadNote'
import { STATUS_LABEL, filterThreads, type Filter, type Status, type Thread } from '../../../lib/inbox'
import { preReadWorthwhile, waitingDays } from '../../../exp/v2c/chat/preread'
import { usePreRead } from '../../../exp/v2c/chat/usePreRead'
import './dms.css'

// DMs — the one surface a person waiting on Ivan can appear on.
//
// Direction B copy of src/exp/v2c/DmsSurface.tsx. The composition is unchanged:
// the CONVERSATION list is the body, "Draft ready" renders the approve/discard
// card, the stale-draft bulk escape and the pushed-draft pointer ride the
// `before` slot, and the DM history is the tail. The pre-read is still reachable
// from exactly one place — the click handler below. There is no effect in this
// file, no prefetch and no scroll trigger, because a 58-row list that summarises
// itself as it scrolls is a spending bug.
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
  const pushedDrafts = laned.filter(t => t.draftSnoozedUntil !== null)

  // ON DEMAND MEANS ON DEMAND. The hook refuses a second call while one is
  // running and stops after a session cap.
  const pre = usePreRead()

  return (
    <DirB>
      <InboxList
        title="DMs"
        threads={threads}
        filter={filter}
        setFilter={setFilter}
        status={status}
        refresh={refresh}
        onOpenThread={onOpenThread}
        // A `status` is passed, so the list renders no draft banner and this
        // never fires — the drafts are rows in this same list.
        onOpenDrafts={() => {}}
        windowed
        verifiedAt={loadedAt}
        before={<>
          <StaleBar stale={staleDrafts} refresh={refresh} />
          <PushedBar pushed={pushedDrafts} onOpen={onOpenThread} />
        </>}
        // DM HISTORY (Ivan, 2026-08-03: "so i know this is working"). With zero
        // pending the surface would otherwise be an empty screen that proves
        // nothing.
        after={<DmHistory threads={filterThreads(threads, filter)} onOpen={onOpenThread} />}
        rowNote={t => {
          const st = pre.get(t.prospect_id)
          if (st.s === 'done') return st.line
          if (st.s === 'running') return 'Reading it…'
          if (st.s === 'error') return st.why
          return null
        }}
        // AND THE WHOLE OF IT, on hover, on focus and on tap. Ivan, 2026-08-22:
        // "I cannot see what is summing up. Maybe add a bubble, like a hover
        // thing." PreReadNote anchors the full three parts to THIS row and
        // renders text already fetched; there is no second call.
        renderNote={(t, note) => {
          // A line still arriving is not a line to expand: the shape it will
          // take is drawn in its place while it comes.
          if (pre.get(t.prospect_id).s === 'running') {
            return <NoteSkeleton line={note} />
          }
          return <PreReadNote line={note} name={t.prospect_name} days={waitingDays(t)} />
        }}
        rowChip={t => {
          if (!preReadWorthwhile(t)) return null
          const st = pre.get(t.prospect_id)
          if (st.s === 'done' || st.s === 'running') return null
          const days = waitingDays(t)
          return (
            <span
              onClick={e => e.stopPropagation()}
              title={days === null
                ? 'Sum up what this one is about, without opening it'
                : `Waiting ${days} days. Sum it up without opening it.`}
            >
              <Chip
                icon="ask"
                onClick={() => pre.run(t)}
              >{st.s === 'error' ? 'again' : 'sum up'}</Chip>
            </span>
          )
        }}
        // Ivan, 2026-08-24: "so I can copy and send to Mattan when the chat
        // requires him to do something manual". On EVERY row, because which
        // conversation is going to need a hand is not something the row can know
        // in advance. It keeps `client rowlink` verbatim: the class carries the
        // pill styling the badges beside it already use, and the screenshot
        // recipe reaches for it by name.
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
    </DirB>
  )
}
