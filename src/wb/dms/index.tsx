/* ==========================================================================
   src/wb/dms/index.tsx — S02, Direction A.

   The composition, rebuilt from src/exp/v2c/DmsSurface.tsx. Same props, same
   hook, same slots, same strings. The list body it delegates to now lives beside
   it (./InboxList) so the view could be rebuilt without touching the screen the
   app still ships.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { InboxList, type HoldAction } from './InboxList'
import { chatLink } from '../../components/CopyChatLink'
import { DraftCard, PushedBar, StaleBar } from './DraftCard'
import { DmCount } from './DmHistory'
import { WarmSignals } from './WarmSignals'
import { CameBack } from './CameBack'
import { PreReadNote } from './PreReadNote'
import { ChatLink } from './parts'
import { Button } from '../../ds'
import { STATUS_LABEL, type Filter, type Status, type Thread } from '../../lib/inbox'
import {
  applyThreadTokens, filterFromTokens, readTokens, writeTokens,
  type FilterToken,
} from '../../lib/filterTokens'
import { preReadWorthwhile, waitingDays } from '../../exp/v2c/chat/preread'
import { usePreRead } from '../../exp/v2c/chat/usePreRead'
import { askAbout } from '../ask/askAbout'
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
  refresh, onOpenThread, loadedAt, refreshing = false, cachedAt = null, error = null, warm = null,
}: {
  threads: Thread[]
  filter: Filter
  setFilter: (f: Filter) => void
  status: Status
  refresh: () => void
  onOpenThread: (id: string) => void
  loadedAt: string | null
  // The saved-copy paint. See InboxList's own note: this is an affordance, not
  // a freshness claim.
  refreshing?: boolean
  cachedAt?: string | null
  // N3b-3: the read behind the saved copy failed. Handed down so the strip names
  // the failure instead of claiming a refresh that has already died.
  error?: string | null
  // `?warm=1` scrolls to the Warm signals section, `?warm=<uuid>` to one card.
  warm?: string | null
}) {
  /* E2 · THE TOKEN SET IS THE QUESTION, AND IT LIVES HERE.

     The six lane chips are shortcuts that write it; `filter` is DERIVED from it
     and pushed back up to the Shell, so WarmSignals (Ivan's tenant only),
     DmHistory, the stale bar and the pushed bar keep taking the `Filter` union
     they have always taken and not one of them changed signature.

     sessionStorage, read ONCE at mount: a refresh keeps the question you were
     asking, and closing the tab forgets it. A filter that outlives the day it
     was set is a list that looks empty for a reason nobody remembers. */
  const [tokens, setTokensState] = useState<FilterToken[]>(() => readTokens('dms'))
  const setTokens = (next: FilterToken[]) => {
    setTokensState(next)
    writeTokens('dms', next)
    setFilter(filterFromTokens(next))
  }
  // The Shell mounts with `filter = 'all'`; a restored set has to reach it, or
  // the lane the list is showing and the lane the rest of the app believes in
  // disagree from the first paint. Runs once, on the restored set only.
  useEffect(() => {
    const restored = readTokens('dms')
    if (restored.length > 0) setFilter(filterFromTokens(restored))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The stale-draft strip is lane-scoped so it agrees with the list under it: a
  // bar counting a lane Ivan is not looking at would be the tenancy version of a
  // phantom badge.
  const laned = applyThreadTokens(threads, tokens)
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
      tokens={tokens}
      setTokens={setTokens}
      status={status}
      browse
      refresh={refresh}
      onOpenThread={onOpenThread}
      // A `status` is passed, so the list renders no draft banner and this never
      // fires — the drafts are rows in this same list.
      onOpenDrafts={() => {}}
      windowed
      verifiedAt={loadedAt}
      refreshing={refreshing}
      cachedAt={cachedAt}
      error={error}
      before={<>
        <StaleBar stale={staleDrafts} refresh={refresh} />
        <PushedBar pushed={pushedDrafts} onOpen={onOpenThread} />
        {/* WARM SIGNALS (Ivan, 2026-09-12: "i want to see these cases on DM
            section before directly outreaching as draft all above.. with a
            special category - profile viewers and warm engagers etc"). The
            people who engaged HIM first, each as a card he taps before a single
            invite or DM goes out. Ivan's tenant only; hidden on client lanes.
            Nothing on it sends: the senders read the stamps on their own clock. */}
        <WarmSignals filter={filter} refresh={refresh} inboxLoadedAt={loadedAt} focus={warm} onOpenThread={onOpenThread} />
        {/* CAME BACK (Ivan, 2026-09-18: "this should be judged in all clients. me,
            mattan, davoirin"). People we already messaged who viewed the profile or
            engaged a post afterwards and never replied. All three clients, following
            the lane switch. Read-only apart from Dismiss: nothing here sends. */}
        <CameBack filter={filter} inboxLoadedAt={loadedAt} onOpenThread={onOpenThread} />
        {/* The "N conversations · N replies" receipt ("so i know this is
            working") stays as one caption line. The DM-history LIST it used to
            head is gone (Ivan, 2026-09-15): the list below now holds every
            conversation in one recency order, so a second copy underneath was
            the thing he had to scroll past.
            N3b-1: `loadedAt` is stamped only by a fetch that RESOLVED, so this is
            false for exactly as long as the rows came off the device, and the
            caption states no count while it is. */}
        <DmCount threads={laned} verified={loadedAt !== null} />
      </>}
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
          // N2b-4: a button's label is Title case, like Discard and Open beside
          // it. UI control name, not a message anyone is sent.
          >{st.s === 'error' ? 'Again' : 'Sum up'}</Button>
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
      rowHold={t => {
        const out: HoldAction[] = []
        const st = pre.get(t.prospect_id)
        if (preReadWorthwhile(t) && st.s !== 'done' && st.s !== 'running') {
          out.push({ label: st.s === 'error' ? 'Sum up again' : 'Sum up', icon: 'quote', run: () => pre.run(t) })
        }
        const link = chatLink(t.chat_provider_id, t.linkedin_url)
        if (link) {
          out.push({
            label: link.isChat ? 'Copy chat' : 'Copy profile', icon: 'copy',
            run: () => { navigator.clipboard.writeText(link.href).catch(() => window.prompt('Copy this link', link.href)) },
          })
        }
        // Rebuild: Claude opens with this person attached (askAbout.ts). Nothing is sent.
        out.push({ label: 'Ask Claude', icon: 'ask', run: () => askAbout(t) })
        return out
      }}
      renderRow={status === 'approve'
        ? t => <DraftCard key={t.prospect_id} thread={t} onOpenThread={onOpenThread} refresh={refresh} />
        : undefined}
      emptyLine={
        status === 'needs' ? 'Nothing waiting on you, replies land here, sends live in Sends'
          : status === 'all' ? 'No conversations, replies land here, sends live in Sends'
            : `No conversations in “${STATUS_LABEL[status]}”`
      }
    />
  )
}
